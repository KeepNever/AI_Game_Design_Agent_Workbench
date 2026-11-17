"""安全表达式求值。

配置里的规则条件写成表达式（如 ``tiers.T_HIGH.count == 1``），由这里求值。
**不使用 eval**：只放行白名单里的 AST 节点与函数，遇到其它语法直接报错。
这样规则文件可以被非程序员修改，也不会因为一条规则把整个进程交出去。
"""

from __future__ import annotations

import ast
import operator
import re
from typing import Any, Mapping


class ExprError(Exception):
    """表达式非法，或引用了不存在的字段。"""


_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_CMPOPS = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
    ast.Is: operator.is_,
    ast.IsNot: operator.is_not,
}

_UNARYOPS = {
    ast.Not: operator.not_,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

SAFE_FUNCS: dict[str, Any] = {
    "round": round,
    "abs": abs,
    "min": min,
    "max": max,
    "len": len,
    "int": int,
    "float": float,
    "all": all,
    "any": any,
    "bool": bool,
}


# Python 语法里 ``items.10086.name`` 不合法（10086 是数字字面量），
# ``moves.25.double-edge`` 也不合法（- 是减号）。
# 让写规则的人记两套写法更糟，所以统一预处理：段不是合法标识符就改下标。
_CHAIN = re.compile(r"\b([A-Za-z_]\w*)((?:\.[A-Za-z0-9_][\w-]*)+)")


def normalize(text: str) -> str:
    """``表.行ID.字段`` → ``表["行ID"].字段``；合法标识符的段保持点号不动。"""

    def _rewrite(match: "re.Match[str]") -> str:
        head, rest = match.group(1), match.group(2)
        segs = rest[1:].split(".")
        if all(seg.isidentifier() for seg in segs):
            return match.group(0)
        # 只把非法段改下标，合法段保留点号——输出可读性更好
        return head + "".join(
            f'["{seg}"]' if not seg.isidentifier() else f".{seg}" for seg in segs
        )

    return _CHAIN.sub(_rewrite, text)


def evaluate(expr: str, namespace: Mapping[str, Any]) -> Any:
    """对 ``expr`` 求值，变量从 ``namespace`` 里取（支持嵌套字典的点号访问）。"""
    if not isinstance(expr, str) or not expr.strip():
        raise ExprError("表达式为空")
    try:
        tree = ast.parse(normalize(expr), mode="eval")
    except SyntaxError as exc:  # 语法写错时给出人话
        raise ExprError(f"表达式语法错误：{expr!r}（{exc.msg}）") from exc
    return _eval(tree.body, namespace)


_LITERALS = {"true": True, "false": False, "null": None}


def _lookup(path: str, namespace: Mapping[str, Any], node: ast.AST) -> Any:
    if path in _LITERALS:
        # 设计者习惯写小写 true / false / null（配置语言风格），这里兼容
        return _LITERALS[path]
    if path in namespace:
        return namespace[path]
    head = path.split(".")[0]
    if head in namespace:
        raise ExprError(f"字段不存在：{path}")
    raise ExprError(f"未知变量：{head}（表达式里出现的名字必须来自配置或内置函数）")


def _eval(node: ast.AST, ns: Mapping[str, Any]) -> Any:
    if isinstance(node, ast.Constant):
        return node.value

    if isinstance(node, ast.Name):
        return _lookup(node.id, ns, node)

    if isinstance(node, ast.Attribute):
        base = _eval(node.value, ns)
        if isinstance(base, Mapping):
            if node.attr not in base:
                raise ExprError(f"字段不存在：{_dotted(node)}")
            return base[node.attr]
        raise ExprError(f"不能从 {type(base).__name__} 上取字段 .{node.attr}")

    if isinstance(node, ast.Subscript):
        base = _eval(node.value, ns)
        key = _eval(node.slice, ns)
        try:
            return base[key]
        except (KeyError, IndexError) as exc:
            raise ExprError(f"下标不存在：{_dotted(node)}") from exc

    if isinstance(node, ast.BinOp):
        op = _BINOPS.get(type(node.op))
        if op is None:
            raise ExprError(f"不支持的运算符：{type(node.op).__name__}")
        return op(_eval(node.left, ns), _eval(node.right, ns))

    if isinstance(node, ast.UnaryOp):
        op = _UNARYOPS.get(type(node.op))
        if op is None:
            raise ExprError(f"不支持的一元运算符：{type(node.op).__name__}")
        return op(_eval(node.operand, ns))

    if isinstance(node, ast.BoolOp):
        # 与 Python 一致：and/or 短路，返回值不是 bool 而是操作数
        if isinstance(node.op, ast.And):
            result: Any = True
            for value in node.values:
                result = _eval(value, ns)
                if not result:
                    return result
            return result
        result = False
        for value in node.values:
            result = _eval(value, ns)
            if result:
                return result
        return result

    if isinstance(node, ast.Compare):
        left = _eval(node.left, ns)
        for op_node, comparator in zip(node.ops, node.comparators):
            op = _CMPOPS.get(type(op_node))
            if op is None:
                raise ExprError(f"不支持的比较符：{type(op_node).__name__}")
            right = _eval(comparator, ns)
            if not op(left, right):
                return False
            left = right
        return True

    if isinstance(node, ast.IfExp):
        return _eval(node.body, ns) if _eval(node.test, ns) else _eval(node.orelse, ns)

    if isinstance(node, (ast.List, ast.Tuple)):
        return [_eval(item, ns) for item in node.elts]

    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in SAFE_FUNCS:
            raise ExprError(f"不允许调用：{_dotted(node.func)}")
        if node.keywords:
            raise ExprError("函数调用不支持关键字参数")
        args = [_eval(arg, ns) for arg in node.args]
        return SAFE_FUNCS[node.func.id](*args)

    raise ExprError(f"不支持的语法：{type(node).__name__}")


def _dotted(node: ast.AST) -> str:
    """把 AST 还原成点号路径，用于报错。"""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_dotted(node.value)}.{node.attr}"
    if isinstance(node, ast.Subscript):
        return f"{_dotted(node.value)}[...]"
    if isinstance(node, ast.Call):
        return f"{_dotted(node.func)}(...)"
    return type(node).__name__
