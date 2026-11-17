import unittest

from gdw import loader
from gdw.model import Config
from gdw.rules import run

from . import CONFIG_5TIER, CONFIG_V01, RULES_5TIER, RULES_V01


def cfg(path=CONFIG_V01) -> Config:
    return Config.from_dict(loader.load(path))


class RuleTest(unittest.TestCase):
    def setUp(self):
        self.rules = loader.load_rules(RULES_V01)

    def test_baseline_all_pass(self):
        report = run(cfg(), self.rules)
        self.assertEqual(len(report.results), 8)
        self.assertEqual(report.violations, [])

    def test_ratio_break(self):
        broken = cfg().with_changes({"tiers.T_MID.ratio": 8})
        report = run(broken, self.rules)
        ids = [r.rule_id for r in report.violations]
        self.assertIn("R-01", ids)

    def test_declared_mismatch(self):
        broken = cfg().with_changes({"tiers.T_MID.count": 8})
        report = run(broken, self.rules)
        ids = [r.rule_id for r in report.violations]
        self.assertIn("R-03", ids)  # 与声明值不一致
        self.assertIn("R-05", ids)  # 占比超区间

    def test_population_change_breaks_low_tier(self):
        broken = cfg().with_changes({"activity.server_population": 600})
        report = run(broken, self.rules)
        ids = [r.rule_id for r in report.violations]
        self.assertIn("R-04", ids)

    def test_source_layering(self):
        """来源分层必须能拆开：口述 4 条、工程 3 条、模拟阈值 1 条。"""
        report = run(cfg(), self.rules)
        layers = {label: total for label, (_ok, total) in report.by_source().items()}
        self.assertEqual(layers["口述"], 4)
        self.assertEqual(layers["工程假设"], 3)
        self.assertEqual(layers["模拟阈值"], 1)

    def test_undecidable_when_field_missing(self):
        rules = [{"id": "X-1", "name": "引用不存在的字段", "when": "tiers.T_HIGH.nope == 1"}]
        report = run(cfg(), rules)
        self.assertEqual(report.results[0].status, "无法判定")
        self.assertIn("字段不存在", report.results[0].detail)

    def test_rule_without_condition(self):
        report = run(cfg(), [{"id": "X-2", "name": "空规则"}])
        self.assertEqual(report.results[0].status, "无法判定")

    def test_second_ruleset(self):
        rules = loader.load_rules(RULES_5TIER)
        report = run(cfg(CONFIG_5TIER), rules)
        self.assertEqual(report.violations, [])
        self.assertEqual(len(report.results), 6)

    def test_tier_count_rule_catches_shape_change(self):
        data = loader.load(CONFIG_5TIER)
        data["tiers"] = data["tiers"][:4]
        report = run(Config.from_dict(data), loader.load_rules(RULES_5TIER))
        self.assertIn("A-06", [r.rule_id for r in report.violations])


if __name__ == "__main__":
    unittest.main()
