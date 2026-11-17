"""变更确认单的两种输出：Markdown（存档）与纯文本（直接粘进群）。

纯文本那份是刻意做的：它不用任何 Markdown 符号（# / - / [ ]），
因为粘到微信里这些符号不会变成格式，只会变成一堆乱码般的字符。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .deps import Analysis, _fmt
from .model import Config
from .rules import RuleReport


def _header(config: Config, analysis: Analysis, when: datetime | None) -> str:
    name = config.activity.get("name", config.activity.get("id", "未命名活动"))
    stamp = (when or datetime.now()).strftime("%Y-%m-%d %H:%M")
    return f"{name}｜{stamp}"


def narrate(config: Config, analysis: Analysis, report: RuleReport) -> str:
    """把整张确认单浓缩成几句人话，放在最前面。

    受众是"不想看字段路径的人"：只说改了什么、哪里不对、谁得跟着动。
    """
    from .deps import label_of

    sents: list[str] = []
    if analysis.changes:
        parts = [f"「{c.label}」从 {_fmt(c.old)} 改成了 {_fmt(c.new)}" for c in analysis.changes[:3]]
        extra = len(analysis.changes) - len(parts)
        sents.append("这次改了 " + "、".join(parts) + (f" 等 {len(analysis.changes)} 处。" if extra > 0 else "。"))
    else:
        sents.append("这次没有改动。")

    violations = report.violations
    if violations:
        names = "；".join(f"{r.name}（{r.detail}）" for r in violations[:3])
        more = len(violations) - 3
        sents.append(f"规则上有 {len(violations)} 处问题：{names}{'等' if more > 0 else ''}。")
    elif report.results:
        sents.append("规则检查全部通过——不过这只说明配置自己没毛病，不代表下游内容都跟着改了。")
    if report.undecidable:
        sents.append(f"另有 {len(report.undecidable)} 条规则因为缺数据没法判断，不是出问题，是这张表里没它要的东西。")

    for item in analysis.stale[:2]:
        label = label_of(config, item.path)
        sents.append(
            f"有个连带问题：{label} 是按公式算出来的，配置里还写着 {_fmt(item.configured)}，"
            f"按新数据应该是 {_fmt(item.expected)}，不改就是错的。"
        )

    if analysis.affected:
        by_owner: dict[str, list[str]] = {}
        for affected in analysis.affected:
            by_owner.setdefault(affected.obj.owner or "还没填负责人", []).append(affected.obj.name)
        owner_parts = [
            f"{owner}名下的{'、'.join(names)}"
            for owner, names in list(by_owner.items())[:3]
        ]
        sents.append(
            f"得有人跟着改的有 {len(analysis.affected)} 处：{'；'.join(owner_parts)}。"
            f"逐个确认完勾上「已同步」才算闭环。"
        )
    else:
        sents.append("没有下游对象引用这几个字段——不过先别高兴，确认一下是不是漏登记了，没登记的这里看不见。")
    return "".join(sents)


def _change_lines(analysis: Analysis) -> list[str]:
    return [c.display() for c in analysis.changes]


def _stale_lines(analysis: Analysis) -> list[str]:
    lines = []
    for item in analysis.stale:
        lines.append(
            f"{item.path} 应重算：当前配置 {_fmt(item.configured)}，按公式应为 {_fmt(item.expected)}"
            + (f"（{item.reason}）" if item.reason else "")
        )
    return lines


# ---------- 纯文本（微信群） ----------


_CN = "一二三四五六七八九"


def render_plain(config: Config, analysis: Analysis, report: RuleReport, when: datetime | None = None, synced: set[str] | None = None) -> str:
    lines: list[str] = []
    lines.append(f"【活动变更确认单】{_header(config, analysis, when)}")
    lines.append("【先说人话】" + narrate(config, analysis, report))
    counter = 0

    def section(title: str) -> None:
        nonlocal counter
        lines.append("")
        lines.append(f"{_CN[counter]}、{title}")
        counter += 1

    section(f"本次改动 {len(analysis.changes)} 项")
    for line in _change_lines(analysis) or ["（无）"]:
        lines.append(f"  · {line}")

    if analysis.stale:
        section("连带失效（改了上游，这些值要重算）")
        for line in _stale_lines(analysis):
            lines.append(f"  ! {line}")

    section(f"规则 {report.summary()}")
    for result in report.violations:
        lines.append(f"  × {result.rule_id} {result.name}（{result.level}）：{result.detail}")
    for result in report.undecidable:
        lines.append(f"  ? {result.rule_id} {result.name}：{result.detail}")
    by_source = report.by_source()
    if by_source:
        layer = "，".join(f"{label} {ok}/{total}" for label, (ok, total) in by_source.items())
        lines.append(f"  （分层看：{layer}，不能合成一个总数）")

    section(f"需要确认的对象 {len(analysis.affected)} 个")
    if not analysis.affected:
        lines.append("  （没有下游对象引用这几个字段）")
    synced = synced or set()
    for affected in analysis.affected:
        owner = affected.obj.owner or "负责人未填"
        refs = "、".join(affected.matched_refs)
        mark = "☑" if affected.obj.id in synced else "□"
        state = "已同步" if affected.obj.id in synced else "待确认"
        lines.append(f"  {mark} {affected.obj.name}（{owner}）｜{affected.kind}｜{refs}｜{state}")

    if analysis.hints:
        section("推不出来的部分（必须人工确认）")
        for hint in analysis.hints:
            lines.append(f"  ! {hint}")

    section("口径")
    lines.append("  · 只核对已经登记过的引用；文案里手写的数字、公告图、截图，本表查不出来。")
    lines.append("  · 系统只知道「受影响」，不知道有没有人去改；□ 是要人工勾的。")
    return "\n".join(lines)


# ---------- Markdown（存档 / 发邮件） ----------


def render_markdown(config: Config, analysis: Analysis, report: RuleReport, when: datetime | None = None, synced: set[str] | None = None) -> str:
    out: list[str] = []
    out.append(f"# 变更确认单 · {_header(config, analysis, when)}")
    out.append("")
    out.append(f"> **先说人话**：{narrate(config, analysis, report)}")
    counter = 0

    def section(title: str) -> None:
        nonlocal counter
        out.append("")
        out.append(f"## {_CN[counter]}、{title}")
        counter += 1

    section("本次改动")
    out.append("")
    out.append("| 字段 | 原值 | 新值 | 字段路径 |")
    out.append("|---|---|---|---|")
    for change in analysis.changes:
        out.append(f"| {change.label} | {_fmt(change.old)} | **{_fmt(change.new)}** | `{change.path}` |")
    if not analysis.changes:
        out.append("| — | — | — | — |")

    if analysis.stale:
        section("连带失效")
        out.append("")
        out.append("| 字段 | 当前配置 | 按公式应为 | 原因 |")
        out.append("|---|---|---|---|")
        for item in analysis.stale:
            out.append(
                f"| `{item.path}` | {_fmt(item.configured)} | {_fmt(item.expected)} | {item.reason or '上游字段变更'} |"
            )

    section(f"规则检查（{report.summary()}）")
    out.append("")
    out.append("| 规则 | 名称 | 级别 | 来源 | 结果 | 说明 |")
    out.append("|---|---|---|---|---|---|")
    for result in report.results:
        mark = {"通过": "✅", "违反": "❌", "无法判定": "⚠️"}.get(result.status, "·")
        out.append(
            f"| {result.rule_id} | {result.name} | {result.level} | {result.source or '—'} | {mark} {result.status} | {result.detail} |"
        )
    by_source = report.by_source()
    if by_source:
        out.append("")
        out.append(
            "> 分层看："
            + "，".join(f"{label} {ok}/{total}" for label, (ok, total) in by_source.items())
            + "。**不要合成一个总数对外说。**"
        )

    section(f"需要确认的对象（{len(analysis.affected)}）")
    out.append("")
    out.append("| 待确认 | 对象 | 负责人 | 引用字段 | 关系 |")
    out.append("|---|---|---|---|---|")
    synced = synced or set()
    for affected in analysis.affected:
        mark = "☑" if affected.obj.id in synced else "☐"
        out.append(
            f"| {mark} | {affected.obj.name} | {affected.obj.owner or '—'} | "
            f"{'、'.join(f'`{r}`' for r in affected.matched_refs)} | {affected.kind} |"
        )
    if not analysis.affected:
        out.append("| — | 没有下游对象引用这几个字段 | — | — | — |")

    if analysis.hints:
        section("推不出来的部分（必须人工确认）")
        out.append("")
        for hint in analysis.hints:
            out.append(f"- ⚠️ {hint}")

    section("口径")
    out.append("")
    out.append("1. 只核对**已登记**的引用。文案里手写的数字、公告图、截图里的旧值，本表查不出来。")
    out.append("2. 系统只知道「受影响」，不知道有没有人去改。☐ 需要人工勾选。")
    out.append("3. 未登记的下游对象不会出现在「需要确认的对象」里——这不是「没有影响」，是「没登记」。")
    return "\n".join(out)


def render_check_table(report: RuleReport) -> str:
    """只输出规则层，给 CLI 的 check 子命令用。"""
    lines = []
    for result in report.results:
        mark = {"通过": "✓", "违反": "✗", "无法判定": "?"}.get(result.status, "·")
        lines.append(f"{mark} {result.rule_id:<6} {result.name:<22} [{result.level}/{result.source or '-'}] {result.detail}")
    lines.append("")
    lines.append(f"合计：{report.summary()}")
    by_source: dict[str, tuple[int, int]] = report.by_source()
    if by_source:
        lines.append(
            "分层：" + "，".join(f"{label} {ok}/{total}" for label, (ok, total) in by_source.items())
        )
    return "\n".join(lines)


def as_dict(analysis: Analysis, report: RuleReport) -> dict[str, Any]:
    """给程序化调用（将来接 CI / 机器人）用的结构化输出。"""
    return {
        "changes": [{"path": c.path, "label": c.label, "old": c.old, "new": c.new} for c in analysis.changes],
        "rules": [
            {
                "id": r.rule_id,
                "name": r.name,
                "level": r.level,
                "source": r.source,
                "status": r.status,
                "detail": r.detail,
            }
            for r in report.results
        ],
        "affected": [
            {"id": a.obj.id, "name": a.obj.name, "owner": a.obj.owner, "refs": a.matched_refs, "kind": a.kind}
            for a in analysis.affected
        ],
        "stale": [
            {"path": s.path, "configured": s.configured, "expected": s.expected, "reason": s.reason}
            for s in analysis.stale
        ],
        "hints": list(analysis.hints),
    }
