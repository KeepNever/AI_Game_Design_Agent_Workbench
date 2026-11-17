"""Q013 三态判定：移植自 06_规则与数据结构/q013_minimal.py 的四个验收用例。

UNKNOWN 不降级为 SAT——这条纪律用 test_case3_unknown_limit 钉死。
"""

import json
import tempfile
import unittest

from gdw import loader
from gdw.model import Config
from gdw.quest import QuestChecker, SAT, UNSAT, UNKNOWN, check_quest, describe

from . import CONFIG_REAL, FIXTURES

V3 = {
    "clue_count": {"type": "int", "min": 0, "max": 3, "init": 0},
    "secret_revealed": {"type": "bool", "init": False},
    "player_trust": {"type": "int", "min": 0, "max": 5, "init": 1},
}
EDGES_SAT = [
    {"from": "start", "to": "n1", "actions": [{"var": "clue_count", "op": "+=", "value": 1}]},
    {"from": "n1", "to": "n2", "actions": [{"var": "clue_count", "op": "+=", "value": 1}]},
    {"from": "n2", "to": "hidden_end",
     "cond": "clue_count >= 2 and not secret_revealed and player_trust >= 1"},
]


def checker(variables, edges, targets=("hidden_end",), state_limit=50000):
    return QuestChecker(
        variables, ["start", "n1", "n2", "hidden_end"], edges, "start", list(targets), state_limit
    )


class ThreeStateTest(unittest.TestCase):
    """用例 1/2：同名任务图，只有变量定义域不同——一个 SAT 一个 UNSAT。"""

    def test_case1_sat(self):
        result = checker(V3, EDGES_SAT).check()
        self.assertEqual(result["result"], SAT)
        self.assertEqual(result["path"], ["start", "n1", "n2", "hidden_end"])
        self.assertGreaterEqual(result["final_state"]["clue_count"], 2)

    def test_case2_unsat_with_diagnosis(self):
        tight = {k: dict(v) for k, v in V3.items()}
        tight["clue_count"]["max"] = 1  # 上限不够，条件永远满足不了
        result = checker(tight, EDGES_SAT).check()
        self.assertEqual(result["result"], UNSAT)
        self.assertTrue(any("n2 → hidden_end" in b["edge"] for b in result["blocking_edges"]))
        # 诊断要能说人话：告诉设计者 clue_count 最大只到过 1
        self.assertEqual(result["max_seen"]["clue_count"], 1)
        self.assertIn("clue_count 最大只到过 1", describe(result))

    def test_case3_unknown_never_degrades(self):
        """状态爆炸必须返回 UNKNOWN；UNKNOWN 是"不知道"，不是"通过"。"""
        variables = {
            "a": {"type": "int", "min": 0, "max": 30, "init": 0},
            "b": {"type": "int", "min": 0, "max": 30, "init": 0},
            "c": {"type": "int", "min": 0, "max": 30, "init": 0},
        }
        edges = [
            {"from": "s", "to": "p"},
            {"from": "p", "to": "inc_a", "actions": [{"var": "a", "op": "+=", "value": 3}]},
            {"from": "p", "to": "inc_b", "actions": [{"var": "b", "op": "+=", "value": 2}]},
            {"from": "p", "to": "inc_c", "actions": [{"var": "c", "op": "+=", "value": 1}]},
            {"from": "inc_a", "to": "p"},
            {"from": "inc_b", "to": "p"},
            {"from": "inc_c", "to": "p"},
            {"from": "p", "to": "end", "cond": "a > 1000"},
        ]
        checker_ = QuestChecker(
            variables, ["s", "p", "inc_a", "inc_b", "inc_c", "end"], edges, "s", ["end"], state_limit=200
        )
        result = checker_.check()
        self.assertEqual(result["result"], UNKNOWN)
        self.assertIn("上限", result["reason"])

    def test_case4_multi_action_edge(self):
        edges = [
            {"from": "start", "to": "n1",
             "actions": [{"var": "clue_count", "op": "+=", "value": 1},
                         {"var": "player_trust", "op": "+=", "value": 2}]},
            {"from": "n1", "to": "end",
             "cond": "clue_count >= 1 and player_trust >= 3 and not secret_revealed"},
        ]
        result = checker(V3, edges, targets=("end",)).check()
        self.assertEqual(result["result"], SAT)

    def test_domain_violation_is_pruned_not_fatal(self):
        """越界动作是非法转移：剪掉继续搜，而不是整个判定崩掉。"""
        edges = [
            # 坏边：把 clue_count 剪到 -5，越界，按非法转移剪掉
            {"from": "start", "to": "n1", "actions": [{"var": "clue_count", "op": "-=", "value": 5}]},
            # 好边：另一条出路还在，判定不能因为坏边存在就跟着坏
            {"from": "start", "to": "n1", "actions": [{"var": "clue_count", "op": "+=", "value": 1}]},
            {"from": "n1", "to": "n2", "actions": [{"var": "clue_count", "op": "+=", "value": 1}]},
            {"from": "n2", "to": "hidden_end", "cond": "clue_count >= 2"},
        ]
        result = checker(V3, edges).check()
        self.assertEqual(result["result"], SAT)  # 坏边剪掉后，正常路径仍可达


class ConfigIntegrationTest(unittest.TestCase):
    def test_fixture_unsat(self):
        cfg = Config.from_dict(loader.load(FIXTURES / "quest_unsat_demo.yaml"))
        self.assertIsNotNone(cfg.quest)
        result = check_quest(cfg.quest)
        self.assertEqual(result["result"], UNSAT)

    def test_config_without_quest(self):
        cfg = Config.from_dict(loader.load(FIXTURES / "activity_cross_table.yaml"))
        self.assertIsNone(cfg.quest)

    def test_start_must_be_in_nodes(self):
        bad = {"start": "nowhere", "targets": ["end"], "variables": {}, "nodes": ["end"], "edges": []}
        with self.assertRaises(Exception):
            check_quest(bad)

    def test_real_fixture_has_no_quest(self):
        cfg = Config.from_dict(loader.load(CONFIG_REAL))
        self.assertIsNone(cfg.quest)


class WebQuestTest(unittest.TestCase):
    """网页里也要能点出三态结果。"""

    @classmethod
    def setUpClass(cls):
        import threading
        import urllib.request

        from gdw import webapp

        cls.tmp = tempfile.TemporaryDirectory()
        cls.server = webapp.start(port=0, open_browser=False)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

        request = urllib.request.Request(
            f"http://127.0.0.1:{cls.port}/api/upload?kind=config&name=quest.yaml",
            data=(FIXTURES / "quest_unsat_demo.yaml").read_bytes(),
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            json.loads(response.read())

        cls.port_number = cls.port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_quest_endpoint(self):
        import urllib.request

        with urllib.request.urlopen(f"http://127.0.0.1:{self.port_number}/api/quest", timeout=10) as response:
            data = json.loads(response.read())
        self.assertTrue(data["ok"])
        self.assertEqual(data["result"]["result"], UNSAT)
        self.assertIn("触发不了", data["describe"])


if __name__ == "__main__":
    unittest.main()
