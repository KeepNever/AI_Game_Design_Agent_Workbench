# -*- coding: utf-8 -*-
"""网格解谜可解性验证器（Spike 专用，按实际适用范围执行）。

为什么不用 Q013：Q013 验证的是「任务图 + 已建模变量条件」下的路径可满足性，
不适用于网格关卡的移动/推动/门锁机制——按曦的 MU-3 修订，网格解谜的关卡规则
与可解性由本验证器单独承担：对每个关卡做状态空间穷举（BFS），
输出 可解/不可解 + 最少步数 + 一条解法路径（路径供运行时 autoplay 重放，交叉验证）。

用法：python validate_levels.py   （在 11_Spike_网格解谜 目录下）
"""
from __future__ import annotations

import json
import re
from collections import deque
from pathlib import Path

BASE = Path(__file__).resolve().parent
DIRS = {"U": (0, -1), "D": (0, 1), "L": (-1, 0), "R": (1, 0)}


def load_levels(levels_js: Path) -> list[dict]:
    text = levels_js.read_text(encoding="utf-8")
    match = re.search(r"const LEVELS = (\[.*\]);", text, re.S)
    if not match:
        raise SystemExit(f"解析失败：{levels_js}")
    return json.loads(match.group(1))


def reconstruct(parent: dict, start, end) -> str:
    path = []
    cur = end
    while cur != start:
        prev, move = parent[cur]
        path.append(move)
        cur = prev
    return "".join(reversed(path))


def solve_sokoban(level: dict, max_states: int = 200_000) -> dict:
    """推箱：状态 = (玩家位置, 箱子位置集合)。推动规则与 gameA rules.js 完全一致。"""
    walls = {(x, y) for y, row in enumerate(level["map"]) for x, ch in enumerate(row) if ch == "#"}
    targets = {(x, y) for y, row in enumerate(level["map"]) for x, ch in enumerate(row) if ch == "o"}
    boxes = frozenset((b["x"], b["y"]) for b in level["dynamic"])
    start = ((level["player"]["x"], level["player"]["y"]), boxes)
    if len(targets) != len(boxes):
        return {"solvable": False, "reason": f"目标数 {len(targets)} ≠ 箱子数 {len(boxes)}"}

    seen = {start}
    parent: dict = {}
    q = deque([start])
    while q:
        state = q.popleft()
        (px, py), bxs = state
        if bxs == frozenset(targets):
            return {"solvable": True, "steps": len(reconstruct(parent, start, state)), "path": reconstruct(parent, start, state)}
        for mv, (dx, dy) in DIRS.items():
            n = (px + dx, py + dy)
            if n in walls:
                continue
            if n in bxs:
                nb = (n[0] + dx, n[1] + dy)
                if nb in walls or nb in bxs:
                    continue
                nboxes = (bxs - {n}) | {nb}
                nstate = (n, frozenset(nboxes))
            else:
                nstate = (n, bxs)
            if nstate in seen:
                continue
            seen.add(nstate)
            parent[nstate] = (state, mv)
            if len(seen) > max_states:
                return {"solvable": None, "reason": f"超过状态上限 {max_states}（等价 UNKNOWN，不算通过）"}
            q.append(nstate)
    return {"solvable": False, "reason": "穷尽全部可达状态，无解（UNSAT）"}


