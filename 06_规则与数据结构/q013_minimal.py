# -*- coding: utf-8 -*-
"""
Q013 任务路径条件可满足性 —— 最小可运行原型

对应文档 12.5「两层校验：图可达与条件可满足」：
  - 第一层 Q005：图结构可达（本文件顺带验证）
  - 第二层 Q013：是否存在一组合法状态，使路径上所有条件同时成立

输出三态：
  SAT     —— 存在一条可触发的路径（附路径与沿途状态）
  UNSAT   —— 穷尽搜索后确认不存在（附阻断原因）
  UNKNOWN —— 状态数超过上限，无法下结论（附触顶信息，绝不降级为 SAT）

设计约束（对应 12.5 的数据规约）：
  1. 每个变量必须显式声明类型与定义域，越界视为非法转移而非静默截断
  2. 一条边允许包含多个原子状态变更
  3. 搜索状态上限固定，触顶返回 UNKNOWN

无外部依赖，直接运行：python3 q013_minimal.py
"""

import ast
from typing import Any, Dict, List, Optional, Tuple

# ----------------------------------------------------------------------------
# 一、数据结构
# ----------------------------------------------------------------------------

VarDef = Dict[str, Any]   # {"type":"int"|"bool","min":0,"max":3,"init":0}


class DomainViolation(Exception):
    """变量越界：动作把变量推出了定义域。规约要求显式报错，不允许静默截断。"""


def initial_state(variables: Dict[str, VarDef]) -> Tuple[Tuple[str, Any], ...]:
    return tuple((name, spec["init"]) for name, spec in variables.items())


def as_env(state: Tuple[Tuple[str, Any], ...]) -> Dict[str, Any]:
    return dict(state)


def apply_actions(state, actions, variables):
    """在副本上依次执行动作，返回新状态。多动作按声明顺序执行。"""
    env = as_env(state)
    for act in actions:
        var, op, val = act["var"], act["op"], act.get("value")
        if var not in variables:
            raise KeyError(f"动作引用了未声明的变量：{var}")
        spec = variables[var]
        if op == "set":
            env[var] = val
        elif op == "+=":
            env[var] = env[var] + val
        elif op == "-=":
            env[var] = env[var] - val
        elif op == "*=":
            env[var] = env[var] * val
        else:
            raise ValueError(f"不支持的动作算子：{op}")

        # 定义域校验
        if spec["type"] == "bool":
            if not isinstance(env[var], bool):
                raise DomainViolation(f"{var} 是布尔变量，被赋成 {env[var]!r}")
        else:
            lo, hi = spec["min"], spec["max"]
            if not (lo <= env[var] <= hi):
                raise DomainViolation(
                    f"{var} 越界：{env[var]} 不在 [{lo},{hi}] 内"
                )
    return tuple((name, env[name]) for name in variables)


# ----------------------------------------------------------------------------
# 二、条件表达式（AST 白名单求值，不使用 eval）
# ----------------------------------------------------------------------------

_ALLOWED = (
    ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.Not,
    ast.Compare, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
    ast.Name, ast.Load, ast.Constant, ast.BinOp, ast.Add, ast.Sub, ast.USub,
)


class ConditionError(Exception):
    pass


def compile_condition(expr: str) -> ast.Expression:
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise ConditionError(f"条件写法有误：{expr}（{e}）")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED):
            raise ConditionError(
                f"条件中出现了不允许的语法：{type(node).__name__}（{expr}）"
            )
    return tree


def _cmp(op, left, right) -> bool:
    if isinstance(op, ast.Eq):
        return left == right
    if isinstance(op, ast.NotEq):
        return left != right
    if isinstance(op, ast.Lt):
        return left < right
    if isinstance(op, ast.LtE):
        return left <= right
    if isinstance(op, ast.Gt):
        return left > right
    if isinstance(op, ast.GtE):
        return left >= right
    raise ConditionError(f"不支持的比较符：{type(op).__name__}")


def _eval(node, env):
    if isinstance(node, ast.Expression):
        return _eval(node.body, env)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in env:
            raise ConditionError(f"条件引用了未声明的变量：{node.id}")
        return env[node.id]
    if isinstance(node, ast.BoolOp):
        vals = [_eval(v, env) for v in node.values]
        return all(vals) if isinstance(node.op, ast.And) else any(vals)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return not _eval(node.operand, env)
    if isinstance(node, ast.Compare):
        left = _eval(node.left, env)
        for op, comp in zip(node.ops, node.comparators):
            right = _eval(comp, env)
            if not _cmp(op, left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.BinOp):
        l, r = _eval(node.left, env), _eval(node.right, env)
        if isinstance(node.op, ast.Add):
            return l + r
        if isinstance(node.op, ast.Sub):
            return l - r
    raise ConditionError(f"无法求值的表达式：{ast.dump(node)}")


