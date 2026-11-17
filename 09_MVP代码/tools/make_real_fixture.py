# -*- coding: utf-8 -*-
"""用真实开源数据（PokeAPI 的 CSV）生成「真表」夹具。

为什么选它：
- 937 条招式、1351 只宝可梦、21 种属性，全部真实数值，不是我编的；
- 招式 identifier 带横杠（double-edge），点号路径和表达式都得扛；
- 大量空单元格（状态招式没有 power / accuracy）；
- moves.type_id → types 是真实的外键，正好测多跳。

用法：先把 CSV 下到 fixtures/real/（见 tests/test_real_fixture.py 的跳过逻辑），
再 ``python tools/make_real_fixture.py fixtures/真表_宝可梦数据.xlsx``
"""

from __future__ import annotations

import csv
from pathlib import Path

REAL_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "real"

#pokemon 只装前 300 只：体积和加载速度的权衡，全量 1351 行也没问题，只是没必要
POKEMON_LIMIT = 300


def _read(name: str) -> list[dict[str, str]]:
    file = REAL_DIR / name
    with file.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _coerce(value: str | None):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def build(path: str) -> str:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    types = _read("types.csv")
    moves = _read("moves.csv")
    pokemon = _read("pokemon.csv")[:POKEMON_LIMIT]

    wb = Workbook()
    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="17365D")

    def style(ws):
        for cell in ws[1]:
            cell.font = head_font
            cell.fill = head_fill
        ws.freeze_panes = "A2"

    ws = wb.active
    ws.title = "activity"
    ws.append(["字段", "值"])
    for key, value in [
        ("id", "ACT-REAL-01"),
        ("name", "宝可梦竞技场（真数据压测）"),
        ("server_open_days", 100),
        ("open_day_min", 30),
        ("server_population", 1000),
    ]:
        ws.append([key, value])
    style(ws)

    ws = wb.create_sheet("tiers")
    ws.append(["id", "name", "count", "count_mode"])
    ws.append(["T1", "入门组", 50, "fixed"])
    ws.append(["T2", "进阶组", 20, "fixed"])
    ws.append(["T3", "大师组", 5, "fixed"])
    style(ws)

    ws = wb.create_sheet("downstream")
    ws.append(["id", "name", "type", "owner", "refs", "note"])
    for row in [
        ("OBJ_MOVE_TYPE", "招式属性标签", "UI", "客户端", "moves.1.type.identifier、moves.25.type.identifier", "横杠 id"),
        ("OBJ_MOVE_INFO", "招式详情面板", "UI", "客户端", "moves.1.power、moves.1.pp、moves.1.accuracy", "accuracy 在部分招式上是空的"),
        ("OBJ_TYPE_LIST", "属性一览", "UI", "客户端", "types.1.identifier、types.2.identifier", ""),
        ("OBJ_POKEMON", "宝可梦图鉴条目", "UI", "客户端", "pokemon.1.identifier、pokemon.6.identifier", "妙蛙种子 / 喷火龙"),
    ]:
        ws.append(list(row))
    style(ws)

    def _sheet(name: str, rows: list[dict[str, str]], limit: int | None = None):
        ws = wb.create_sheet(name)
        chosen = rows if limit is None else rows[:limit]
        header = list(chosen[0].keys()) if chosen else ["id"]
        ws.append(header)
        for row in chosen:
            ws.append([_coerce(value) for value in row.values()])
        style(ws)

    _sheet("types", types)
    _sheet("moves", moves)
    _sheet("pokemon", pokemon)

    ws = wb.create_sheet("links")
    ws.append(["from", "to", "说明"])
    ws.append(["moves.type_id", "types", "招式表这一列存的是属性表的行 id"])
    style(ws)

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    wb.save(target)
    return target


if __name__ == "__main__":
    import sys

    print(build(sys.argv[1] if len(sys.argv) > 1 else "fixtures/真表_宝可梦数据.xlsx"))