def solve_keydoor(level: dict, max_states: int = 200_000) -> dict:
    """钥匙门：状态 = (玩家位置, 已收集钥匙集合)。收集/门锁/出口解锁规则与 gameB rules.js 完全一致。"""
    walls = {(x, y) for y, row in enumerate(level["map"]) for x, ch in enumerate(row) if ch == "#"}
    doors = {}
    for key, props in (level.get("cell_props") or {}).items():
        if "door_need" in props:
            x, y = key.split(",")
            doors[(int(x), int(y))] = props["door_need"]
    keys = {(k["x"], k["y"]) for k in level["dynamic"] if k.get("type") == "key"}
    exits = {(x, y) for y, row in enumerate(level["map"]) for x, ch in enumerate(row) if ch == "E"}
    if not exits:
        return {"solvable": False, "reason": "关卡没有出口"}
    exit_pos = next(iter(exits))
    # 交叉核对：doors 定义应与 map 中 'D' 位置一致
    map_doors = {(x, y) for y, row in enumerate(level["map"]) for x, ch in enumerate(row) if ch == "D"}
    if map_doors != set(doors):
        return {"solvable": False, "reason": f"doors 定义 {sorted(doors)} 与 map 中 D 位置 {sorted(map_doors)} 不一致"}

    start = ((level["player"]["x"], level["player"]["y"]), frozenset())
    seen = {start}
    parent: dict = {}
    q = deque([start])
    while q:
        state = q.popleft()
        (px, py), got = state
        if (px, py) == exit_pos and len(got) == len(keys):
            return {"solvable": True, "steps": len(reconstruct(parent, start, state)), "path": reconstruct(parent, start, state)}
        for mv, (dx, dy) in DIRS.items():
            n = (px + dx, py + dy)
            if n in walls:
                continue
            if n in doors and len(got) < doors[n]:
                continue  # 门锁着
            ngot = got | {n} if n in keys else got
            if n == exit_pos and len(ngot) < len(keys):
                continue  # 出口未解锁
            nstate = (n, frozenset(ngot))
            if nstate in seen:
                continue
            seen.add(nstate)
            parent[nstate] = (state, mv)
            if len(seen) > max_states:
                return {"solvable": None, "reason": f"超过状态上限 {max_states}（等价 UNKNOWN，不算通过）"}
            q.append(nstate)
    return {"solvable": False, "reason": "穷尽全部可达状态，无解（UNSAT）"}


def solve_crumble(level: dict, max_states: int = 400_000) -> dict:
    """碎裂地板：状态 = (玩家位置, 开裂中格子及倒计时, 已碎裂格子)。

    语义与 gameC/mechanic.js（DSL）逐条一致：
    - 踏入 '.' 格且未开裂未碎裂 → 开裂 timer=2；
    - 每回合：timer==2 且无人 → 变 1；timer==1 且无人 → 碎裂成洞；
      玩家所在格暂停（不倒计时）；
    - 洞不可进入；'S' 实心石板与 'E' 出口不开裂；
    - 玩家到达 'E' 获胜。
    """
    walls = {(x, y) for y, row in enumerate(level["map"]) for x, ch in enumerate(row) if ch == "#"}
    exits = {(x, y) for y, row in enumerate(level["map"]) for x, ch in enumerate(row) if ch == "E"}
    if not exits:
        return {"solvable": False, "reason": "关卡没有出口"}
    exit_pos = next(iter(exits))
    crackable = {(x, y) for y, row in enumerate(level["map"]) for x, ch in enumerate(row) if ch == "."}

    start = ((level["player"]["x"], level["player"]["y"]), frozenset(), frozenset())
    seen = {start}
    parent: dict = {}
    q = deque([start])
    while q:
        state = q.popleft()
        (px, py), cracked, crumbled = state
        if (px, py) == exit_pos:
            return {"solvable": True, "steps": len(reconstruct(parent, start, state)), "path": reconstruct(parent, start, state)}
        for mv, (dx, dy) in DIRS.items():
            n = (px + dx, py + dy)
            if n in walls or n in crumbled:
                continue
            n_cracked = set()
            n_crumbled = set(crumbled)
            for (cx, cy, t) in cracked:
                if (cx, cy) == n:
                    n_cracked.add((cx, cy, t))      # 玩家所在格：暂停
                elif t == 2:
                    n_cracked.add((cx, cy, 1))
                else:  # t == 1
                    n_crumbled.add((cx, cy))
            if n in crackable and not any((cx, cy) == n for cx, cy, _ in n_cracked) and n not in n_crumbled:
                n_cracked.add((n[0], n[1], 2))
            nstate = (n, frozenset(n_cracked), frozenset(n_crumbled))
            if nstate in seen:
                continue
            seen.add(nstate)
            parent[nstate] = (state, mv)
            if len(seen) > max_states:
                return {"solvable": None, "reason": f"超过状态上限 {max_states}（等价 UNKNOWN，不算通过）"}
            q.append(nstate)
    return {"solvable": False, "reason": "穷尽全部可达状态，无解（UNSAT）——碎裂把路断死了"}