def eval_condition(tree, env) -> bool:
    return bool(_eval(tree, env))


# ----------------------------------------------------------------------------
# 三、搜索
# ----------------------------------------------------------------------------

class Result:
    SAT, UNSAT, UNKNOWN = "SAT", "UNSAT", "UNKNOWN"


class QuestChecker:
    def __init__(self, variables, nodes, edges, start, targets, state_limit=50000):
        self.variables = variables
        self.nodes = nodes
        self.edges = edges
        self.start = start
        self.targets = set(targets) if not isinstance(targets, str) else {targets}
        self.state_limit = state_limit

        # 预编译条件
        self._compiled = {}
        for e in edges:
            self._compiled[id(e)] = compile_condition(e.get("cond", "True"))
        # 出边索引
        self.out = {n: [] for n in nodes}
        for e in edges:
            self.out.setdefault(e["from"], []).append(e)

    def check(self):
        init = initial_state(self.variables)
        stack = [(self.start, init, [self.start])]
        visited = set()
        explored = 0
        edge_used = set()
        max_seen = {k: v["init"] for k, v in self.variables.items()}
        hit_limit = False
        merged = []   # 合并过的状态，用于诊断不可满足条件

        while stack:
            node, state, path = stack.pop()
            key = (node, state)
            if key in visited:
                continue
            visited.add(key)
            explored += 1

            env = as_env(state)
            for k, v in env.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    max_seen[k] = max(max_seen[k], v)

            if node in self.targets:
                return {
                    "result": Result.SAT,
                    "path": path,
                    "states_explored": explored,
                    "final_state": env,
                }

            if explored > self.state_limit:
                hit_limit = True
                break

            for e in self.out.get(node, []):
                try:
                    ok = eval_condition(self._compiled[id(e)], env)
                except ConditionError:
                    raise
                if not ok:
                    continue
                try:
                    nxt = apply_actions(state, e.get("actions", []), self.variables)
                except DomainViolation:
                    # 越界动作视为非法转移，剪掉；但记录下来用于诊断
                    merged.append((e["to"], e.get("cond", ""), "域越界"))
                    continue
                edge_used.add(id(e))
                stack.append((e["to"], nxt, path + [e["to"]]))

        if hit_limit:
            return {
                "result": Result.UNKNOWN,
                "reason": f"状态数超过上限 {self.state_limit}，无法穷尽",
                "states_explored": explored,
                "max_seen": max_seen,
            }

        # UNSAT：诊断哪条入边从未被满足
        blocking = []
        for t in self.targets:
            for e in self.edges:
                if e["to"] == t and id(e) not in edge_used:
                    blocking.append({
                        "edge": f'{e["from"]} → {e["to"]}',
                        "condition": e.get("cond", "True"),
                        "max_seen": {k: max_seen[k] for k in max_seen},
                    })
        return {
            "result": Result.UNSAT,
            "reason": "穷尽所有可达状态，目标节点不可达",
            "blocking_edges": blocking,
            "states_explored": explored,
            "max_seen": max_seen,
        }


# ----------------------------------------------------------------------------
# 四、四个单元用例（对应文档 12.5 的验收要求）
# ----------------------------------------------------------------------------

CASES = []

# 用例 1：存在合法路径 → SAT
CASES.append(dict(
    name="用例1 存在合法路径",
    expect="SAT",
    variables={
        "clue_count": {"type": "int", "min": 0, "max": 3, "init": 0},
        "secret_revealed": {"type": "bool", "init": False},
        "player_trust": {"type": "int", "min": 0, "max": 5, "init": 1},
    },
    nodes=["start", "n1", "n2", "hidden_end"],
    edges=[
        {"from": "start", "to": "n1", "actions": [{"var": "clue_count", "op": "+=", "value": 1}]},
        {"from": "n1", "to": "n2", "actions": [{"var": "clue_count", "op": "+=", "value": 1}]},
        {"from": "n2", "to": "hidden_end",
         "cond": "clue_count >= 2 and not secret_revealed and player_trust >= 1"},
    ],
    start="start", targets=["hidden_end"],
))

