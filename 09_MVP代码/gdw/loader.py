"""配置加载：JSON / YAML / Excel 三种入口。

Excel 是真实场景里最常见的载体（策划发的就是 xlsx），所以这里按「一本配置簿」
的形态读多张表：activity（键值）/ tiers（档位表）/ downstream（下游对象表）/
derived（派生字段表，可选）。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

SUPPORTED = {".json", ".yaml", ".yml", ".xlsx", ".xlsm"}


class LoadError(Exception):
    pass


def load(path: str | Path) -> dict[str, Any]:
    file = Path(path)
    if not file.exists():
        raise LoadError(f"文件不存在：{file}")
    suffix = file.suffix.lower()
    if suffix not in SUPPORTED:
        raise LoadError(f"不支持的格式：{suffix}（支持 {'/'.join(sorted(SUPPORTED))}）")
    if suffix == ".json":
        return json.loads(file.read_text(encoding="utf-8"))
    if suffix in {".yaml", ".yml"}:
        import yaml  # 延迟导入：只用 JSON 的人不需要装 pyyaml

        data = yaml.safe_load(file.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise LoadError("YAML 根节点必须是映射（mapping）")
        return data
    return _load_xlsx(file)


def load_rules(path: str | Path) -> list[dict[str, Any]]:
    data = load(path)
    if isinstance(data, list):
        return data
    rules = data.get("rules")
    if not isinstance(rules, list):
        raise LoadError("规则文件里必须有 rules 数组")
    return rules


# ---------- Excel ----------

# 脏表的现实形态：合并单元格大标题、表头不在第一行、表头中英文混排、数字存成文本。
# 所以这里不做「第一行就是表头」的假设，而是扫描前 10 行找表头。

_TIER_COLUMNS = ("id", "name", "ratio", "count", "declared_count", "count_mode", "population_ratio")
_DOWNSTREAM_COLUMNS = ("id", "name", "type", "owner", "refs", "note")

_ID_HEADERS = {"id", "档位id", "对象id", "道具id", "掉落组id", "行id", "编号", "key"}
_KEY_HEADERS = {"字段", "键", "key", "参数", "项目"}
_VALUE_HEADERS = {"值", "value"}
_DERIVED_HEADERS = {"path", "字段路径", "派生字段"}
_FROM_HEADERS = {"from", "来源", "来源字段"}
_TO_HEADERS = {"to", "目标", "目标表"}

# 常见表头 → 标准字段名。认不出的表头保留原文（它就成了字段名，refs 照着写即可）。
_HEADER_ALIASES = {
    "名称": "name", "道具名称": "name", "对象名称": "name", "掉落组名称": "name", "名字": "name",
    "类型": "type", "负责人": "owner", "引用字段": "refs", "说明": "note", "备注": "note",
    "产出比": "ratio", "数量": "count", "声明值": "declared_count",
    "取值方式": "count_mode", "人数占比": "population_ratio",
    "售价": "sell_price", "堆叠上限": "max_stack", "权重": "weight", "重量": "weight",
    "占比下限": "quota_pct_min", "占比上限": "quota_pct_max",
}


def _coerce(value: Any) -> Any:
    """数字存成文本是常态："1200"、" 1200 "、"0.1" 都得转回数字。"""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return ""
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        return text


def _norm(text: Any) -> str:
    """归一化表头：去空格（含全角）、转小写。"""
    if text is None:
        return ""
    return str(text).replace("\u3000", " ").strip().lower()


def _split_refs(value: Any) -> list[str]:
    """引用分隔符现实中什么都有：分号、顿号、逗号、换行。"""
    if value is None:
        return []
    parts = re.split(r"[;；,，、\n]+", str(value))
    return [part.strip() for part in parts if part.strip()]


def _header_row(rows: list[tuple], wanted: set[str], limit: int = 10) -> int | None:
    """在前 limit 行里找表头：有一格命中 wanted 就算。"""
    for index, row in enumerate(rows[:limit]):
        for cell in row:
            if _norm(cell) in wanted:
                return index
    return None


def _records(ws, id_wanted: set[str] | None = None, require_id: bool = True) -> tuple[list[dict], int]:
    """读一张表：自动找表头行，归一化列名，值做类型纠正。

    返回 (记录列表, 表头所在行号)。找不到表头返回 ([], -1)。
    """
    rows = list(ws.iter_rows(values_only=True))
    head_index = _header_row(rows, id_wanted or _ID_HEADERS)
    if head_index is None:
        return [], -1
    header = rows[head_index]
    keys: list[str | None] = []
    seen_id = False
    for cell in header:
        norm = _norm(cell)
        if not norm:
            keys.append(None)  # 没表头的列直接丢掉（脏表常见）
            continue
        if norm in _ID_HEADERS and not seen_id:
            keys.append("id")
            seen_id = True
            continue
        mapped = _HEADER_ALIASES.get(norm, str(cell).strip())
        keys.append(mapped)
    out: list[dict] = []
    for row in rows[head_index + 1 :]:
        if not row or all(cell is None or str(cell).strip() == "" for cell in row):
            continue
        record: dict[str, Any] = {}
        for key, cell in zip(keys, row):
            if key is None:
                continue
            value = _coerce(cell)
            if value == "" or value is None:
                continue
            record[key] = value
        if not require_id or record.get("id") not in (None, ""):
            out.append(record)
    return out, head_index


def _load_xlsx(file: Path) -> dict[str, Any]:
    try:
        from openpyxl import load_workbook
    except ImportError as exc:  # pragma: no cover
        raise LoadError("读 xlsx 需要 openpyxl：pip install openpyxl") from exc

    wb = load_workbook(file, data_only=True)
    data: dict[str, Any] = {"activity": {}, "tiers": [], "downstream": [], "derived": []}
    skipped: list[str] = []

    ws = wb["activity"] if "activity" in wb.sheetnames else None
    if ws is not None:
        rows = list(ws.iter_rows(values_only=True))
        head_index = _header_row(rows, _KEY_HEADERS)
        if head_index is not None:
            for row in rows[head_index + 1 :]:
                if not row:
                    continue
                key = _coerce(row[0]) if row else None
                if not isinstance(key, str) or not key.strip():
                    continue  # 空行 / 纯备注行
                data["activity"][key.strip()] = _coerce(row[1] if len(row) > 1 else None)

    for name in ("tiers", "downstream", "derived"):
        if name in wb.sheetnames:
            wanted = _DERIVED_HEADERS if name == "derived" else None
            records, _ = _records(wb[name], id_wanted=wanted, require_id=name != "derived")
            for record in records:
                if "refs" in record and isinstance(record["refs"], str):
                    record["refs"] = _split_refs(record["refs"])
                if name == "tiers":
                    record.setdefault("count_mode", "fixed")
                if "population_ratio" in record:
                    record["population_ratio"] = float(record["population_ratio"])
                data[name].append(record)

    if "links" in wb.sheetnames:
        rows = list(wb["links"].iter_rows(values_only=True))
        head_index = _header_row(rows, _FROM_HEADERS)
        if head_index is not None:
            header = [_norm(cell) for cell in rows[head_index]]
            from_col = next((i for i, h in enumerate(header) if h in _FROM_HEADERS), None)
            to_col = next((i for i, h in enumerate(header) if h in _TO_HEADERS), None)
            links = []
            for row in rows[head_index + 1 :]:
                if not row:
                    continue
                src = row[from_col] if from_col is not None and from_col < len(row) else None
                dst = row[to_col] if to_col is not None and to_col < len(row) else None
                if src and dst:
                    links.append({"from": str(src).strip(), "to": str(dst).strip()})
            if links:
                data["links"] = links

    # 其余 sheet 一律当外部表；没有 id 列的（运营的临时备注）跳过并记录
    tables: dict[str, list[dict]] = {}
    for name in wb.sheetnames:
        if name in {"activity", "tiers", "downstream", "derived", "links"}:
            continue
        records, head_index = _records(wb[name])
        if head_index < 0 or not records:
            skipped.append(name)
            continue
        for record in records:
            if "refs" in record and isinstance(record["refs"], str):
                record["refs"] = _split_refs(record["refs"])
        tables[name] = records
    if tables:
        data["tables"] = tables

    data["_meta"] = {
        "source_file": file.name,
        "loader": "xlsx",
        "skipped_sheets": skipped,
    }
    return data


def write_xlsx_template(path: str | Path) -> Path:
    """生成一份 Excel 配置簿模板（给「对方填完发回来」这条回路用）。"""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

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
        ("id", "ACT-XXXX-01"),
        ("name", "活动名"),
        ("server_open_days", 45),
        ("open_day_min", 30),
        ("server_population", 1200),
    ]:
        ws.append([key, value])
    style(ws)

    ws = wb.create_sheet("tiers")
    ws.append(list(_TIER_COLUMNS))
    ws.append(["T_HIGH", "高档", 100, 1, None, "fixed", None])
    ws.append(["T_MID", "中档", 10, 5, 5, "fixed", None])
    ws.append(["T_LOW", "低档", 1, 120, None, "ratio_of_population", 0.1])
    style(ws)

    ws = wb.create_sheet("downstream")
    ws.append(list(_DOWNSTREAM_COLUMNS))
    ws.append(["OBJ_RANK", "排行榜奖励展示", "UI / 榜单", "系统策划", "tiers.T_HIGH.count;tiers.T_MID.count", ""])
    ws.append(["OBJ_MAIL", "发奖邮件模板", "文案 / 发放", "运营", "tiers.T_MID.count", ""])
    style(ws)

    ws = wb.create_sheet("derived")
    ws.append(["path", "formula", "refs", "reason"])
    ws.append(
        [
            "tiers.T_LOW.count",
            "round(activity.server_population * tiers.T_LOW.population_ratio)",
            "activity.server_population;tiers.T_LOW.population_ratio",
            "低档份数按人数比例推导，人数变了要重算",
        ]
    )
    style(ws)

    ws = wb.create_sheet("links")
    ws.append(["from", "to", "说明"])
    ws.append(["drops.item_id", "items", "掉落组这一列存的是道具 ID"])
    style(ws)

    ws = wb.create_sheet("items")
    ws.append(["id", "name", "max_stack", "sell_price"])
    ws.append(["10086", "霜月结晶", 999, 10])
    ws.append(["10087", "霜月徽记", 99, 50])
    style(ws)

    ws = wb.create_sheet("drops")
    ws.append(["id", "name", "item_id", "weight"])
    ws.append(["5001", "常规掉落组", "10086", 30])
    style(ws)

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    wb.save(target)
    return target
