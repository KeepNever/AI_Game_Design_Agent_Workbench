"""变更确认单的第三种输出：自包含 HTML 报告。

定位：介于「纯文本（粘微信）」和「交互工具（未做）」之间——
跑一条命令得到一个能直接发人的网页，视觉与 `08_原型与界面` 的原型同源。
**零依赖**：CSS 全部内联，不引用任何外部资源，双击就能打开。

勾选框是真实的 ``<input type="checkbox">``：收到的人可以直接勾，
打印出来就是一张纸面确认单。没有 JS——静态报告不需要它。
"""

from __future__ import annotations

from datetime import datetime

from .deps import Analysis, _fmt
from .sheet import narrate
from .model import Config
from .rules import SOURCE_LABEL, RuleReport

_CSS = """
:root{--navy:#17365D;--ink:#1F2937;--muted:#6B7280;--line:#E5E7EB;--bg:#F5F7FA;
--pass:#0F7B4F;--passbg:#E6F4EA;--fail:#B42318;--failbg:#FBE9E7;--warn:#B54708;--warnbg:#FFF4E0;
--oral:#1D4ED8;--oralbg:#E8EEFB;--sim:#92400E;--simbg:#FDF3E3;--infer:#6D28D9;--inferbg:#F3EBFF;
--eng:#0F6E56;--engbg:#E1F5EE;}
*{box-sizing:border-box;}
body{margin:0;padding:24px 26px 40px;background:var(--bg);color:var(--ink);
font-family:"微软雅黑","Microsoft YaHei",system-ui,sans-serif;font-size:13px;line-height:1.65;}
.wrap{max-width:1080px;margin:0 auto;}
header{background:var(--navy);border-radius:10px;padding:18px 22px 16px;color:#fff;}
h1{margin:0;font-size:19px;font-weight:700;letter-spacing:.3px;}
.sub{margin-top:5px;font-size:11.5px;color:#B9C7DA;line-height:1.6;}
.meta{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
.chip{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);
border-radius:20px;padding:3px 11px;font-size:10.5px;color:#DCE6F2;}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0;}
.stat{background:#fff;border:1px solid var(--line);border-radius:9px;padding:12px 14px;}
.stat .n{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;}
.stat .l{font-size:11px;color:var(--muted);margin-top:2px;}
.card{background:#fff;border:1px solid var(--line);border-radius:9px;margin-bottom:14px;overflow:hidden;}
.hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
border-bottom:1px solid var(--line);background:#FAFBFC;}
.hd h2{margin:0;font-size:12.5px;font-weight:700;color:var(--navy);}
.hd .tag{font-size:10px;color:var(--muted);}
.bd{padding:12px 14px;}
table{width:100%;border-collapse:collapse;font-size:12px;}
th{background:#F3F6FA;color:var(--navy);font-weight:600;text-align:left;padding:7px 9px;
border-bottom:1px solid var(--line);font-size:11.5px;white-space:nowrap;}
td{padding:7px 9px;border-bottom:1px solid #F0F2F5;vertical-align:middle;}
tr:last-child td{border-bottom:none;}
code{background:#F3F5F9;border:1px solid #E7EBF1;border-radius:4px;padding:1px 5px;
font-family:Consolas,monospace;font-size:11px;color:#334155;}
.from{color:#9AA4B2;text-decoration:line-through;font-variant-numeric:tabular-nums;}
.to{color:var(--fail);font-weight:700;font-variant-numeric:tabular-nums;}
.badge{display:inline-block;font-size:10px;padding:1px 7px;border-radius:10px;font-weight:600;}
.b-oral{color:var(--oral);background:var(--oralbg);}
.b-eng{color:var(--eng);background:var(--engbg);}
.b-sim{color:var(--sim);background:var(--simbg);}
.b-infer{color:var(--infer);background:var(--inferbg);}
.ok{color:var(--pass);background:var(--passbg);}
.no{color:var(--fail);background:var(--failbg);}
.q{color:var(--warn);background:var(--warnbg);}
.obj{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid #F0F2F5;}
.obj:last-child{border-bottom:none;}
.obj input{margin-top:3px;transform:scale(1.2);}
.obj .nm{font-weight:600;}
.obj .ow{color:var(--muted);font-size:11px;}
.hint{background:var(--warnbg);border:1px solid #F2C94C;border-radius:8px;
padding:10px 14px;font-size:12px;margin-bottom:14px;}
.hint b{color:var(--warn);}
.notes{background:#fff;border:1px solid var(--line);border-radius:9px;padding:12px 16px;font-size:12px;color:#374151;}
.notes h3{margin:0 0 8px;font-size:12.5px;color:var(--navy);}
.notes ol{margin:0;padding-left:20px;}
.notes li{margin-bottom:5px;}
footer{margin-top:14px;font-size:11px;color:var(--muted);text-align:center;}
"""


