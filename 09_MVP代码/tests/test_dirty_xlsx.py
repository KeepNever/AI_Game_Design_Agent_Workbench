"""脏表压测：合并标题、表头不在第一行、中文表头、文本数字、混用分隔符、junk sheet。

这份夹具专门模仿「运营随手填的表」。如果 loader 在它上面崩了，
接真表时一定也会崩——所以这些断言就是接真表的准入条件。
"""

import tempfile
import unittest
from pathlib import Path

from gdw import deps, loader, rules as rules_mod
from gdw.model import Config

from . import RULES_V01
from tools.make_dirty_fixture import build


class DirtyXlsxTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.tmp.name) / "脏表.xlsx"
        build(str(cls.path))
        cls.cfg = Config.from_dict(loader.load(cls.path), path=str(cls.path))
        cls.rules = loader.load_rules(RULES_V01)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_activity_values_coerced(self):
        """\"45\" 和 \" 1200 \" 必须转回数字，否则规则全变无法判定。"""
        activity = self.cfg.activity
        self.assertEqual(activity["server_open_days"], 45)
        self.assertEqual(activity["server_population"], 1200)
        self.assertIsInstance(activity["server_population"], int)

    def test_tiers_loaded_from_second_row_header(self):
        self.assertEqual(len(self.cfg.tiers), 3)
        self.assertEqual(self.cfg.get("tiers.T_MID.declared_count"), 5)
        self.assertEqual(self.cfg.get("tiers.T_MID.quota_pct_max"), 0.006)

    def test_refs_with_mixed_separators(self):
        obj = next(o for o in self.cfg.downstream if o.id == "OBJ_RANK")
        self.assertEqual(
            obj.refs, ["tiers.T_HIGH.count", "tiers.T_MID.count"]
        )

    def test_no_unresolved_refs(self):
        self.assertEqual(self.cfg.unresolved_refs(), [])

    def test_junk_sheet_skipped_and_recorded(self):
        """没有 id 列的 sheet 跳过，但要留下痕迹——不能静默吞掉。"""
        self.assertEqual(self.cfg.tables.get("临时备注"), None)
        self.assertIn("临时备注", self.cfg.data["_meta"]["skipped_sheets"])
        self.assertEqual(set(self.cfg.tables), {"items", "drops"})

    def test_id_numeric_and_text_both_work(self):
        """items 表里 10086 是数字、10087 是文本，都得能按 id 找到。"""
        self.assertEqual(self.cfg.get("items.10086.name"), "霜月结晶")
        self.assertEqual(self.cfg.get("items.10087.name"), "霜月徽记")

    def test_rules_all_pass_on_dirty_data(self):
        report = rules_mod.run(self.cfg, self.rules)
        self.assertEqual(report.violations, [])
        self.assertEqual(len(report.results), 8)

    def test_impact_across_dirty_sheets(self):
        analysis = deps.analyze(self.cfg, {"items.10086.name": "霜月结晶·改", "tiers.T_MID.count": 8})
        ids = {a.obj.id for a in analysis.affected}
        self.assertEqual(
            ids,
            {"OBJ_ANNOUNCE", "OBJ_TOOLTIP", "OBJ_RANK", "OBJ_MAIL"},
        )
        self.assertEqual(len(analysis.changes), 2)

    def test_blockers_still_exit_nonzero(self):
        from gdw.cli import main
        import contextlib, io

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = main(
                [
                    "impact",
                    str(self.path),
                    "--rules",
                    str(RULES_V01),
                    "--set",
                    "tiers.T_MID.count=8",
                ]
            )
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
