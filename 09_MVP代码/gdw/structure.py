"""任务结构检查（Q013 之前的静态检查）。

三态判定回答"结局能不能触发"，本模块回答"图本身有没有写坏"：
结构问题在跑搜索之前就能抓出来，而且能指出**原因**而不是只给"不可达"。

五类检查：
- S1 条件引用了未声明的变量              → 错误
- S2 结构不可达节点（忽略条件从 start 走不到）→ 错误
- S3 死节点（非结局、没有任何出边）        → 错误
- S4 循环依赖（条件要 X，但 X 的写入点只存在于这条边挡住的路之后）→ 错误
- S5 幽灵变量（声明了、从没被写入，却被条件引用）→ 提示

移植自 `08_原型与界面/任务结构检查报告_雾隐镇.html` 的诊断思路，
验收标准：雾隐镇三处设计错误必须在本模块 + Q013 中复现。
"""

from __future__ import annotations

import ast
import re
from typing import Any

from . import expr

_LEVEL_ERROR = "错误"
_LEVEL_WARN = "提示"


def check_structure(quest: dict) -> list[dict[str, str]]:
    """对 quest 段做静态结构检查，返回发现清单（可能为空）。"""
    variables: dict[str, Any] = quest.get("variables", {})
    nodes: list[str] = list(quest.get("nodes", []))
    edges: list[dict] = list(quest.get("edges", []))
    start = quest.get("start")
    targets = quest.get("targets", [])
    if isinstance(targets, str):
        targets = [targets]

    findings: list[dict[str, str]] = []

    def add(code: str, level: str, where: str, message: str) -> None:
        findings.append({"code": code, "level": level, "where": where, "message": message})

    # ---------- S1 条件引用未声明的变量 ----------
    for edge in edges:
        cond = edge.get("cond")
        if not cond:
            continue
        try:
            tree = ast.parse(expr.normalize(cond), mode="eval")
        except SyntaxError:
            add("S1", _LEVEL_ERROR, f"{edge['from']} → {edge['to']}", f"条件写法有误：{cond}")
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id not in expr._LITERALS:
                if node.id not in variables:
                    add(
                        "S1",
                        _LEVEL_ERROR,
                        f"{edge['from']} → {edge['to']}",
                        f"条件用了未声明的变量 {node.id}——多半是变量名拼错，或忘了在 variables 里声明",
                    )

    # ---------- 可达性（忽略条件，纯图结构） ----------
    adjacency: dict[str, list[str]] = {n: [] for n in nodes}
    for edge in edges:
        adjacency.setdefault(edge["from"], []).append(edge["to"])
    reachable: set[str] = set()
    if start in adjacency or start in nodes:
        stack = [start]
        while stack:
            node = stack.pop()
            if node in reachable:
                continue
            reachable.add(node)
            stack.extend(adjacency.get(node, []))

    # ---------- S2 结构不可达节点 ----------
    for node in nodes:
        if node not in reachable:
            add(
                "S2",
                _LEVEL_ERROR,
                node,
                "从 start 出发（不看条件）就走不到这个节点——检查它的入边是不是挂在了错误的节点上",
            )

    # ---------- S3 死节点 ----------
    out_count: dict[str, int] = {n: 0 for n in nodes}
    for edge in edges:
        out_count[edge["from"]] = out_count.get(edge["from"], 0) + 1
    for node in nodes:
        if node not in targets and out_count.get(node, 0) == 0 and node in reachable:
            add(
                "S3",
                _LEVEL_ERROR,
                node,
                "不是结局，却没有任何出边——玩家走到这里就断了，要么补出边，要么把它标成结局",
            )

    # ---------- 写入点索引（S4/S5 共用） ----------
    writers: dict[str, list[str]] = {}  # 变量 → 写它的边的 from 节点
    for edge in edges:
        for act in edge.get("actions", []) or []:
            var = act.get("var")
            if var:
                writers.setdefault(var, []).append(edge["from"])

    def cond_vars(cond: str) -> list[str]:
        """条件里出现的、已声明的变量名。"""
        try:
            tree = ast.parse(expr.normalize(cond), mode="eval")
        except SyntaxError:
            return []
        return sorted(
            {
                node.id
                for node in ast.walk(tree)
                if isinstance(node, ast.Name)
                and node.id not in expr._LITERALS
                and node.id not in expr.SAFE_FUNCS
                and node.id in variables
            }
        )

    # ---------- S4 循环依赖 ----------
    for edge in edges:
        cond = edge.get("cond")
        if not cond:
            continue
        for var in cond_vars(cond):
            spec = variables.get(var, {})
            init = spec.get("init")
            if _init_satisfies(cond, var, init):
                continue  # 初始值已满足，不构成"拿不到"
            # 把这条边拿掉之后，写入点还可达吗？
            reach_without = _reachable_without(nodes, edges, edge, quest.get("start"))
            writer_from = [node for node in writers.get(var, []) if node in reachable]
            if writer_from and all(node not in reach_without for node in writer_from):
                add(
                    "S4",
                    _LEVEL_ERROR,
                    f"{edge['from']} → {edge['to']}",
                    f"循环依赖：这条边要求 {var}，但 {var} 只在这条边之后才被写入——"
                    f"要过这条边才能拿到 {var}，要拿到 {var} 才能过这条边",
                )

    # ---------- S5 幽灵变量 ----------
    referenced: set[str] = set()
    for edge in edges:
        for var in cond_vars(edge.get("cond", "")):
            referenced.add(var)
    for var in variables:
        if var in referenced and var not in writers:
            add(
                "S5",
                _LEVEL_WARN,
                var,
                f"变量 {var} 被条件引用，但没有任何动作写入它——它永远等于初始值，"
                f"引用它的条件要么恒成立要么恒不成立",
            )

    return findings


# ---------- 工具 ----------


def _init_satisfies(cond: str, var: str, init: Any) -> bool:
    """粗判：把变量替换成初始值后条件是否成立。解析失败按"可能不满足"处理。"""
    try:
        return bool(expr.evaluate(cond, {var: init}))
    except Exception:
        return False


def _reachable_without(nodes: list[str], edges: list[dict], removed: dict, start: str) -> set[str]:
    """从 start 出发、**去掉一条边**之后的结构可达集。"""
    adjacency: dict[str, list[str]] = {n: [] for n in nodes}
    for edge in edges:
        if edge is removed:
            continue
        adjacency.setdefault(edge["from"], []).append(edge["to"])
    if start not in adjacency:
        return set()
    seen: set[str] = set()
    stack = [start]
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        stack.extend(adjacency.get(node, []))
    return seen


def describe_findings(findings: list[dict[str, str]]) -> str:
    if not findings:
        return "结构检查通过：没有发现引用错误、不可达节点、死节点或循环依赖。"
    lines = []
    for f in findings:
        mark = "✗" if f["level"] == _LEVEL_ERROR else "?"
        lines.append(f"{mark} [{f['code']}] {f['where']}：{f['message']}")
    return "\n".join(lines)
