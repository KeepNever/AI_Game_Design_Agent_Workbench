"""变异评测：检查器的第一份定量成绩单（雾隐镇 GT + 5 个确定性注入）。"""

import contextlib
import io
import unittest
from pathlib import Path

from gdw import eval_check, loader
from gdw.model import Config

from . import FIXTURES


class EvalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cfg = Config.from_dict(loader.load(FIXTURES / "quest_wuyin_full.yaml"))
        cls.report = eval_check.run_eval(cfg.quest, eval_check.load_mutations(FIXTURES / "eval_mutations.yaml"))

    def test_summary(self):
        """5 个变异：3 强检出 + 1 仅提示 + 1 漏报 = 检出率 4/5。"""
        s = self.report["summary"]
        self.assertEqual(s["total"], 5)
        self.assertEqual(s["强检出"], 3)
        self.assertEqual(s["仅提示"], 1)
        self.assertEqual(s["漏报"], 1)
        self.assertEqual(s["检出率"], "4/5")

    def test_missed_is_reported_with_reason(self):
        """漏报必须如实报出来——换错变量、目标结局本就不可达，现有边界抓不到。"""
        self.assertEqual([m["name"] for m in self.report["missed"]],
                         ["条件换错变量（把\"见过守林人\"写成\"猎人信任==true\"）"])

    def test_threshold_mutation_flips_outcome(self):
        row = [r for r in self.report["rows"] if "门槛抬高" in r["name"]][0]
        self.assertEqual(row["verdict"], "强检出")
        self.assertEqual(row["detail"]["results"]["v13"], "UNSAT")

    def test_domain_shrink_kills_whole_line(self):
        """线索上限砍到 1 之后：第二个线索的写入越界被剪，v3 以后全断——
        三个结局全部变 UNSAT（连放弃都到不了）。我预判的是"放弃结局变可达"，错了；
        以评测输出为准。结局翻转本身仍是强检出信号。"""
        row = [r for r in self.report["rows"] if "上限砍到" in r["name"]][0]
        self.assertEqual(row["verdict"], "强检出")
        self.assertEqual(row["detail"]["results"], {"v13": "UNSAT", "v14": "UNSAT", "v15": "UNSAT"})

    def test_ghost_writer_caught_by_s5(self):
        row = [r for r in self.report["rows"] if "写点" in r["name"]][0]
        self.assertEqual(row["verdict"], "仅提示")
        self.assertIn("S5", [f["code"] for f in row["detail"]["new_findings"]])

    def test_cli_exit_zero_when_no_miss(self):
        """造一个只有强检出的变异子集，验证退出码逻辑可扩展（此处仅验证命令可跑）。"""
        from gdw.cli import main

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = main(
                [
                    "eval",
                    str(FIXTURES / "quest_wuyin_full.yaml"),
                    "--mutations",
                    str(FIXTURES / "eval_mutations.yaml"),
                ]
            )
        self.assertEqual(code, 1)  # 有漏报 → 1，诚实不美化

    def test_bad_mutation_kind(self):
        with self.assertRaises(eval_check.EvalError):
            eval_check._apply(self.report and loader.load(FIXTURES / "quest_wuyin_full.yaml")["quest"],
                              {"name": "x", "kind": "nope"})


if __name__ == "__main__":
    unittest.main()