def _esc(text) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _source_badge(source: str) -> str:
    label = SOURCE_LABEL.get(source, source or "未标注")
    key = source.split("+")[0] if source else ""
    cls = {"oral": "b-oral", "eng": "b-eng", "sim": "b-sim", "infer": "b-infer"}.get(key, "b-eng")
    return f'<span class="badge {cls}">{_esc(label)}</span>'


def _status_badge(status: str) -> str:
    mark = {"通过": ("✓", "ok"), "违反": ("✗", "no"), "无法判定": ("?", "q")}.get(status, ("·", "q"))
    return f'<span class="badge {mark[1]}">{mark[0]} {_esc(status)}</span>'


def render(config: Config, analysis: Analysis, report: RuleReport, when: datetime | None = None) -> str:
    stamp = (when or datetime.now()).strftime("%Y-%m-%d %H:%M")
    act_name = config.activity.get("name", config.activity.get("id", "未命名活动"))
    layer = "，".join(f"{label} {ok}/{total}" for label, (ok, total) in report.by_source().items())

    parts: list[str] = []
    parts.append("<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>")
    parts.append("<title>变更确认单 · " + _esc(act_name) + "</title>")
    parts.append(f"<style>{_CSS}</style></head><body><div class='wrap'>")

    # header
    parts.append("<header>")
    parts.append(f"<h1>变更确认单 · {_esc(str(act_name))}</h1>")
    parts.append(
        "<div class='sub'>改一个配置之后，哪些地方要跟着改——由已登记的引用关系推导，非语义猜测"
        "　|　生成于 " + stamp + "</div>"
    )
    parts.append(
        "<div class='meta'>"
        f"<span class='chip'>{_esc(str(config.activity.get('id', '—')))}</span>"
        f"<span class='chip'>规则 {report.summary()}</span>"
        f"<span class='chip'>待确认对象 {len(analysis.affected)} 个</span>"
        "<span class='chip'>v0.1 · 冻结 2026-11-10</span>"
        "</div></header>"
    )

    # stats
    parts.append("<div class='stats'>")
    stats = [
        (len(analysis.changes), "本次改动"),
        (len(analysis.stale), "连带失效"),
        (len(report.violations), "规则违反"),
        (len(analysis.affected), "待确认对象"),
    ]
    for number, label in stats:
        color = "var(--fail)" if label == "规则违反" and number else "var(--ink)"
        parts.append(f"<div class='stat'><div class='n' style='color:{color}'>{number}</div><div class='l'>{label}</div></div>")
    parts.append("</div>")

    # narrative
    parts.append(
        "<div class='card'><div class='hd'><h2>先说人话</h2><span class='tag'>不看字段路径，30 秒了解全貌</span></div>"
        f"<div class='bd' style='font-size:13px'>{_esc(narrate(config, analysis, report))}</div></div>"
    )

    # changes
    parts.append("<div class='card'><div class='hd'><h2>一、本次改动</h2><span class='tag'>旧的划掉，新的标红</span></div><div class='bd'>")
    parts.append("<table><tr><th style='width:160px'>字段</th><th>变化</th><th style='width:220px'>字段路径</th></tr>")
    for change in analysis.changes:
        parts.append(
            f"<tr><td>{_esc(change.label)}</td>"
            f"<td><span class='from'>{_esc(_fmt(change.old))}</span>"
            f" → <span class='to'>{_esc(_fmt(change.new))}</span></td>"
            f"<td><code>{_esc(change.path)}</code></td></tr>"
        )
    if not analysis.changes:
        parts.append("<tr><td colspan='3' style='color:var(--muted)'>无改动</td></tr>")
    parts.append("</table></div></div>")

    # stale
    if analysis.stale:
        parts.append("<div class='card'><div class='hd'><h2>二、连带失效</h2><span class='tag'>改了上游，这些值要重算</span></div><div class='bd'>")
        parts.append("<table><tr><th>字段</th><th>当前配置</th><th>按公式应为</th><th>原因</th></tr>")
        for item in analysis.stale:
            parts.append(
                f"<tr><td><code>{_esc(item.path)}</code></td>"
                f"<td>{_esc(_fmt(item.configured))}</td><td class='to'>{_esc(_fmt(item.expected))}</td>"
                f"<td style='color:var(--muted)'>{_esc(item.reason or '上游字段变更')}</td></tr>"
            )
        parts.append("</table></div></div>")

    # rules
    parts.append(f"<div class='card'><div class='hd'><h2>三、规则检查 · {report.summary()}</h2><span class='tag'>来源分层，不合成总数</span></div><div class='bd'>")
    parts.append("<table><tr><th style='width:64px'>规则</th><th>名称</th><th style='width:70px'>级别</th><th style='width:90px'>来源</th><th style='width:96px'>结果</th><th>说明</th></tr>")
    for result in report.results:
        parts.append(
            f"<tr><td><code>{_esc(result.rule_id)}</code></td><td>{_esc(result.name)}</td>"
            f"<td>{_esc(result.level)}</td><td>{_source_badge(result.source)}</td>"
            f"<td>{_status_badge(result.status)}</td><td style='color:var(--muted)'>{_esc(result.detail)}</td></tr>"
        )
    parts.append("</table>")
    if layer:
        parts.append(f"<div style='margin-top:9px;font-size:11px;color:var(--muted)'>分层看：{_esc(layer)}——三层各自通过只说明这套数据自洽，不等于业务规则全对。</div>")
    parts.append("</div></div>")

    # affected
    parts.append(f"<div class='card'><div class='hd'><h2>四、需要确认的对象 · {len(analysis.affected)} 个</h2><span class='tag'>勾选 = 人工确认已同步</span></div><div class='bd'>")
    if analysis.affected:
        for affected in analysis.affected:
            refs = "、".join(f"<code>{_esc(r)}</code>" for r in affected.matched_refs)
            owner = affected.obj.owner or "负责人未填"
            parts.append(
                f"<div class='obj'><input type='checkbox'><div style='flex:1'>"
                f"<span class='nm'>{_esc(affected.obj.name)}</span> "
                f"<span class='ow'>（{_esc(owner)} · {_esc(affected.kind)}）</span><br>{refs}</div></div>"
            )
    else:
        parts.append("<div style='color:var(--muted)'>没有下游对象引用这几个字段。</div>")
    parts.append("</div></div>")

    # hints
    if analysis.hints:
        parts.append("<div class='hint'><b>推不出来的部分（必须人工确认）</b><br>")
        for hint in analysis.hints:
            parts.append(f"· {_esc(hint)}<br>")
        parts.append("</div>")

    # notes
    parts.append(
        "<div class='notes'><h3>口径 · 这张单能证明什么，不能证明什么</h3><ol>"
        "<li><b>只核对已登记的引用。</b>文案里手写的数字、公告图、截图里的旧值，本表查不出来。</li>"
        "<li><b>「已同步」是勾出来的。</b>系统只知道受影响，不知道有没有人去改；勾选框是人工确认。</li>"
        "<li><b>没列出来的对象 ≠ 没有影响</b>，只是没登记。想让谁出现在这里，先把引用登记进配置。</li>"
        "</ol></div>"
    )
    parts.append(
        "<footer>Game Design Workbench v0.1 · 独立生成 · "
        f"{_esc(str(config.path))}</footer>"
    )
    parts.append("</div></body></html>")
    return "\n".join(parts)
