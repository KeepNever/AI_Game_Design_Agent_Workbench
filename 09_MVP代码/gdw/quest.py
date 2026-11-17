"""Q013 · 任务路径条件可满足性（三态判定）。

问题：给一张任务图（节点 + 带条件/动作的边）和一个结局，
**存不存在一组合法状态，能真正触发这个结局？**

三态输出，缺一不可：
- SAT     存在合法路径（附路径与终态）
- UNSAT   穷尽搜索后确认不存在（附阻断边与各变量观测到的最大值）
- UNKNOWN 状态组合超过上限，下不了结论——**UNKNOWN 不降级为 SAT**，它就是"不知道"

移植自 `06_规则与数据结构/q013_minimal.py`（原型），两处改动：
- 条件求值复用 `gdw.expr`（同一个安全求值器，不再各养一份白名单）；
- 数据从配置的 ``quest`` 段读取，与其它检查共用一本配置簿。

数据形态::

    quest:
      start: start
      targets: [hidden_end]
      variables:
        clue_count: {type: int, min: 0, max: 3, init: 0}
      nodes: [start, n1, hidden_end]
      edges:
        - {from: start, to: n1, actions: [{var: clue_count, op: "+=", value: 1}]}
        - {from: n1, to: hidden_end, cond: "clue_count >= 2"}
"""

from __future__ import annotations

from typing import Any

from . import expr

DEFAULT_STATE_LIMIT = 50000

SAT, UNSAT, UNKNOWN = "SAT", "UNSAT", "UNKNOWN"


class QuestError(Exception):
    """任务图数据不合法。"""


# ---------- 状态与动作 ----------


def initial_state(variables: dict[str, dict[str, Any]]) -> tuple:
    return tuple((name, spec["init"]) for name, spec in variables.items())


def apply_actions(state: tuple, actions: list[dict], variables: dict) -> tuple:
    """在副本上按声明顺序执行动作；越界视为非法转移而不是静默截断。"""
    env = dict(state)
    for act in actions:
        var, op = act.get("var"), act.get("op")
        if var not in variables:
            raise QuestError(f"动作引用了未声明的变量：{var}")
        spec = variables[var]
        value = act.get("value")
        if op == "set":
            env[var] = value
        elif op == "+=":
            env[var] = env[var] + value
        elif op == "-=":
            env[var] = env[var] - value
        elif op == "*=":
            env[var] = env[var] * value
        else:
            raise QuestError(f"不支持的动作算子：{op}")

        if spec["type"] == "bool":
            if not isinstance(env[var], bool):
                raise QuestError(f"{var} 是布尔变量，被赋成 {env[var]!r}")
        else:
            lo, hi = spec["min"], spec["max"]
            if not (lo <= env[var] <= hi):
                raise QuestError(f"{var} 越界：{env[var]} 不在 [{lo},{hi}] 内")
    return tuple((name, env[name]) for name in variables)


# ---------- 检查器 ----------