def solve_switchgate(level: dict, max_states: int = 200_000) -> dict:
    """开关闸门（Brief D）：状态 = (玩家位置, ga, gb)，ga/gb ∈ {0,1}。

    语义按 Brief 独立建模（不读 mechanic.js，靠与 DSL 运行时交叉验证对齐）：
    - 'G' 在 ga==0 时拒绝进入；'H' 在 gb==0 时拒绝进入（关着的闸门不可通行）；
    - 进入 'a' → ga=1（开门踏板，闩锁）；进入 'x' → ga=0（关门踏板，闩锁）；
      同理 'b'→gb=1、'y'→gb=0；
    - 「踩到」= 进入该格这一事件；已在目标状态时再踩无效果；
    - 玩家到达 'E' 获胜。闸门关闭不挤压已在其上的玩家（只影响进入）。
    """
    grid = level["map"]
    walls = {(x, y) for y, row in enumerate(grid) for x, ch in enumerate(row) if ch == "#"}
    exits = {(x, y) for y, row in enumerate(grid) for x, ch in enumerate(row) if ch == "E"}
    if not exits:
        return {"solvable": False, "reason": "关卡没有出口"}
    exit_pos = next(iter(exits))

    def toggle(ch: str, ga: int, gb: int):
        if ch == "a":
            return 1, gb
        if ch == "x":
            return 0, gb
        if ch == "b":
            return ga, 1
        if ch == "y":
            return ga, 0
        return ga, gb

    sx, sy = level["player"]["x"], level["player"]["y"]
    start = ((sx, sy), 0, 0)  # 所有闸门初始关闭
    seen = {start}
    parent: dict = {}
    q = deque([start])
    while q:
        state = q.popleft()
        (px, py), ga, gb = state
        if (px, py) == exit_pos:
            return {"solvable": True, "steps": len(reconstruct(parent, start, state)), "path": reconstruct(parent, start, state)}
        for mv, (dx, dy) in DIRS.items():
            n = (px + dx, py + dy)
            ch = (grid[n[1]] or "")[n[0]] if 0 <= n[1] < len(grid) and 0 <= n[0] < len(grid[n[1]]) else "#"
            if ch == "#":
                continue
            if ch == "G" and ga == 0:
                continue  # 关着的闸门
            if ch == "H" and gb == 0:
                continue
            nga, ngb = toggle(ch, ga, gb)
            nstate = (n, nga, ngb)
            if nstate in seen:
                continue
            seen.add(nstate)
            parent[nstate] = (state, mv)
            if len(seen) > max_states:
                return {"solvable": None, "reason": f"超过状态上限 {max_states}（等价 UNKNOWN，不算通过）"}
            q.append(nstate)
    return {"solvable": False, "reason": "穷尽全部可达状态，无解（UNSAT）"}


def main():
    print("=== 可解性验证（Spike 专用验证器，非 Q013）===\n")

    results = {"sokoban": [], "keydoor": [], "crumble": [], "switchgate": []}
    for name, solver in (("gameA_推箱", solve_sokoban), ("gameB_钥匙门", solve_keydoor), ("gameC_碎裂地板", solve_crumble), ("gameD_开关闸门", solve_switchgate)):
        levels = load_levels(BASE / name / "levels.js")
        print(f"--- {name} ---")
        for i, level in enumerate(levels, 1):
            r = solver(level)
            tag = "可解" if r.get("solvable") else ("UNKNOWN" if r.get("solvable") is None else "不可解")
            line = f"  第{i}关「{level['name']}」：{tag}"
            if r.get("solvable"):
                line += f" · 最少 {r['steps']} 步 · 解法路径（供 autoplay 重放）：{r['path']}"
            elif "reason" in r:
                line += f" · {r['reason']}"
            print(line)
            key = {"gameA_推箱": "sokoban", "gameB_钥匙门": "keydoor", "gameC_碎裂地板": "crumble", "gameD_开关闸门": "switchgate"}[name]
            results[key].append(r)
        print()

    out = BASE / "验证结果.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[已写入 {out.name}]（autoplay 路径从这里取）")


if __name__ == "__main__":
    main()