# 用例 2：条件不可满足 → UNSAT（线索上限不够）
CASES.append(dict(
    name="用例2 路径条件不可满足",
    expect="UNSAT",
    variables={
        "clue_count": {"type": "int", "min": 0, "max": 1, "init": 0},   # 上限只有 1
        "secret_revealed": {"type": "bool", "init": False},
        "player_trust": {"type": "int", "min": 0, "max": 5, "init": 1},
    },
    nodes=["start", "n1", "n2", "hidden_end"],
    edges=[
        {"from": "start", "to": "n1", "actions": [{"var": "clue_count", "op": "+=", "value": 1}]},
        {"from": "n1", "to": "n2", "actions": [{"var": "clue_count", "op": "+=", "value": 1}]},
        {"from": "n2", "to": "hidden_end",
         "cond": "clue_count >= 2 and not secret_revealed"},
    ],
    start="start", targets=["hidden_end"],
))

# 用例 3：状态爆炸 → UNKNOWN（上限调小以复现）
# 三个变量各自独立增长，组合数 = 11 × 16 × 31 ≈ 5456，超过上限 200
CASES.append(dict(
    name="用例3 触发搜索上限",
    expect="UNKNOWN",
    variables={
        "a": {"type": "int", "min": 0, "max": 30, "init": 0},
        "b": {"type": "int", "min": 0, "max": 30, "init": 0},
        "c": {"type": "int", "min": 0, "max": 30, "init": 0},
    },
    nodes=["s", "p", "inc_a", "inc_b", "inc_c", "end"],
    edges=[
        {"from": "s", "to": "p"},
        # 从 p 出发三条互斥的选择，各自只增长一个变量 → 组合爆炸
        {"from": "p", "to": "inc_a", "actions": [{"var": "a", "op": "+=", "value": 3}]},
        {"from": "p", "to": "inc_b", "actions": [{"var": "b", "op": "+=", "value": 2}]},
        {"from": "p", "to": "inc_c", "actions": [{"var": "c", "op": "+=", "value": 1}]},
        {"from": "inc_a", "to": "p"},
        {"from": "inc_b", "to": "p"},
        {"from": "inc_c", "to": "p"},
        {"from": "p", "to": "end", "cond": "a > 1000"},   # 永远不可能满足
    ],
    start="s", targets=["end"], state_limit=200,
))

# 用例 4：单边多变量变更 → 仍应正确判定
CASES.append(dict(
    name="用例4 单边多变量变更",
    expect="SAT",
    variables={
        "clue_count": {"type": "int", "min": 0, "max": 3, "init": 0},
        "player_trust": {"type": "int", "min": 0, "max": 5, "init": 1},
        "secret_revealed": {"type": "bool", "init": False},
    },
    nodes=["start", "n1", "end"],
    edges=[
        # 一条边同时改两个变量
        {"from": "start", "to": "n1",
         "actions": [{"var": "clue_count", "op": "+=", "value": 1},
                     {"var": "player_trust", "op": "+=", "value": 2}]},
        {"from": "n1", "to": "end",
         "cond": "clue_count >= 1 and player_trust >= 3 and not secret_revealed"},
    ],
    start="start", targets=["end"],
))


def run_case(case):
    checker = QuestChecker(
        case["variables"], case["nodes"], case["edges"],
        case["start"], case["targets"], case.get("state_limit", 50000),
    )
    out = checker.check()
    ok = out["result"] == case["expect"]
    print(f"\n{'='*66}")
    print(f'{case["name"]}    期望 {case["expect"]} → 实际 {out["result"]}    {"✓ 通过" if ok else "✗ 不符"}')
    print(f'  探索状态数：{out["states_explored"]}')
    if out["result"] == Result.SAT:
        print(f'  路径：{" → ".join(out["path"])}')
        print(f'  终态：{out["final_state"]}')
    elif out["result"] == Result.UNSAT:
        print(f'  原因：{out["reason"]}')
        for b in out.get("blocking_edges", []):
            print(f'  阻断边：{b["edge"]}  条件：{b["condition"]}')
        print(f'  各变量观测到的最大值：{out["max_seen"]}')
    else:
        print(f'  原因：{out["reason"]}')
        print(f'  触顶时观测到的最大值：{out["max_seen"]}')
    return ok


def main():
    print("Q013 任务路径条件可满足性 · 最小原型")
    print("三态判定：SAT / UNSAT / UNKNOWN（UNKNOWN 不等于通过）")
    passed = sum(1 for c in CASES if run_case(c))
    print(f"\n{'='*66}")
    print(f"合计：{passed}/{len(CASES)} 通过")
    return 0 if passed == len(CASES) else 1


if __name__ == "__main__":
    raise SystemExit(main())
