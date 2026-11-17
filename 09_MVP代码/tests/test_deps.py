import unittest

from gdw import deps, loader
from gdw.model import Config

from . import CONFIG_5TIER, CONFIG_V01


def cfg(path=CONFIG_V01) -> Config:
    return Config.from_dict(loader.load(path))


class ImpactTest(unittest.TestCase):
    def setUp(self):
        self.cfg = cfg()

    def test_index(self):
        index = deps.build_index(self.cfg)
        names = [o.name for o in index["tiers.T_MID.count"]]
        self.assertIn("排行榜奖励展示", names)
        self.assertIn("发奖邮件模板", names)

    def test_direct_match(self):
        affected = deps.impacted(self.cfg, ["tiers.T_MID.count"])
        ids = {a.obj.id for a in affected}
        self.assertEqual(ids, {"OBJ_RANK", "OBJ_ANNOUNCE", "OBJ_MAIL", "OBJ_FAQ"})
        self.assertTrue(all(a.kind == "直接引用" for a in affected))

    def test_parent_field_change(self):
        """改「整个中档」这种父级路径，引用它下面字段的对象也算受影响。"""
        affected = deps.impacted(self.cfg, ["tiers.T_MID"])
        ids = {a.obj.id for a in affected}
        self.assertEqual(ids, {"OBJ_RANK", "OBJ_ANNOUNCE", "OBJ_SHOP", "OBJ_MAIL", "OBJ_FAQ"})
        self.assertTrue(all(a.kind == "上级字段" for a in affected))

    def test_unrelated_field_no_impact(self):
        affected = deps.impacted(self.cfg, ["activity.duration_days"])
        self.assertEqual(affected, [])

    def test_analyze_changes_and_labels(self):
        analysis = deps.analyze(self.cfg, {"tiers.T_MID.count": 8})
        self.assertEqual(len(analysis.changes), 1)
        change = analysis.changes[0]
        self.assertEqual(change.path, "tiers.T_MID.count")
        self.assertEqual(change.old, 5)
        self.assertEqual(change.new, 8)
        self.assertIn("中档", change.label)

    def test_derived_cascade_pulls_downstream(self):
        """改人数 → 低档份数失效 → 引用低档份数的对象也要算进来。"""
        analysis = deps.analyze(self.cfg, {"activity.server_population": 600})
        self.assertEqual(len(analysis.stale), 1)
        self.assertEqual(analysis.stale[0].expected, 60)
        ids = {a.obj.id for a in analysis.affected}
        self.assertEqual(ids, {"OBJ_MAIL", "OBJ_DROP"})
        self.assertTrue(all(a.kind == "派生失效" for a in analysis.affected))

    def test_unknown_path_raises(self):
        with self.assertRaises(KeyError):
            deps.analyze(self.cfg, {"tiers.T_NOPE.count": 1})

    def test_flatten_paths(self):
        flat = deps.flatten(self.cfg)
        self.assertEqual(flat["activity.server_population"], 1200)
        self.assertEqual(flat["tiers.T_MID.count"], 5)
        self.assertNotIn("downstream", flat)

    def test_diff_same_version_empty(self):
        changes, notes = deps.diff_configs(self.cfg, self.cfg)
        self.assertEqual(changes, [])
        self.assertEqual(notes, [])

    def test_diff_detects_change(self):
        after = self.cfg.with_changes({"activity.server_population": 600})
        changes, notes = deps.diff_configs(self.cfg, after)
        self.assertEqual([c.path for c in changes], ["activity.server_population"])
        self.assertEqual(changes[0].old, 1200)
        self.assertEqual(changes[0].new, 600)
        self.assertEqual(notes, [])

    def test_diff_reports_added_tier(self):
        data = loader.load(CONFIG_V01)
        data["tiers"].append({"id": "T_VIP", "name": "VIP 档", "ratio": 1000, "count": 1})
        after = Config.from_dict(data)
        changes, notes = deps.diff_configs(self.cfg, after)
        self.assertEqual(changes, [])
        self.assertTrue(any("tiers.T_VIP.ratio" in n for n in notes))

    def test_second_dataset_cascade(self):
        analysis = deps.analyze(cfg(CONFIG_5TIER), {"tiers.T4.reward_points": 5200})
        ids = {a.obj.id for a in analysis.affected}
        self.assertEqual(ids, {"OBJ_ACC_RANK", "OBJ_CS_SCRIPT", "OBJ_IAP_PAGE"})


if __name__ == "__main__":
    unittest.main()