class QuestChecker:
    def __init__(
        self,
        variables: dict[str, dict],
        nodes: list[str],
        edges: list[dict],
        start: str,
        targets: list[str],
        state_limit: int = DEFAULT_STATE_LIMIT,
    ):
        self.variables = variables
        self.nodes = list(nodes)
        self.edges = list(edges)
        self.start = start
        self.targets = {targets} if isinstance(targets, str) else set(targets)
        self.state_limit = state_limit
        self.out: dict[str, list[dict]] = {n: [] for n in self.nodes}
        for edge in self.edges:
            self.out.setdefault(edge["from"], []).append(edge)

    def check(self) -> dict:
        init = initial_state(self.variables)
        stack = [(self.start, init, [self.start])]
        visited: set = set()
        explored = 0
        edge_used: set = set()
        max_seen = {k: v["init"] for k, v in self.variables.items()}
        domain_rejects: list[str] = []
        hit_limit = False

        while stack:
            node, state, path = stack.pop()
            key = (node, state)
            if key in visited:
                continue
            visited.add(key)
            explored += 1

            env = dict(state)
            for k, v in env.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    max_seen[k] = max(max_seen[k], v)

            if node in self.targets:
                return {
                    "result": SAT,
                    "path": path,
                    "states_explored": explored,
                    "final_state": env,
                }

            if explored > self.state_limit:
                hit_limit = True
                break

            for edge in self.out.get(node, []):
                namespace = dict(env)
                namespace.update(
                    {
                        "True": True,
                        "False": False,
                        "None": None,
                    }
                )
                try:
                    if not expr.evaluate(edge.get("cond") or "True", namespace):
                        continue
                    nxt = apply_actions(state, edge.get("actions", []), self.variables)
                except expr.ExprError as exc:
                    raise QuestError(f"边 {edge['from']} → {edge['to']} 的条件有问题：{exc}") from exc
                except QuestError:
                    # 域越界 = 非法转移，剪掉；但记录下来，诊断时说人话
                    domain_rejects.append(f"{edge['from']} → {edge['to']}")
                    continue
                edge_used.add(id(edge))
                stack.append((edge["to"], nxt, path + [edge["to"]]))

        if hit_limit:
            return {
                "result": UNKNOWN,
                "reason": f"状态组合超过上限 {self.state_limit}，穷尽不了——下不了结论",
                "states_explored": explored,
                "max_seen": max_seen,
                "domain_rejects": domain_rejects,
            }

        blocking = []
        for target in self.targets:
            for edge in self.edges:
                if edge["to"] == target and id(edge) not in edge_used:
                    blocking.append(
                        {
                            "edge": f"{edge['from']} → {edge['to']}",
                            "condition": edge.get("cond", "True"),
                        }
                    )
        return {
            "result": UNSAT,
            "reason": "穷尽了所有可达状态，这个结局触发不了",
            "blocking_edges": blocking,
            "states_explored": explored,
            "max_seen": max_seen,
            "domain_rejects": domain_rejects,
        }


def check_quest(quest: dict) -> dict:
    """从配置的 ``quest`` 段跑一次三态判定。数据不合法抛 QuestError。"""
    for required in ("start", "targets", "variables", "nodes", "edges"):
        if required not in quest:
            raise QuestError(f"quest 段缺 {required}")
    if quest["start"] not in quest["nodes"]:
        raise QuestError(f"start（{quest['start']}）不在 nodes 里")
    targets = quest["targets"]
    if isinstance(targets, str):
        targets = [targets]
    bad = [t for t in targets if t not in quest["nodes"]]
    if bad:
        raise QuestError(f"targets 里有不在 nodes 里的节点：{bad}")
    checker = QuestChecker(
        quest["variables"],
        quest["nodes"],
        quest["edges"],
        quest["start"],
        targets,
        quest.get("state_limit", DEFAULT_STATE_LIMIT),
    )
    return checker.check()


def check_per_target(quest: dict) -> list[dict]:
    """逐个结局单独判定。

    多结局任务图只看总三态会漏信息：v13 能触发不代表 v14 也能。
    每个结局单独跑一次，各自给三态与诊断。
    """
    targets = quest.get("targets", [])
    if isinstance(targets, str):
        targets = [targets]
    out = []
    for target in targets:
        single = dict(quest)
        single["targets"] = [target]
        out.append({"target": target, **check_quest(single)})
    return out


def describe(result: dict) -> str:
    """把三态结果说成人话。"""
    verdict = result["result"]
    if verdict == SAT:
        path = " → ".join(result["path"])
        return (
            f"这个结局触发得了：存在一条合法路径（{path}），"
            f"搜索了 {result['states_explored']} 个状态后找到。"
        )
    if verdict == UNSAT:
        edges = "；".join(
            f"{b['edge']}（条件：{b['condition']}）" for b in result.get("blocking_edges", [])
        )
        maxes = "、".join(f"{k} 最大只到过 {v}" for k, v in result.get("max_seen", {}).items())
        text = f"这个结局触发不了：穷尽了 {result['states_explored']} 个可达状态，没有一条路能满足条件。"
        if edges:
            text += f"挡住它的是这些边：{edges}。"
        if maxes:
            text += f"整个搜索过程中，{maxes}——如果条件要求比这更高，就永远到不了。"
        return text
    return (
        f"下不了结论（UNKNOWN）：{result.get('reason', '')}。"
        f"已探索 {result['states_explored']} 个状态。"
        "注意 UNKNOWN 不等于通过——它只是说不确定，需要缩小变量范围或提高上限再看。"
    )
