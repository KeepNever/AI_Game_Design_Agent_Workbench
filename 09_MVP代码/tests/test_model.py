import copy
import unittest

from gdw import loader
from gdw.model import Config, ConfigError, validate_structure

from . import CONFIG_5TIER, CONFIG_V01


def load(path=CONFIG_V01) -> Config:
    return Config.from_dict(loader.load(path), path=str(path))


class StructureTest(unittest.TestCase):
    def test_minimal_ok(self):
        data = {"activity": {"id": "A"}, "tiers": [{"id": "T1", "count": 1}]}
        self.assertEqual(validate_structure(data), [])

    def test_missing_tiers(self):
        errors = validate_structure({"activity": {"id": "A"}})
        self.assertTrue(any("tiers" in e for e in errors))

    def test_duplicate_tier_id(self):
        data = {
            "activity": {"id": "A"},
            "tiers": [{"id": "T1", "count": 1}, {"id": "T1", "count": 2}],
        }
        errors = validate_structure(data)
        self.assertTrue(any("重复" in e for e in errors))

    def test_bad_numeric_type(self):
        data = {"activity": {"id": "A"}, "tiers": [{"id": "T1", "count": "五个"}]}
        errors = validate_structure(data)
        self.assertTrue(any("必须是数字" in e for e in errors))

    def test_ratio_is_optional(self):
        """不同品类档位字段不同：没有 ratio 也算合法结构。"""
        data = {"activity": {"id": "A"}, "tiers": [{"id": "T1", "amount": 6}]}
        self.assertEqual(validate_structure(data), [])

    def test_from_dict_raises_with_all_errors(self):
        with self.assertRaises(ConfigError) as ctx:
            Config.from_dict({"activity": {}, "tiers": []})
        self.assertGreaterEqual(len(ctx.exception.errors), 2)


class AccessTest(unittest.TestCase):
    def setUp(self):
        self.cfg = load()

    def test_get_tier_field_by_id(self):
        self.assertEqual(self.cfg.get("tiers.T_MID.count"), 5)

    def test_has(self):
        self.assertTrue(self.cfg.has("tiers.T_HIGH.ratio"))
        self.assertFalse(self.cfg.has("tiers.T_HIGH.nope"))

    def test_tier_order_does_not_matter(self):
        data = loader.load(CONFIG_V01)
        data["tiers"].reverse()
        cfg = Config.from_dict(data)
        self.assertEqual(cfg.get("tiers.T_MID.count"), 5)

    def test_with_changes_immutable(self):
        before = copy.deepcopy(self.cfg.data)
        after = self.cfg.with_changes({"tiers.T_MID.count": 8})
        self.assertEqual(after.get("tiers.T_MID.count"), 8)
        self.assertEqual(self.cfg.data, before)

    def test_with_changes_unknown_tier(self):
        with self.assertRaises(KeyError):
            self.cfg.with_changes({"tiers.T_NOPE.count": 1})

    def test_metrics(self):
        m = self.cfg.metrics()
        self.assertEqual(m["tier_count"], 3)
        self.assertEqual(m["sum_count"], 126)
        self.assertEqual(m["unresolved_refs"], 0)
        self.assertEqual(m["refs_resolvable"], 1)

    def test_derived_values(self):
        self.assertEqual(self.cfg.derived_values()["tiers.T_LOW.count"], 120)


class SecondShapeTest(unittest.TestCase):
    """第二套配置：5 档、字段名全不同，用来证明 Schema 没写死。"""

    def test_loads(self):
        cfg = load(CONFIG_5TIER)
        self.assertEqual(len(cfg.tiers), 5)
        self.assertEqual(cfg.get("tiers.T5.reward_points"), 9798)

    def test_derived_resolves(self):
        cfg = load(CONFIG_5TIER)
        values = cfg.derived_values()
        self.assertEqual(values["tiers.T5.reward_points"], round(4600 * 2.13))

    def test_baseline_has_no_derived_drift(self):
        """基线本身必须自洽：公式算出来的值和配置里写的值一致，否则一上来就报失效。"""
        for path in (CONFIG_V01, CONFIG_5TIER):
            cfg = load(path)
            for stale in cfg.derived_stale([]):
                self.assertEqual(stale["configured"], stale["expected"], f"{path.name} {stale['path']}")

    def test_stale_after_upstream_change(self):
        cfg = load(CONFIG_5TIER)
        after = cfg.with_changes({"tiers.T4.reward_points": 5200})
        stale = after.derived_stale(["tiers.T4.reward_points"])
        self.assertEqual([s["path"] for s in stale], ["tiers.T5.reward_points"])
        self.assertEqual(stale[0]["configured"], 9798)
        self.assertEqual(stale[0]["expected"], round(5200 * 2.13))


if __name__ == "__main__":
    unittest.main()
