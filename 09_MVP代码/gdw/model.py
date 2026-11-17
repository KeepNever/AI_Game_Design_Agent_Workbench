"""配置模型：校验、路径取值、计算指标。

设计要点：**档位不是写死的三档**。tiers 是一个按 id 索引的字典，
字段访问一律走 ``tiers.<档位ID>.<字段>``，所以换一套档位结构（5 档、带 VIP 档）
不需要改一行代码，只改配置和规则文件。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Iterable

from . import expr


RESERVED_NAMES = {"activity", "tiers", "downstream", "derived", "_meta", "field_labels", "tables"}


class ConfigError(Exception):
    """配置结构不合法。``errors`` 里是一次性列全的问题清单。"""

    def __init__(self, errors: list[str]) -> None:
        super().__init__("；".join(errors))
        self.errors = errors


@dataclass
class Tier:
    id: str
    name: str
    ratio: float | None
    count: float | None
    declared_count: float | None = None
    count_mode: str = "fixed"
    population_ratio: float | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Downstream:
    id: str
    name: str
    type: str
    refs: list[str]
    owner: str = ""
    note: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Config:
    data: dict[str, Any]
    path: str = "<memory>"
    warnings: list[str] = field(default_factory=list)

    # ---------- 构造 ----------

    @classmethod
    def from_dict(cls, data: dict[str, Any], path: str = "<memory>") -> "Config":
        errors = validate_structure(data)
        if errors:
            raise ConfigError(errors)
        cfg = cls(data=data, path=path)
        cfg.warnings = cfg._collect_warnings()
        return cfg

    # ---------- 访问 ----------

    @property
    def activity(self) -> dict[str, Any]:
        return self.data["activity"]

    @property
    def tiers(self) -> dict[str, Tier]:
        out: dict[str, Tier] = {}
        for item in self.data.get("tiers", []):
            out[item["id"]] = Tier(
                id=item["id"],
                name=item.get("name", item["id"]),
                ratio=_opt_float(item.get("ratio")),
                count=_opt_float(item.get("count")),
                declared_count=_opt_float(item.get("declared_count")),
                count_mode=item.get("count_mode", "fixed"),
                population_ratio=_opt_float(item.get("population_ratio")),
                raw=item,
            )
        return out

    @property
    def downstream(self) -> list[Downstream]:
        out = []
        for item in self.data.get("downstream", []):
            out.append(
                Downstream(
                    id=item["id"],
                    name=item.get("name", item["id"]),
                    type=item.get("type", ""),
                    refs=list(item.get("refs", [])),
                    owner=item.get("owner", ""),
                    note=item.get("note", ""),
                    raw=item,
                )
            )
        return out

    @property
    def links(self) -> dict[tuple[str, str], str]:
        """跨表链接：(表, 字段) → 目标表。字段值就是目标表的行 id。

        配成 ``links: [{from: drops.item_id, to: items}]``，
        之后就能写 ``drops.5001.item.name``——5001 这行绑定的道具叫什么。
        """
        out: dict[tuple[str, str], str] = {}
        raw = self.data.get("links") or []
        if not isinstance(raw, list):
            return out
        for item in raw:
            if not isinstance(item, dict):
                continue
            src = str(item.get("from", ""))
            dst = str(item.get("to", ""))
            if "." not in src or not dst:
                continue
            table, field = src.split(".", 1)
            out[(table.strip(), field.strip())] = dst.strip()
        return out

    def row_of(self, table: str, row_id: Any) -> dict[str, Any] | None:
        for row in self.tables.get(table, []):
            if str(row.get("id")) == str(row_id):
                return row
        return None

    def _aliases(self, table: str, row: dict[str, Any], depth: int = 0) -> dict[str, Any]:
        """给行加「别名键」：drops 行有 item_id，就补一个 item → 目标行。

        这样表达式里能直接写 ``drops.5001.item.name``，不用记两套写法。
        """
        out = dict(row)
        if depth >= 3:  # 防表互相指来指去
            return out
        for (src_table, field), target in self.links.items():
            if src_table != table or field not in row:
                continue
            alias = field[:-3] if field.endswith("_id") else field
            if alias in out:
                continue
            linked = self.row_of(target, row[field])
            if linked is not None:
                out[alias] = self._aliases(target, linked, depth + 1)
        return out

    @property
    def derived(self) -> list[dict[str, Any]]:
        return list(self.data.get("derived", []))

    @property
    def quest(self) -> dict[str, Any] | None:
        """任务图（Q013）：nodes / edges / variables / start / targets。没有就是 None。"""
        quest = self.data.get("quest")
        return quest if isinstance(quest, dict) else None

    @property
    def tables(self) -> dict[str, list[dict[str, Any]]]:
        """外部表：道具表 / 掉落表 / 商店表……引用写成 ``items.10086.name``。"""
        raw = self.data.get("tables") or {}
        if not isinstance(raw, dict):
            return {}
        return {str(name): list(rows) for name, rows in raw.items() if isinstance(rows, list)}

    def walk(self, dotted: str) -> tuple[Any, list[str], str]:
        """沿路径走一遍，返回 (值, 经过的链接字段, 落到的绝对路径)。

        ``drops.5001.item.name`` →
        值=霜月结晶，经过=[drops.5001.item_id]，落到=items.10086.name。
        中间那跳很关键：换绑 item_id 时，影响面要从这里反推出来。
        """
        parts = dotted.split(".")
        hops: list[str] = []
        table: str | None = None
        row_id: str | None = None
        first = parts[0]

        if first in self.tables:
            table, node, index = first, self.tables[first], 1
        elif first in self.data:
            node, index = self.data[first], 1
        else:
            raise KeyError(dotted)

        canonical = [first]
        while index < len(parts):
            seg = parts[index]

            if isinstance(node, list):  # 数组：这一段是行 id
                row_id = seg
                row = next(
                    (item for item in node if isinstance(item, dict) and str(item.get("id")) == seg),
                    None,
                )
                if row is None:
                    raise KeyError(dotted)
                node = row
                canonical.append(seg)
                index += 1
                continue

            if not isinstance(node, dict):
                raise KeyError(dotted)

            # 链接别名：item → item_id → items 表的那一行
            link_field = f"{seg}_id"
            if table and seg not in node and link_field in node and (table, link_field) in self.links:
                target = self.links[(table, link_field)]
                linked = self.row_of(target, node[link_field])
                if linked is None:
                    raise KeyError(dotted)
                hops.append(f"{table}.{row_id}.{link_field}")
                table, row_id, node = target, str(linked.get("id")), linked
                canonical = [target, str(linked.get("id"))]
                index += 1
                continue

            if seg in node:
                node = node[seg]
                canonical.append(seg)
                index += 1
                continue

            raise KeyError(dotted)

        return node, hops, ".".join(canonical)

    def get(self, dotted: str) -> Any:
        """按点号路径取值；取不到抛 KeyError。支持跨表链接与多跳。"""
        return self.walk(dotted)[0]

    def dependencies(self, dotted: str) -> list[str]:
        """一个引用真正依赖的路径：落到的绝对路径 + 中间经过的链接字段。"""
        try:
            _, hops, canonical = self.walk(dotted)
        except KeyError:
            return [dotted]
        out = [canonical]
        for hop in hops:
            if hop not in out:
                out.append(hop)
        return out

    def has(self, dotted: str) -> bool:
        try:
            self.get(dotted)
            return True
        except KeyError:
            return False

    def with_changes(self, changes: dict[str, Any]) -> "Config":
        """返回改过值的新配置（原对象不变）。"""
        data = copy.deepcopy(self.data)
        for dotted, value in changes.items():
            _set_path(data, dotted, value)
        return Config.from_dict(data, path=self.path)

    # ---------- 求值上下文 ----------

    def namespace(self) -> dict[str, Any]:
        """给表达式用的变量空间：activity.* / tiers.<ID>.* / m.*"""
        tiers_ns = {t.id: _tier_dict(t) for t in self.tiers.values()}
        metrics = self.metrics()
        tables_ns: dict[str, Any] = {}
        for name, rows in self.tables.items():
            tables_ns[name] = {
                str(row.get("id")): self._aliases(name, row)
                for row in rows
                if isinstance(row, dict)
            }
        ns: dict[str, Any] = {
            "activity": self.activity,
            "tiers": tiers_ns,
            **tables_ns,
            "downstream": [d.raw for d in self.downstream],
            "m": metrics,
        }
        return ns

    def metrics(self) -> dict[str, Any]:
        tiers = list(self.tiers.values())
        population = float(self.activity.get("server_population", 0) or 0)
        sum_count = sum((t.count or 0) for t in tiers)
        unresolved = self.unresolved_refs()
        return {
            "tier_count": len(tiers),
            "sum_count": sum_count,
            "server_population": population,
            "coverage_ratio": (sum_count / population) if population else 0.0,
            "unresolved_refs": len(unresolved),
            "refs_resolvable": 1 if not unresolved else 0,
            "downstream_count": len(self.downstream),
        }

    def unresolved_refs(self) -> list[str]:
        """下游对象声明了、但配置里解析不到的字段路径。"""
        bad: list[str] = []
        for obj in self.downstream:
            for ref in obj.refs:
                if not self.has(ref):
                    bad.append(f"{obj.id}:{ref}")
        return bad

    def derived_values(self) -> dict[str, Any]:
        """把 derived 里的公式算出来（失败时记 None，不抛异常）。"""
        ns = self.namespace()
        out: dict[str, Any] = {}
        for item in self.derived:
            path = item.get("path", "")
            formula = item.get("formula", "")
            try:
                out[path] = expr.evaluate(formula, ns)
            except expr.ExprError:
                out[path] = None
        return out

    def derived_stale(self, changed_paths: Iterable[str]) -> list[dict[str, Any]]:
        """哪些派生字段因为这次改动而需要重算。"""
        changed = list(changed_paths)
        current = self.derived_values()
        stale: list[dict[str, Any]] = []
        for item in self.derived:
            deps = item.get("refs", [])
            if any(_touches(dep, c) for dep in deps for c in changed):
                path = item.get("path", "")
                try:
                    configured = self.get(path)
                except KeyError:
                    configured = None
                expected = current.get(path)
                stale.append(
                    {
                        "path": path,
                        "configured": configured,
                        "expected": expected,
                        "reason": item.get("reason", ""),
                        "refs": deps,
                    }
                )
        return stale

    def _collect_warnings(self) -> list[str]:
        warns: list[str] = []
        for ref in self.unresolved_refs():
            warns.append(f"下游引用解析不到：{ref}")
        for tier in self.tiers.values():
            if tier.count_mode == "ratio_of_population" and tier.population_ratio is None:
                warns.append(f"{tier.id} 声明按人数比例推导，但未给 population_ratio")
        for item in self.derived:
            try:
                expr.evaluate(item.get("formula", "None"), self.namespace())
            except expr.ExprError as exc:
                warns.append(f"派生字段 {item.get('path')} 公式无法求值：{exc}")
        return warns


# ---------- 结构校验 ----------


def validate_structure(data: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["配置文件根节点必须是对象（dict）"]

    if "activity" not in data or not isinstance(data.get("activity"), dict):
        errors.append("缺 activity 段，或不是对象")
    elif not isinstance(data["activity"].get("id"), str):
        errors.append("activity.id 必须是字符串")

    tiers = data.get("tiers")
    if not isinstance(tiers, list) or not tiers:
        errors.append("tiers 必须是非空数组")
    else:
        seen: set[str] = set()
        for index, tier in enumerate(tiers):
            where = f"tiers[{index}]"
            if not isinstance(tier, dict):
                errors.append(f"{where} 必须是对象")
                continue
            tier_id = tier.get("id")
            if not isinstance(tier_id, str) or not tier_id:
                errors.append(f"{where}.id 缺失或非字符串")
            elif tier_id in seen:
                errors.append(f"{where}.id 重复：{tier_id}")
            else:
                seen.add(tier_id)
            # 只校验「写了就得是数字」，不强制要求 ratio/count 存在：
            # 不同品类的档位字段本来就不一样（金额档、积分档、体力档），写死会逼着人凑字段。
            for numeric in ("ratio", "count", "declared_count", "population_ratio"):
                value = tier.get(numeric)
                if value is not None and not isinstance(value, (int, float)):
                    errors.append(f"{where}.{numeric} 必须是数字，收到 {value!r}")

    downstream = data.get("downstream", [])
    if not isinstance(downstream, list):
        errors.append("downstream 必须是数组")
    else:
        for index, obj in enumerate(downstream):
            where = f"downstream[{index}]"
            if not isinstance(obj, dict):
                errors.append(f"{where} 必须是对象")
                continue
            if not isinstance(obj.get("id"), str):
                errors.append(f"{where}.id 缺失或非字符串")
            refs = obj.get("refs", [])
            if not isinstance(refs, list) or not all(isinstance(r, str) for r in refs):
                errors.append(f"{where}.refs 必须是字符串数组")

    tables = data.get("tables", {})
    if tables and not isinstance(tables, dict):
        errors.append("tables 必须是对象（表名 → 行数组）")
    elif isinstance(tables, dict):
        for name, rows in tables.items():
            if name in RESERVED_NAMES - {"tables"}:
                errors.append(f"表名 {name} 与内置字段冲突")
            if not isinstance(rows, list):
                errors.append(f"tables.{name} 必须是数组")
                continue
            for index, row in enumerate(rows):
                if not isinstance(row, dict):
                    errors.append(f"tables.{name}[{index}] 必须是对象")
                elif "id" not in row:
                    errors.append(f"tables.{name}[{index}] 缺 id（跨表引用要靠 id 定位）")

    links = data.get("links", [])
    if links and not isinstance(links, list):
        errors.append("links 必须是数组（[{from: 表.字段, to: 表}]）")
    elif isinstance(links, list):
        known = set(tables.keys()) if isinstance(tables, dict) else set()
        for index, link in enumerate(links):
            where = f"links[{index}]"
            if not isinstance(link, dict):
                errors.append(f"{where} 必须是对象")
                continue
            src, dst = link.get("from"), link.get("to")
            if not isinstance(src, str) or "." not in src:
                errors.append(f"{where}.from 必须写成「表.字段」")
                continue
            table, field = src.split(".", 1)
            if not field.endswith("_id"):
                errors.append(f"{where}.from 的字段名要以 _id 结尾（{field}），否则不知道该改叫什么都算换绑")
            if table not in known:
                errors.append(f"{where}.from 引用了不存在的表：{table}")
            if not isinstance(dst, str) or dst not in known:
                errors.append(f"{where}.to 必须是已存在的表名，收到 {dst!r}")

    quest = data.get("quest")
    if quest is not None:
        if not isinstance(quest, dict):
            errors.append("quest 必须是对象")
        else:
            for required in ("start", "targets", "variables", "nodes", "edges"):
                if required not in quest:
                    errors.append(f"quest 缺 {required}")
            if not isinstance(quest.get("nodes"), list) or not quest.get("nodes"):
                errors.append("quest.nodes 必须是非空数组")
            if not isinstance(quest.get("edges"), list):
                errors.append("quest.edges 必须是数组")
            else:
                for index, edge in enumerate(quest["edges"]):
                    if not isinstance(edge, dict) or "from" not in edge or "to" not in edge:
                        errors.append(f"quest.edges[{index}] 必须是带 from/to 的对象")
            if not isinstance(quest.get("variables"), dict):
                errors.append("quest.variables 必须是对象（变量名 → 定义）")
            else:
                for name, spec in quest["variables"].items():
                    if not isinstance(spec, dict) or "type" not in spec or "init" not in spec:
                        errors.append(f"quest.variables.{name} 缺 type 或 init")

    derived = data.get("derived", [])
    if not isinstance(derived, list):
        errors.append("derived 必须是数组")
    else:
        for index, item in enumerate(derived):
            where = f"derived[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{where} 必须是对象")
                continue
            if not isinstance(item.get("path"), str):
                errors.append(f"{where}.path 缺失或非字符串")
            if not isinstance(item.get("formula"), str):
                errors.append(f"{where}.formula 缺失或非字符串")
    return errors


# ---------- 小工具 ----------


def _opt_float(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


def _tier_dict(tier: Tier) -> dict[str, Any]:
    base = dict(tier.raw)
    base.setdefault("id", tier.id)
    base.setdefault("name", tier.name)
    if tier.ratio is not None:
        base["ratio"] = tier.ratio
    if tier.count is not None:
        base["count"] = tier.count
    if tier.declared_count is not None:
        base.setdefault("declared_count", tier.declared_count)
    return base


def _set_path(data: dict[str, Any], dotted: str, value: Any) -> None:
    """``tiers.T_MID.count`` / ``items.10086.name`` 这种路径写入。

    两条规则：
    1. 遇到数组就按 **id** 找行（不按下标），增删行、换顺序都不会写错地方；
    2. 第一段可以是外部表名（``items``），会自动去 ``tables`` 里找。
    """
    parts = dotted.split(".")
    node: Any = data
    if parts[0] not in data and isinstance(data.get("tables"), dict) and parts[0] in data["tables"]:
        node = data["tables"][parts[0]]
        parts = parts[1:]

    index = 0
    while index < len(parts) - 1:
        if isinstance(node, list):
            row_id = parts[index]
            found = next(
                (row for row in node if isinstance(row, dict) and str(row.get("id")) == row_id),
                None,
            )
            if found is None:
                raise KeyError(f"找不到 id={row_id} 的行：{dotted}")
            node = found
            index += 1
            continue
        part = parts[index]
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"路径不存在：{dotted}（缺少 {part}）")
        node = node[part]
        index += 1
    if not isinstance(node, dict):
        raise KeyError(f"路径不存在：{dotted}（末段不是字段）")
    node[parts[-1]] = value


def _touches(a: str, b: str) -> bool:
    """两个点号路径是否有包含关系（父改了子也算，反之亦然）。"""
    return a == b or a.startswith(b + ".") or b.startswith(a + ".")
