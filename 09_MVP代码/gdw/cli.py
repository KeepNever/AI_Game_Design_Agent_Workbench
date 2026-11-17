"""命令行入口。

    python -m gdw validate fixtures/activity_v0.1.yaml
    python -m gdw check     fixtures/activity_v0.1.yaml --rules fixtures/rules_v0.1.yaml
    python -m gdw impact    fixtures/activity_v0.1.yaml --rules fixtures/rules_v0.1.yaml \\
                            --set tiers.T_MID.count=8 --set activity.server_population=600
    python -m gdw template  fixtures/配置表模板.xlsx
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import deps, eval_check, html_report, loader, quest as quest_mod, rules as rules_mod, sheet, structure as structure_mod
from .model import Config, ConfigError

DEFAULT_RULES = Path(__file__).resolve().parent.parent / "fixtures" / "rules_v0.1.yaml"


def _setup_stdout() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows 控制台默认 GBK，中文会炸
    except (AttributeError, ValueError):
        pass


def _render_output(config, analysis, report, args) -> str:
    """按 --json / --md / --html 选输出；默认纯文本。"""
    if args.json:
        return json.dumps(sheet.as_dict(analysis, report), ensure_ascii=False, indent=2)
    if args.md:
        return sheet.render_markdown(config, analysis, report)
    if getattr(args, "html", False):
        return html_report.render(config, analysis, report)
    return sheet.render_plain(config, analysis, report)


def _parse_sets(pairs: list[str]) -> dict[str, object]:
    out: dict[str, object] = {}
    for raw in pairs or []:
        if "=" not in raw:
            raise SystemExit(f"--set 的格式是 路径=值，收到：{raw}")
        path, _, value = raw.partition("=")
        out[path.strip()] = _coerce(value.strip())
    return out


def _coerce(text: str) -> object:
    low = text.lower()
    if low in {"true", "false"}:
        return low == "true"
    for cast in (int, float):
        try:
            return cast(text)
        except ValueError:
            continue
    return text


def _load_config(path: str) -> Config:
    try:
        return Config.from_dict(loader.load(path), path=path)
    except loader.LoadError as exc:
        raise SystemExit(f"读不到配置：{exc}") from exc
    except ConfigError as exc:
        print("配置不合法：", file=sys.stderr)
        for error in exc.errors:
            print(f"  - {error}", file=sys.stderr)
        raise SystemExit(2) from exc


def _load_rules(path: str | None) -> list[dict]:
    target = Path(path) if path else DEFAULT_RULES
    if not target.exists():
        if path:
            raise SystemExit(f"规则文件不存在：{target}")
        return []
    try:
        return loader.load_rules(target)
    except loader.LoadError as exc:
        raise SystemExit(f"读不到规则：{exc}") from exc


def cmd_validate(args: argparse.Namespace) -> int:
    config = _load_config(args.config)
    print(f"配置可读：{config.path}")
    print(f"  活动：{config.activity.get('name', '?')}（{config.activity.get('id', '?')}）")
    print(f"  档位：{len(config.tiers)} 个 → {', '.join(config.tiers)}")
    print(f"  下游对象：{len(config.downstream)} 个，登记引用 {sum(len(o.refs) for o in config.downstream)} 条")
    print(f"  派生字段：{len(config.derived)} 个")
    if config.tables:
        detail = "、".join(f"{name}({len(rows)} 行)" for name, rows in config.tables.items())
        print(f"  外部表：{detail}")
    if config.warnings:
        print("  提醒：")
        for warn in config.warnings:
            print(f"    - {warn}")
    else:
        print("  没有结构性问题。")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    config = _load_config(args.config)
    rule_list = _load_rules(args.rules)
    report = rules_mod.run(config, rule_list)
    print(sheet.render_check_table(report))
    if config.warnings:
        print()
        for warn in config.warnings:
            print(f"提醒：{warn}")
    if config.quest:
        print()
        try:
            result = quest_mod.check_quest(config.quest)
            print(f"任务可达性（Q013）：{result['result']}")
            print(quest_mod.describe(result))
        except quest_mod.QuestError as exc:
            print(f"任务可达性：数据有问题——{exc}")
    blocking = [r for r in report.violations if r.level == "阻断"]
    return 1 if blocking else 0


def cmd_impact(args: argparse.Namespace) -> int:
    config = _load_config(args.config)
    rule_list = _load_rules(args.rules)
    changes = _parse_sets(args.set)

    if not changes:
        print("没有给 --set，先列出这份配置的下游引用：\n")
        index = deps.build_index(config)
        for ref, objects in sorted(index.items()):
            names = "、".join(o.name for o in objects)
            print(f"  {ref:<40} ← {names}")
        print("\n加 --set 路径=值 就能算影响面，例如 --set tiers.T_MID.count=8")
        return 0

    try:
        analysis = deps.analyze(config, changes)
    except KeyError as exc:
        raise SystemExit(str(exc)) from exc

    report = rules_mod.run(analysis.after, rule_list)
    text = _render_output(config, analysis, report, args)
    print(text)

    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"\n[已写入 {args.out}]", file=sys.stderr)

    blocking = [r for r in report.violations if r.level == "阻断"]
    return 1 if blocking else 0


def cmd_diff(args: argparse.Namespace) -> int:
    before = _load_config(args.before)
    after = _load_config(args.after)
    rule_list = _load_rules(args.rules)
    changes, notes = deps.diff_configs(before, after)

    if notes:
        print("结构变化（不推导影响）：")
        for note in notes:
            print(f"  · {note}")
        print()

    if not changes:
        print("两个版本在 activity / tiers 上没有数值差异。")
        return 0

    payload = {c.path: c.new for c in changes}
    analysis = deps.analyze(before, payload)
    report = rules_mod.run(analysis.after, rule_list)
    text = _render_output(before, analysis, report, args)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"\n[已写入 {args.out}]", file=sys.stderr)
    blocking = [r for r in report.violations if r.level == "阻断"]
    return 1 if blocking else 0


def cmd_quest(args: argparse.Namespace) -> int:
    config = _load_config(args.config)
    quest = config.quest
    if not quest:
        print("这份配置没有 quest 段——任务可达性检查不适用。")
        return 0
    findings = structure_mod.check_structure(quest)
    print("结构检查：" + ("无问题" if not findings else f"{len(findings)} 条发现"))
    for finding in findings:
        mark = "✗" if finding["level"] == "错误" else "?"
        print(f"  {mark} [{finding['code']}] {finding['where']}：{finding['message']}")
    print()
    try:
        result = quest_mod.check_quest(quest)
    except quest_mod.QuestError as exc:
        print(f"任务图数据有问题：{exc}")
        return 2
    print(f"总体判定：{result['result']}")
    print(quest_mod.describe(result))
    print()
    print("逐结局：")
    for entry in quest_mod.check_per_target(quest):
        mark = {"SAT": "✓", "UNSAT": "✗", "UNKNOWN": "?"}[entry["result"]]
        line = f"  {mark} {entry['target']}：{entry['result']}（探索 {entry['states_explored']} 状态）"
        if entry["result"] == quest_mod.UNSAT:
            blocks = "；".join(b["condition"] for b in entry.get("blocking_edges", []))
            if blocks:
                line += f" 挡住它的条件：{blocks}"
        print(line)
    if result["result"] == quest_mod.SAT:
        print()
        print("总体路径：" + " → ".join(result["path"]))
    return 0


def cmd_eval(args: argparse.Namespace) -> int:
    config = _load_config(args.config)
    if not config.quest:
        print("这份配置没有 quest 段——变异评测不适用（评测对象是任务图检查器）。")
        return 0
    mutations = eval_check.load_mutations(args.mutations)
    report = eval_check.run_eval(config.quest, mutations)
    print(eval_check.render_report(report))
    summary = report["summary"]
    return 0 if summary["漏报"] == 0 else 1


def cmd_web(args: argparse.Namespace) -> int:
    from . import webapp

    webapp.serve_forever(args.port, open_browser=not args.no_browser)
    return 0


def cmd_template(args: argparse.Namespace) -> int:
    target = loader.write_xlsx_template(args.out)
    print(f"模板已生成：{target}")
    print("固定四张：activity（键值）/ tiers（档位）/ downstream（下游对象）/ derived（派生字段）")
    print("其它任意 sheet 会当成外部表（如 items 道具表），引用写 items.10086.name")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gdw",
        description="Game Design Workbench · 配置变更影响分析（v0.1 边界内：只做已登记引用）",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("validate", help="检查配置结构是否可读")
    p.add_argument("config")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("check", help="只跑规则检查，不算影响面")
    p.add_argument("config")
    p.add_argument("--rules")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("impact", help="算一次改动的影响面，输出变更确认单")
    p.add_argument("config")
    p.add_argument("--rules")
    p.add_argument("--set", action="append", metavar="路径=值", help="可重复，例如 --set tiers.T_MID.count=8")
    p.add_argument("--json", action="store_true", help="输出结构化 JSON")
    p.add_argument("--md", action="store_true", help="输出 Markdown（默认是纯文本，方便粘微信）")
    p.add_argument("--html", action="store_true", help="输出自包含 HTML 报告（可直接发人，双击打开）")
    p.add_argument("--out", help="同时写入文件")
    p.set_defaults(func=cmd_impact)

    p = sub.add_parser("diff", help="对比两个版本的配置，自动算出改了哪些字段")
    p.add_argument("before")
    p.add_argument("after")
    p.add_argument("--rules")
    p.add_argument("--json", action="store_true")
    p.add_argument("--md", action="store_true")
    p.add_argument("--html", action="store_true")
    p.add_argument("--out")
    p.set_defaults(func=cmd_diff)

    p = sub.add_parser("quest", help="任务可达性三态判定（配置里有 quest 段才适用）")
    p.add_argument("config")
    p.set_defaults(func=cmd_quest)

    p = sub.add_parser("eval", help="变异评测：往任务图 GT 里注入已知错误，量检查器的检出率")
    p.add_argument("config")
    p.add_argument("--mutations", required=True)
    p.set_defaults(func=cmd_eval)

    p = sub.add_parser("web", help="本地交互工具：上传表 → 改数 → 勾选 → 导出（只监听 127.0.0.1）")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-browser", action="store_true", help="不自动开浏览器")
    p.set_defaults(func=cmd_web)

    p = sub.add_parser("template", help="生成 Excel 配置簿模板")
    p.add_argument("out")
    p.set_defaults(func=cmd_template)
    return parser


def main(argv: list[str] | None = None) -> int:
    _setup_stdout()
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
