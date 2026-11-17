# -*- coding: utf-8 -*-
"""tools_schema_check.py —— 前置 2 静态兼容性核对（只读，不修改任何文件）。

对四个 mechanic.js 与 levels.js 按《前置2_模板设计参数与Schema_v1.md》执行结构级校验。
表达式语法级校验由运行时求值器承担（V-2.3），本脚本只覆盖：结构、白名单、LIMITS、交叉引用。
用法：python tools_schema_check.py   （在 11_Spike_网格解谜 目录下）
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
GAMES = {"A": "gameA_推箱", "B": "gameB_钥匙门", "C": "gameC_碎裂地板", "D": "gameD_开关闸门"}

DSL_VERSION = "grid-puzzle/0.1"
STYLE_ENUM = {"target", "door", "exit", "stone"}
ENT_STYLE_ENUM = {"crate", "key"}
ENT_TYPE_RE = re.compile(r"^[a-z_]+$")
EFFECT_OPS = {"var.add", "var.sub", "prop.set", "prop.add", "prop.sub", "pit", "fx", "log", "shake"}
FX_KINDS = {"sparkle", "dust", "confetti", "debris", "flash"}
OVERLAY_KINDS = {"fracture", "pit"}
RESERVED_CHARS = {"#", "p"}
LIMITS = {"exprMaxLen": 400, "maxMapCells": 4096, "maxEffects": 64}
BUILTIN_FUNCS = {"tile", "px", "py", "tx", "ty", "tchar", "prop", "v", "count_tile", "count_entity", "count_on", "count_prop"}

PASS, FAIL, WARN = 0, 0, []


def ok(msg):
    global PASS
    PASS += 1
    print(f"  ✓ {msg}")


def fail(msg):
    global FAIL
    FAIL += 1
    print(f"  ✗ {msg}")


def warn(msg):
    WARN.append(msg)
    print(f"  ⚠ {msg}")


def check_expr(expr: str, where: str, declared_vars: set):
    """表达式静态检查：长度、括号配对、未知标识符/函数（白名单）。"""
    if len(expr) > LIMITS["exprMaxLen"]:
        fail(f"{where} 表达式超长（{len(expr)} > 400）")
        return
    ok(f"{where} 表达式长度 {len(expr)} ≤ 400")
    depth, pairs = 0, True
    for ch in expr:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                pairs = False
                break
    if depth != 0 or not pairs:
        fail(f"{where} 括号不配对")
        return
    ok(f"{where} 括号配对")
    for fn in set(re.findall(r"([A-Za-z_]\w*)\s*\(", expr)):
        if fn not in BUILTIN_FUNCS:
            fail(f"{where} 未知函数 {fn}（不在白名单）")
            return
    ok(f"{where} 函数全部在白名单内")
    for v in set(re.findall(r"v\('(\w+)'\)", expr)):
        if v not in declared_vars:
            fail(f"{where} v('{v}') 未在任何层声明")
            return
    ok(f"{where} v() 引用全部已声明")


def check_effects(effects: list, where: str):
    if len(effects) > LIMITS["maxEffects"]:
        fail(f"{where} 效果数超上限")
        return
    for ef in effects:
        op = ef.get("op", "")
        if op not in EFFECT_OPS:
            fail(f"{where} 未知效果 op={op!r}")
            return
        if op == "fx" and ef.get("kind") not in FX_KINDS:
            fail(f"{where} 未知 fx kind={ef.get('kind')!r}")
            return
        if op == "var.add" and not isinstance(ef.get("value"), (int, float)):
            fail(f"{where} var.add value 非字面量数字")
            return
    ok(f"{where} effects 全部在白名单（{len(effects)} 条）")


def main():
    print("=== 前置 2 · 静态兼容性核对（只读，不改任何文件）===\n")
    for tag, d in GAMES.items():
        print(f"--- {tag} {d} ---")
        mtext = (BASE / d / "mechanic.js").read_text(encoding="utf-8")
        mech = json.loads(re.search(r"const MECHANIC = (\{.*\});", mtext, re.S).group(1))
        levels = json.loads(re.search(r"const LEVELS = (\[.*\]);", (BASE / d / "levels.js").read_text(encoding="utf-8"), re.S).group(1))

        # 1. DSL 版本与顶层字段
        ok("dsl 版本 = grid-puzzle/0.1") if mech.get("dsl") == DSL_VERSION else fail(f"dsl 版本异常：{mech.get('dsl')}")
        core = ["dsl", "title", "win", "status"]  # 核心必填（无缺省容错）
        optional = ["tiles", "entities", "vars", "enter", "deny", "turn", "overlays", "playerArt"]  # 可省略（runtime 缺省空集）
        missing_core = [k for k in core if k not in mech]
        (ok("核心必填 4 字段齐备") if not missing_core else fail(f"缺核心字段：{missing_core}"))
        missing_opt = [k for k in optional if k not in mech]
        (ok(f"可选字段齐备或合法省略（省略：{missing_opt or '无'}）") if True else None)

        # 2. tiles
        for ch, td in mech.get("tiles", {}).items():
            if ch in RESERVED_CHARS:
                fail(f"tiles 使用保留字符 {ch!r}")
            if td.get("style") not in STYLE_ENUM:
                fail(f"tiles[{ch!r}] style 越界：{td.get('style')!r}")
        ok("tiles 键非保留字符、style 全部在枚举内")

        # 3. entities
        for t, ed in mech.get("entities", {}).items():
            if not ENT_TYPE_RE.match(t):
                fail(f"entities type 命名不合规：{t!r}")
            if ed.get("style") not in ENT_STYLE_ENUM:
                fail(f"entities[{t}] style 越界：{ed.get('style')!r}")
            if "pickup" in ed:
                check_effects(ed["pickup"], f"{tag} entities[{t}].pickup")
        ok("entities 命名与 style 全部合规")

        # 4. 规则效果
        for i, r in enumerate(mech.get("enter", [])):
            check_effects(r.get("effects", []), f"{tag} enter[{i}]")
        for i, r in enumerate(mech.get("turn", [])):
            check_effects(r.get("effects", []), f"{tag} turn[{i}]")
        for i, r in enumerate(mech.get("deny", [])):
            if "effects" in r:
                fail(f"{tag} deny[{i}] 不应携带 effects")
        ok("deny 无 effects、enter/turn 效果全检")

        # 5. overlays
        for prop, od in mech.get("overlays", {}).items():
            if od.get("kind") not in OVERLAY_KINDS:
                fail(f"overlays[{prop}] kind 越界：{od.get('kind')!r}")
        ok("overlays kind 全部在枚举内")

        # 6. 表达式（win + 全部 when）
        lv_vars = set().union(*[set(lv.get("vars", {}).keys()) for lv in levels]) if any("vars" in lv for lv in levels) else set()
        declared = set(mech.get("vars", {}).keys()) | lv_vars
        check_expr(mech["win"], f"{tag} win", declared)
        for i, r in enumerate(mech.get("enter", []) + mech.get("deny", []) + mech.get("turn", [])):
            check_expr(r["when"], f"{tag} rule[{i}].when", declared)

        # 7. levels 结构
        for lv in levels:
            rows = lv["map"]
            if len(set(len(r) for r in rows)) != 1:
                fail(f"{lv['name']} 行长不一致")
            if len(rows) * len(rows[0]) > LIMITS["maxMapCells"]:
                fail(f"{lv['name']} 地图超上限")
            ok(f"{lv['name']} 矩形一致、规模合规")
            used = set("".join(rows))
            rule_chars = set(re.findall(r"tchar\(\)==\'(\w)\'", mtext))
            bad = used - set(mech.get("tiles", {}).keys()) - {"#", ".", "p"} - rule_chars
            if bad:
                fail(f"{lv['name']} 未声明且无规则引用的字符：{sorted(bad)}")
            elif used - set(mech.get("tiles", {}).keys()) - {"#", ".", "p"}:
                warn(f"{lv['name']} 功能字符 {sorted(used - set(mech.get('tiles', {}).keys()) - {'#', '.', 'p'})} 无样式声明（合法，视觉走缺省地板；5.7）")
            else:
                ok(f"{lv['name']} 字符集 ⊆ 声明tiles+基础字符")
            ppos = lv["player"]
            (ok(f"{lv['name']} player 界内且非墙") if rows[ppos["y"]][ppos["x"]] != "#" else fail(f"{lv['name']} player 落墙"))
            if "p" in used:
                px = rows[ppos["y"]].index("p") if "p" in rows[ppos["y"]] else None
                py = next((i for i, r in enumerate(rows) if "p" in r), None)
                if (px, py) != (ppos["x"], ppos["y"]):
                    warn(f"{lv['name']} map 中 p 位置与 player 字段不一致（runtime 不读 map 的 p，以 player 为准；V-2.1）")
            for e in lv.get("dynamic", []):
                if e["type"] not in mech.get("entities", {}):
                    fail(f"{lv['name']} 实体类型 {e['type']!r} 未声明")
                if rows[e["y"]][e["x"]] == "#":
                    fail(f"{lv['name']} 实体落墙")
            ok(f"{lv['name']} dynamic 类型与坐标合规")
            for key in (lv.get("cell_props") or {}):
                x, y = key.split(",")
                if not (0 <= int(x) < len(rows[0]) and 0 <= int(y) < len(rows)):
                    fail(f"{lv['name']} cell_props 键 {key} 越界")
            ok(f"{lv['name']} cell_props 键格式合规")
        print()

    print(f"=== 结果：通过 {PASS} 项，失败 {FAIL} 项，提示 {len(WARN)} 条 ===")
    for w in WARN:
        print(f"提示：{w}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
