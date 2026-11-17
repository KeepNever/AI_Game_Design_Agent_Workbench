"""真数据压测：PokeAPI 的 CSV（937 招式 / 300 宝可梦 / 21 属性）。

CSV 没下载时整套跳过——测试不依赖网络。
数据来源：PokeAPI/pokeapi 仓库 data/v2/csv/，全量真实数值，没有任何一条是我编的。
"""

import tempfile
import unittest
from pathlib import Path

from gdw import deps, loader, rules as rules_mod
from gdw.model import Config

from . import CONFIG_REAL, REAL_CSV, RULES_REAL

_CSVS = ["pokemon.csv", "types.csv", "moves.csv"]


class RealDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        missing = [name for name in _CSVS if not (REAL_CSV / name).exists()]
        if missing:
            raise unittest.SkipTest(f"真数据 CSV 未下载，跳过：{missing}")
        cls.tmp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.tmp.name) / "真表.xlsx"
        from tools.make_real_fixture import build

        build(str(cls.path))
        cls.cfg = Config.from_dict(loader.load(cls.path), path=str(cls.path))
        cls.rules = loader.load_rules(RULES_REAL)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_volume(self):
        """真表的体量：1260 行数据，validate 还得在秒级跑完。"""
        self.assertEqual(len(self.cfg.tables["moves"]), 937)
        self.assertEqual(len(self.cfg.tables["types"]), 21)
        self.assertEqual(len(self.cfg.tables["pokemon"]), 300)

    def test_dashed_id_resolves(self):
        """double-edge（38 号）横杠 id，点号路径必须能走到。"""
        self.assertEqual(self.cfg.get("moves.38.identifier"), "double-edge")

    def test_dependencies_include_hop(self):
        deps_list = self.cfg.dependencies("moves.1.type.identifier")
        self.assertEqual(deps_list, ["types.1.identifier", "moves.1.type_id"])

    def test_real_data_corrects_assumptions(self):
        """★保住这个打脸瞬间：招式 25 是 mega-kick 不是 double-edge，且都是第一世代。

        这条测试存在的意义：防止将来有人'顺手修正'掉这个事实，
        也提醒所有人——规则靠印象写就是会错，真数据只核对不改写。
        """
        self.assertEqual(self.cfg.get("moves.25.identifier"), "mega-kick")
        self.assertEqual(self.cfg.get("moves.25.generation_id"), 1)
        self.assertEqual(self.cfg.get("moves.38.identifier"), "double-edge")
        self.assertEqual(self.cfg.get("moves.38.generation_id"), 1)

    def test_empty_cells_dont_break_rules(self):
        """moves.1.accuracy = 100；状态招式没有 accuracy 字段，规则层表现为无法判定而非崩溃。"""
        report = rules_mod.run(self.cfg, self.rules)
        self.assertEqual(report.violations, [])
        # swords-dance（14 号）是状态招式，accuracy 为空 → 表达式判定为无法判定，不是崩溃
        rules = [
            {"id": "X-1", "name": "读一个空字段", "when": "moves.14.accuracy == 100"},
        ]
        report = rules_mod.run(self.cfg, rules)
        self.assertEqual(report.results[0].status, "无法判定")

    def test_rules_pass_on_real_data(self):
        report = rules_mod.run(self.cfg, self.rules)
        self.assertEqual(report.violations, [])

    def test_impact_multi_hop_on_real_data(self):
        analysis = deps.analyze(self.cfg, {"types.1.identifier": "normal-改"})
        ids = {a.obj.id for a in analysis.affected}
        self.assertEqual(ids, {"OBJ_MOVE_TYPE", "OBJ_TYPE_LIST"})
        kinds = {a.obj.id: a.kind for a in analysis.affected}
        self.assertEqual(kinds["OBJ_TYPE_LIST"], "直接引用")
        self.assertEqual(kinds["OBJ_MOVE_TYPE"], "跨表")

    def test_labels_use_identifier_when_no_name(self):
        """types 表没有 name 列，标签回退用 identifier。"""
        analysis = deps.analyze(self.cfg, {"types.1.identifier": "normal-改"})
        self.assertEqual(analysis.changes[0].label, "normal · identifier")


if __name__ == "__main__":
    unittest.main()
