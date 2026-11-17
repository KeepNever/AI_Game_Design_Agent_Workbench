"""任务结构检查：S1–S5 五类 + 雾隐镇完整图验收。"""

import unittest

from gdw import loader, quest as quest_mod, structure as structure_mod
from gdw.model import Config

from . import FIXTURES

VARS = {
    "clue": {"type": "int", "min": 0, "max": 4, "init": 0},
    "trust": {"type": "int", "min": 0, "max": 1, "init": 0},
    "met_elder": {"type": "bool", "init": False},
}

NODES = ["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7",
         "v8", "v9", "v10", "v11", "v12", "v13", "v14", "v15"]


def make_quest(edges, nodes=NODES, variables=VARS, targets=("v13",)):
    return {
        "start": nodes[0], "targets": list(targets),
        "variables": variables, "nodes": list(nodes), "edges": edges,
    }


def codes(findings):
    return [f["code"] for f in findings]


class StructureTest(unittest.TestCase):
    def test_clean_graph_no_findings(self):
        edges = [
            {"from": "start", "to": "n1", "actions": [{"var": "clue", "op": "+=", "value": 1}]},
            {"from": "n1", "to": "end", "cond": "clue >= 1"},
        ]
        quest = make_quest(
            edges,
            nodes=["start", "n1", "end"],
            targets=("end",),
        )
        self.assertEqual(structure_mod.check_structure(quest), [])

    def test_s1_undeclared_variable(self):
        edges = [{"from": "start", "to": "end", "cond": "foo == 1"}]
        findings = structure_mod.check_structure(make_quest(edges, nodes=["start", "end"], targets=("end",)))
        self.assertIn("S1", codes(findings))

    def test_s2_unreachable_node(self):
        edges = [{"from": "start", "to": "end", "cond": "clue >= 0"}]
        # v_alone 声明了但没有入边
        findings = structure_mod.check_structure(
            make_quest(edges, nodes=["start", "end", "v_alone"], targets=("end",))
        )
        self.assertIn("S2", codes(findings))
        where = [f["where"] for f in findings if f["code"] == "S2"]
        self.assertIn("v_alone", where)

    def test_s3_dead_node(self):
        edges = [
            {"from": "start", "to": "n1", "actions": [{"var": "clue", "op": "+=", "value": 1}]},
            {"from": "n1", "to": "end", "cond": "clue >= 1"},
            {"from": "end", "to": "dead_end"},
        ]
        findings = structure_mod.check_structure(
            make_quest(edges, nodes=["start", "n1", "end", "dead_end"], targets=("end",))
        )
        self.assertIn("S3", codes(findings))
        where = [f["where"] for f in findings if f["code"] == "S3"]
        self.assertIn("dead_end", where)

    def test_s5_ghost_variable(self):
        edges = [{"from": "start", "to": "end", "cond": "clue >= 1 and met_elder == true"}]
        findings = structure_mod.check_structure(make_quest(edges, targets=("end",)))
        self.assertIn("S5", codes(findings))


class WuyinAcceptanceTest(unittest.TestCase):
    """雾隐镇完整图验收：原报告的三处设计错误必须在 Python 里复现。"""

    @classmethod
    def setUpClass(cls):
        cfg = Config.from_dict(loader.load(FIXTURES / "quest_wuyin_full.yaml"))
        cls.quest = cfg.quest
        cls.findings = structure_mod.check_structure(cls.quest)

    def test_s4_circular_dependency(self):
        """错误①：v6→v8 要求 met_elder，而 met_elder 只在 v8 之后才被写入。"""
        s4 = [f for f in self.findings if f["code"] == "S4"]
        self.assertEqual(len(s4), 1)
        self.assertIn("v6 → v8", s4[0]["where"])
        self.assertIn("循环依赖", s4[0]["message"])
        self.assertIn("met_elder", s4[0]["message"])

    def test_error2_hidden_ending_unreachable(self):
        """错误②：隐藏结局 v14 不可达（逐结局判定 UNSAT）。"""
        per = quest_mod.check_per_target(self.quest)
        by_target = {e["target"]: e["result"] for e in per}
        self.assertEqual(by_target["v13"], "SAT")
        self.assertEqual(by_target["v14"], "UNSAT")
        blocks = [e for e in per if e["target"] == "v14"][0]["blocking_edges"]
        self.assertTrue(any("met_elder" in b["condition"] for b in blocks))

    def test_error3_give_up_ending_also_broken(self):
        """错误③（移植时新发现）：v15 放弃结局要求 clue < 2，
        但到达 v11 时 clue 必然是 4——失败结局本身也永远到不了。"""
        per = quest_mod.check_per_target(self.quest)
        v15 = [e for e in per if e["target"] == "v15"][0]
        self.assertEqual(v15["result"], "UNSAT")
        self.assertTrue(any("clue < 2" in b["condition"] for b in v15["blocking_edges"]))

    def test_no_other_structural_noise(self):
        """除循环依赖外，S1/S2/S3/S5 不应有发现——有就说明检查器误报。"""
        self.assertEqual(codes(self.findings), ["S4"])


if __name__ == "__main__":
    unittest.main()
