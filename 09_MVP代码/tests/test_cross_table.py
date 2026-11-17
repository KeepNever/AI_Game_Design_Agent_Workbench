"""跨表引用：活动表只存道具 ID，名字/售价在另一张道具表上。"""

import unittest

from gdw import deps, loader, rules as rules_mod
from gdw.model import Config, validate_structure

from . import CONFIG_CROSS, RULES_CROSS


def cfg() -> Config:
    return Config.from_dict(loader.load(CONFIG_CROSS))


class CrossTableTest(unittest.TestCase):
    def setUp(self):
        self.cfg = cfg()

    def test_table_loaded(self):
        self.assertEqual(set(self.cfg.tables), {"items", "drops"})
        self.assertEqual(self.cfg.get("items.10086.name"), "霜月结晶")

    def test_refs_resolve(self):
        self.assertEqual(self.cfg.unresolved_refs(), [])

    def test_namespace_has_tables(self):
        ns = self.cfg.namespace()
        self.assertEqual(ns["items"]["10087"]["name"], "霜月徽记")

    def test_change_table_field_hits_only_its_referrers(self):
        # 只被一个对象引用的字段，影响面就必须只有一个
        analysis = deps.analyze(self.cfg, {"items.10086.max_stack": 9999})
        ids = {a.obj.id for a in analysis.affected}
        self.assertEqual(ids, {"OBJ_TOOLTIP"})

    def test_change_price_hits_shop(self):
        analysis = deps.analyze(self.cfg, {"items.10086.sell_price": 25})
        ids = {a.obj.id for a in analysis.affected}
        self.assertEqual(ids, {"OBJ_SHOP"})
        self.assertIn("霜月结晶", analysis.changes[0].label)
        self.assertIn("售价", analysis.changes[0].label)

    def test_change_tier_item_id_hits_shop(self):
        analysis = deps.analyze(self.cfg, {"tiers.T_MID.item_id": "10087"})
        ids = {a.obj.id for a in analysis.affected}
        self.assertEqual(ids, {"OBJ_SHOP"})

    def test_rule_reads_table_field(self):
        report = rules_mod.run(self.cfg, loader.load_rules(RULES_CROSS))
        self.assertEqual(report.violations, [])
        broken = self.cfg.with_changes({"items.10086.sell_price": 25})
        report = rules_mod.run(broken, loader.load_rules(RULES_CROSS))
        self.assertIn("C-04", [r.rule_id for r in report.violations])

    def test_rebind_id_gets_hint_not_silent(self):
        """换绑道具 ID 时，引用旧行的对象推不出来——不硬猜，但要明说。"""
        analysis = deps.analyze(self.cfg, {"tiers.T_MID.item_id": "10087"})
        self.assertEqual(len(analysis.hints), 1)
        hint = analysis.hints[0]
        self.assertIn("items.10086", hint)
        self.assertIn("道具浮窗", hint)
        # 已经列在「需要确认」里的对象不再重复提
        self.assertNotIn("商店兑换价", hint)

    def test_no_hint_when_id_unchanged(self):
        analysis = deps.analyze(self.cfg, {"tiers.T_MID.item_id": "10086"})
        self.assertEqual(analysis.hints, [])

    def test_flatten_includes_table_rows(self):
        flat = deps.flatten(self.cfg)
        self.assertEqual(flat["items.10086.sell_price"], 10)
        self.assertEqual(flat["items.10087.name"], "霜月徽记")

    def test_with_changes_on_table_row(self):
        after = self.cfg.with_changes({"items.10086.sell_price": 99})
        self.assertEqual(after.get("items.10086.sell_price"), 99)
        self.assertEqual(self.cfg.get("items.10086.sell_price"), 10)

    def test_missing_row_raises(self):
        with self.assertRaises(KeyError):
            self.cfg.with_changes({"items.99999.name": "x"})

    def test_broken_ref_reported(self):
        data = loader.load(CONFIG_CROSS)
        data["downstream"][0]["refs"] = ["items.99999.name"]
        broken = Config.from_dict(data)
        self.assertEqual(broken.unresolved_refs(), ["OBJ_TOOLTIP:items.99999.name"])

    # ---------- 多跳：drops.5001.item_id → items ----------

    def test_walk_returns_hops(self):
        value, hops, canonical = self.cfg.walk("drops.5001.item.name")
        self.assertEqual(value, "霜月结晶")
        self.assertEqual(hops, ["drops.5001.item_id"])
        self.assertEqual(canonical, "items.10086.name")

    def test_dependencies_include_hop(self):
        deps = self.cfg.dependencies("drops.5001.item.name")
        self.assertEqual(deps, ["items.10086.name", "drops.5001.item_id"])

    def test_change_target_field_hits_multi_hop_referrer(self):
        analysis = deps.analyze(self.cfg, {"items.10086.name": "霜月结晶·改"})
        ids = {a.obj.id for a in analysis.affected}
        self.assertIn("OBJ_DROP_PREVIEW", ids)
        kinds = {a.obj.id: a.kind for a in analysis.affected}
        self.assertEqual(kinds["OBJ_TOOLTIP"], "直接引用")
        self.assertEqual(kinds["OBJ_DROP_PREVIEW"], "跨表")

    def test_rebind_link_field_hits_referrer(self):
        """换绑掉落组的道具，掉落预览必须进影响面——这是多跳的价值。"""
        analysis = deps.analyze(self.cfg, {"drops.5001.item_id": "10087"})
        ids = {a.obj.id for a in analysis.affected}
        self.assertEqual(ids, {"OBJ_DROP_PREVIEW"})

    def test_namespace_alias_lets_rules_read_across_tables(self):
        ns = self.cfg.namespace()
        self.assertEqual(ns["drops"]["5001"]["item"]["sell_price"], 10)

    def test_rule_reads_multi_hop(self):
        rules = loader.load_rules(RULES_CROSS)
        broken = self.cfg.with_changes({"items.10086.sell_price": 25})
        report = rules_mod.run(broken, rules)
        self.assertIn("C-07", [r.rule_id for r in report.violations])

    def test_broken_link_reported(self):
        data = loader.load(CONFIG_CROSS)
        data["tables"]["drops"][0]["item_id"] = "99999"
        broken = Config.from_dict(data)
        self.assertIn("OBJ_DROP_PREVIEW:drops.5001.item.name", broken.unresolved_refs())

    def test_links_must_point_to_existing_table(self):
        errors = validate_structure(
            {
                "activity": {"id": "A"},
                "tiers": [{"id": "T1"}],
                "tables": {"drops": [{"id": "1", "item_id": "1"}]},
                "links": [{"from": "drops.item_id", "to": "items"}],
            }
        )
        self.assertTrue(any("已存在的表名" in e for e in errors))

    def test_links_field_must_end_with_id(self):
        errors = validate_structure(
            {
                "activity": {"id": "A"},
                "tiers": [{"id": "T1"}],
                "tables": {"drops": [{"id": "1"}], "items": [{"id": "1"}]},
                "links": [{"from": "drops.item", "to": "items"}],
            }
        )
        self.assertTrue(any("_id" in e for e in errors))

    def test_table_name_collision(self):
        errors = validate_structure(
            {"activity": {"id": "A"}, "tiers": [{"id": "T1"}], "tables": {"tiers": [{"id": "x"}]}}
        )
        self.assertTrue(any("冲突" in e for e in errors))

    def test_table_row_needs_id(self):
        errors = validate_structure(
            {"activity": {"id": "A"}, "tiers": [{"id": "T1"}], "tables": {"items": [{"name": "无 id"}]}}
        )
        self.assertTrue(any("缺 id" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
