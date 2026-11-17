"""依赖索引与影响分析。

只有**已经登记**的引用才会被推导——这是这个工具的能力边界，也是它敢被相信的原因。
文案里手写的数字、公告截图里的旧值，这里一概看不到；查不出来就说查不出来。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .model import Config, Downstream


@dataclass
class Change:
    path: str
    label: str
    old: Any
    new: Any

    def display(self) -> str:
        return f"{self.label}：{_fmt(self.old)} → {_fmt(self.new)}"


@dataclass
class Affected:
    obj: Downstream
    matched_refs: list[str]
    kind: str  # 直接引用 / 上级字段 / 下级字段

    @property
    def id(self) -> str:
        return self.obj.id


@dataclass
class StaleField:
    path: str
    configured: Any
    expected: Any
    reason: str


@dataclass
class Analysis:
    changes: list[Change] = field(default_factory=list)
    affected: list[Affected] = field(default_factory=list)
    stale: list[StaleField] = field(default_factory=list)
    hints: list[str] = field(default_factory=list)
    before: Config | None = None
    after: Config | None = None

    @property
    def confirmed_count(self) -> int:
        """受影响但没有任何同步记录的对象数（本版一律视为待确认）。"""
        return len(self.affected)


DEFAULT_FIELD_LABELS = {
    "ratio": "产出比",
    "count": "数量",
    "declared_count": "声明值",
    "population_ratio": "人数占比",
    "count_mode": "取值方式",
    "server_population": "服务器人数",
    "server_open_days": "开服天数",
    "open_day_min": "开放门槛",
    "duration_days": "持续天数",
    "lead_time_days": "提前量",
    "reward_points": "返积分",
    "sell_price": "售价",
    "max_stack": "堆叠上限",
    "item_id": "绑定道具",
    "quality": "品质",
    "amount": "充值金额",
    "budget_cap": "预算上限",
    "name": "名称",
    "type": "类型",
}

KIND_ORDER = {"直接引用": 0, "跨表": 1, "派生失效": 2, "上级字段": 3, "下级字段": 4}


def build_index(config: Config) -> dict[str, list[Downstream]]:
    """字段路径 → 引用它的下游对象。"""
    index: dict[str, list[Downstream]] = {}
    for obj in config.downstream:
        for ref in obj.refs:
            index.setdefault(ref, []).append(obj)
    return index


def impacted(config: Config, changed_paths: Iterable[str]) -> list[Affected]:
    """沿已登记引用推导：谁会被这几个字段的改动波及。

    跨表的引用（``drops.5001.item.name``）会展开成它真正依赖的两条路径：
    落到的 ``items.10086.name``，和中间那跳 ``drops.5001.item_id``——
    后者保证「换绑道具」也会被算进影响面，不靠猜。
    """
    changed = [p for p in changed_paths]
    hits: dict[str, Affected] = {}
    for obj in config.downstream:
        for ref in obj.refs:
            deps = config.dependencies(ref)
            for dep in deps:
                for path in changed:
                    kind = _match(dep, path)
                    if not kind:
                        continue
                    if dep != ref and kind == "直接引用":
                        kind = "跨表"  # 命中的是链接字段，不是引用本身
                    existing = hits.get(obj.id)
                    if existing is None:
                        hits[obj.id] = Affected(obj=obj, matched_refs=[ref], kind=kind)
                    else:
                        if ref not in existing.matched_refs:
                            existing.matched_refs.append(ref)
                        if KIND_ORDER[kind] < KIND_ORDER[existing.kind]:
                            existing.kind = kind
    return sorted(hits.values(), key=lambda a: (KIND_ORDER[a.kind], a.obj.id))


def analyze(before: Config, changes: dict[str, Any]) -> Analysis:
    """给定「改哪几个字段、改成什么」，算变更清单 + 影响面 + 派生失效。"""
    after = before.with_changes(changes)
    result = Analysis(before=before, after=after)
    for path, new_value in changes.items():
        try:
            old_value = before.get(path)
        except KeyError as exc:
            raise KeyError(f"配置里没有这个字段：{path}") from exc
        result.changes.append(
            Change(path=path, label=label_of(before, path), old=old_value, new=new_value)
        )
    result.affected = impacted(after, [c.path for c in result.changes])
    for item in after.derived_stale([c.path for c in result.changes]):
        result.stale.append(
            StaleField(
                path=item["path"],
                configured=item["configured"],
                expected=item["expected"],
                reason=item["reason"],
            )
        )
    # 派生字段失效后，引用了这个派生字段的下游对象也要算进来——
    # 否则「改人数」只会提示规则违规，不会提示「邮件里的份数也得改」。
    if result.stale:
        stale_paths = [s.path for s in result.stale]
        extra = impacted(after, stale_paths)
        by_id = {a.obj.id: a for a in result.affected}
        for item in extra:
            if item.obj.id in by_id:
                current = by_id[item.obj.id]
                current.matched_refs.extend(r for r in item.matched_refs if r not in current.matched_refs)
                if KIND_ORDER[item.kind] < KIND_ORDER[current.kind]:
                    current.kind = item.kind
            else:
                by_id[item.obj.id] = item
        result.affected = sorted(by_id.values(), key=lambda a: (KIND_ORDER[a.kind], a.obj.id))
        # 只通过派生字段被牵连的，单独标出来，别混进「直接引用」
        for affected in result.affected:
            if affected.matched_refs and all(ref in stale_paths for ref in affected.matched_refs):
                affected.kind = "派生失效"

    # 换绑外部 ID（tiers.T_MID.item_id 10086 → 10087）时，引用旧行 items.10086.* 的对象
    # 从字符串路径上推不出来——不硬猜，但必须说出来，否则这张单子会漏得莫名其妙。
    for change in result.changes:
        if not change.path.endswith("_id"):
            continue
        old, new = str(change.old), str(change.new)
        if old == new:
            continue
        for table_name, rows in after.tables.items():
            if not any(str(row.get("id")) == old for row in rows):
                continue
            listed = {a.obj.id for a in result.affected}
            hits = [h for h in impacted(after, [f"{table_name}.{old}"]) if h.obj.id not in listed]
            if not hits:
                continue
            names = "、".join(sorted({h.obj.name for h in hits}))
            result.hints.append(
                f"{change.label} 从 {old} 换成了 {new}：引用旧行 {table_name}.{old}.* 的「{names}」"
                f"不会自动出现在上面——这类间接引用本版推不出来，要人工确认它该不该跟着换。"
            )
    return result


def flatten(config: Config) -> dict[str, Any]:
    """把配置摊平成「路径 → 标量」的字典，用于两个版本对比。

    只摊 activity 与 tiers（真正会被改的数据）；downstream/derived 属于结构定义，
    改了它们是改模型不是改数据，单独看待。
    """
    out: dict[str, Any] = {}
    for key, value in (config.activity or {}).items():
        if isinstance(value, (int, float, str, bool)):
            out[f"activity.{key}"] = value
    for item in config.data.get("tiers", []):
        tier_id = item.get("id")
        if not tier_id:
            continue
        for key, value in item.items():
            if key == "id":
                continue
            if isinstance(value, (int, float, str, bool)):
                out[f"tiers.{tier_id}.{key}"] = value
    for name, rows in config.tables.items():
        for row in rows:
            row_id = row.get("id")
            if row_id is None:
                continue
            for key, value in row.items():
                if key == "id":
                    continue
                if isinstance(value, (int, float, str, bool)):
                    out[f"{name}.{row_id}.{key}"] = value
    return out


def diff_configs(before: Config, after: Config) -> tuple[list[Change], list[str]]:
    """两个版本对比：返回 (改动的字段, 只在一边存在的路径说明)。"""
    old = flatten(before)
    new = flatten(after)
    changes: list[Change] = []
    for path in sorted(set(old) & set(new)):
        if old[path] != new[path]:
            changes.append(Change(path=path, label=label_of(after, path), old=old[path], new=new[path]))
    notes: list[str] = []
    for path in sorted(set(new) - set(old)):
        notes.append(f"{path} 是新加的（本版不推导新增字段的影响）")
    for path in sorted(set(old) - set(new)):
        notes.append(f"{path} 被删掉了（本版不推导删除字段的影响）")
    return changes, notes


def label_of(config: Config, path: str) -> str:
    """把 ``tiers.T_MID.count`` 翻成人话：中档 · 数量。"""
    parts = path.split(".")
    field_names = dict(DEFAULT_FIELD_LABELS)
    # 配置里可以自带字段中文名，换品类时不用改代码
    custom = config.data.get("field_labels") or {}
    if isinstance(custom, dict):
        field_names.update({str(k): str(v) for k, v in custom.items()})
    if parts[0] == "tiers" and len(parts) >= 3:
        tier_id = parts[1]
        tier_name = tier_id
        for item in config.data.get("tiers", []):
            if item.get("id") == tier_id:
                tier_name = item.get("name", tier_id)
                break
        return f"{tier_name} · {field_names.get(parts[2], parts[2])}"
    if parts[0] == "activity":
        return f"活动 · {field_names.get(parts[-1], parts[-1])}"
    if parts[0] in config.tables and len(parts) >= 3:
        table, row_id = parts[0], parts[1]
        row_name = row_id
        for row in config.tables[table]:
            if str(row.get("id")) == row_id:
                row_name = row.get("name") or row.get("identifier") or row_id
                break
        return f"{row_name} · {field_names.get(parts[-1], parts[-1])}"
    return path


def _match(ref: str, path: str) -> str | None:
    if ref == path:
        return "直接引用"
    if ref.startswith(path + "."):
        return "上级字段"
    if path.startswith(ref + "."):
        return "下级字段"
    return None


def _fmt(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)
