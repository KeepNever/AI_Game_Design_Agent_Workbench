"""变异评测 · 检查器的第一份定量成绩单。

思路（v2.0 评测纪律的最小版）：
1. 以雾隐镇任务图为 **GT**（基准）——先记录基准下的结构发现与逐结局三态；
2. 对 GT 做 N 处**人为注入的确定性变异**（抬高阈值、删边、砍变量上限、删写点、换错变量）；
3. 每个变异跑一遍检查器，看它**有没有被发现**。

判定口径（诚实三档）：
- 强检出：有结局的三态结果翻转，或出现「错误」级发现；
- 仅提示：只有「提示」级发现（如幽灵变量）——算发现，但强度打折；
- 漏报：什么都没变。漏报不是耻辱，是覆盖率的边界——**每一条漏报都写明原因**。

变异是声明式的（yaml），加一个新变异不需要改代码。
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

from . import loader, quest as quest_mod, structure as structure_mod


class EvalError(Exception):
    pass


def _baseline(quest: dict) -> dict:
    findings = structure_mod.check_structure(quest)
    per = quest_mod.check_per_target(quest)
    return {
        "finding_codes": sorted(f["code"] + "|" + f["where"] for f in findings),
        "errors": sum(1 for f in findings if f["level"] == "错误"),
        "results": {e["target"]: e["result"] for e in per},
    }


def _apply(quest: dict, mutation: dict) -> dict:
    """把一条变异应用到 quest 的深拷贝上。返回 (新quest, 是否命中目标)。"""
    mutated = copy.deepcopy(quest)
    kind = mutation.get("kind")
    target = mutation.get("edge") or {}

    def find_edge(data: dict) -> dict:
        for edge in data["edges"]:
            if edge.get("from") == target.get("from") and edge.get("to") == target.get("to"):
                return edge
        raise EvalError(
            f"变异「{mutation.get('name')}」找不到目标边 "
            f"{target.get('from')} → {target.get('to')}"
        )

    if kind == "cond_replace":
        edge = find_edge(mutated)
        cond = edge.get("cond") or ""
        find = mutation.get("find") or ""
        replace = mutation.get("replace") or ""
        if find not in cond:
            raise EvalError(f"变异「{mutation.get('name')}」：条件里找不到 {find!r}（现值 {cond!r}）")
        edge["cond"] = cond.replace(find, replace)
    elif kind == "drop_edge":
        edge = find_edge(mutated)
        mutated["edges"].remove(edge)
    elif kind == "drop_action":
        edge = find_edge(mutated)
        var = mutation.get("var")
        edge["actions"] = [a for a in edge.get("actions", []) if a.get("var") != var]
        if edge.get("actions") == []:
            edge.pop("actions", None)
    elif kind == "var_max":
        var = mutation.get("var")
        if var not in mutated["variables"]:
            raise EvalError(f"变异「{mutation.get('name')}」：变量 {var} 不存在")
        mutated["variables"][var]["max"] = mutation.get("value")
    else:
        raise EvalError(f"未知变异类型：{kind}")
    return mutated


def _detect(mutated_quest: dict, base: dict) -> tuple[str, dict]:
    findings = structure_mod.check_structure(mutated_quest)
    per = quest_mod.check_per_target(mutated_quest)
    detail = {
        "new_findings": [
            {"code": f["code"], "level": f["level"], "where": f["where"], "message": f["message"]}
            for f in findings
            if (f["code"] + "|" + f["where"]) not in set(base["finding_codes"])
        ],
        "disappeared": sorted(set(base["finding_codes"]) - {f["code"] + "|" + f["where"] for f in findings}),
        "results": {e["target"]: e["result"] for e in per},
    }
    outcome_changed = detail["results"] != base["results"]
    new_error_findings = [
        f for f in findings
        if f["level"] == "错误" and (f["code"] + "|" + f["where"]) not in set(base["finding_codes"])
    ]
    new_warn_findings = [
        f for f in findings
        if f["level"] == "提示" and (f["code"] + "|" + f["where"]) not in set(base["finding_codes"])
    ]
    if outcome_changed or new_error_findings:
        return "强检出", detail
    if new_warn_findings:
        return "仅提示", detail
    return "漏报", detail


def run_eval(quest: dict, mutations: list[dict]) -> dict:
    """跑全部变异，返回评测报告。"""
    base = _baseline(quest)
    rows = []
    for index, mutation in enumerate(mutations, start=1):
        name = mutation.get("name") or f"变异{index}"
        try:
            mutated = _apply(quest, mutation)
            verdict, detail = _detect(mutated, base)
            rows.append({"name": name, "kind": mutation.get("kind"), "verdict": verdict, "detail": detail})
        except EvalError as exc:
            rows.append({"name": name, "kind": mutation.get("kind"), "verdict": "未执行", "detail": str(exc)})
    strong = sum(1 for r in rows if r["verdict"] == "强检出")
    weak = sum(1 for r in rows if r["verdict"] == "仅提示")
    missed = [r for r in rows if r["verdict"] == "漏报"]
    return {
        "baseline": {"errors": base["errors"], "results": base["results"]},
        "rows": rows,
        "summary": {
            "total": len(rows),
            "强检出": strong,
            "仅提示": weak,
            "漏报": len(missed),
            "检出率": f"{(strong + weak)}/{len(rows)}",
        },
        "missed": [{"name": r["name"], "kind": r["kind"]} for r in missed],
    }


def load_mutations(path: str | Path) -> list[dict]:
    """变异文件是纯数组（每条一个变异），不走 loader 的映射校验。"""
    import yaml

    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise EvalError("变异文件根节点必须是数组")
    return data


def render_report(report: dict) -> str:
    lines = ["变异评测报告", ""]
    base = report["baseline"]
    lines.append(
        f"基准：错误级发现 {base['errors']} 条；逐结局 "
        + "，".join(f"{t}={r}" for t, r in base["results"].items())
    )
    lines.append("")
    for row in report["rows"]:
        mark = {"强检出": "✓", "仅提示": "?", "漏报": "✗", "未执行": "-"}.get(row["verdict"], "·")
        lines.append(f"{mark} [{row['verdict']}] {row['name']}（{row['kind']}）")
        for f in row["detail"].get("new_findings", []) if isinstance(row["detail"], dict) else []:
            lines.append(f"    [新发现 {f['code']}/{f['level']}] {f['where']}：{f['message'][:80]}")
        disappeared = row["detail"].get("disappeared", []) if isinstance(row["detail"], dict) else []
        if disappeared:
            lines.append(f"    [基线发现消失] {len(disappeared)} 条：{'; '.join(disappeared)[:110]}")
        results = row["detail"].get("results", {}) if isinstance(row["detail"], dict) else {}
        if results and row["verdict"] != "未执行":
            diff = "，".join(f"{t}={r}" for t, r in results.items())
            lines.append(f"    逐结局：{diff}")
        if row["verdict"] == "未执行":
            lines.append(f"    原因：{row['detail']}")
    summary = report["summary"]
    lines.append("")
    lines.append(
        f"合计：{summary['total']} 个变异 —— 强检出 {summary['强检出']}，"
        f"仅提示 {summary['仅提示']}，漏报 {summary['漏报']}（检出率 {summary['检出率']}）"
    )
    if report["missed"]:
        lines.append("漏报原因：这些变异破坏的路径，其目标结局在基准里本来就不可达——")
        lines.append("现有检查只能看到「结局可不可达」，看不到「这条通向已死结局的路也被改坏了」。")
        lines.append("这是当前覆盖率的真实边界，不是可以修掉的 bug。")
    return "\n".join(lines)

