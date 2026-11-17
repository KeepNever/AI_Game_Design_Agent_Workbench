"""HTML 报告：确认单的第三种输出，自包含单文件。"""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from gdw import deps, loader, rules as rules_mod, sheet
from gdw.html_report import render
from gdw.model import Config

from . import CONFIG_CROSS, RULES_CROSS, RULES_V01


class HtmlReportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = Config.from_dict(loader.load(CONFIG_CROSS))
        cls.analysis = deps.analyze(cls.cfg, {"items.10086.name": "霜月结晶·改", "drops.5001.item_id": "10087"})
        cls.report = rules_mod.run(cls.analysis.after, loader.load_rules(RULES_CROSS))
        cls.html = render(cls.cfg, cls.analysis, cls.report)

    def test_self_contained(self):
        """自包含 = 不引用任何外部资源，双击就能开。"""
        self.assertNotIn("http://", self.html)
        self.assertNotIn("https://", self.html)
        self.assertNotIn("<script", self.html)
        self.assertIn("<style>", self.html)

    def test_core_sections_present(self):
        for anchor in ["本次改动", "规则检查", "需要确认的对象", "推不出来的部分", "口径"]:
            self.assertIn(anchor, self.html)

    def test_narration_card(self):
        self.assertIn("先说人话", self.html)
        self.assertIn("30 秒了解全貌", self.html)

    def test_checkboxes_are_real_inputs(self):
        """勾选框是真的 input——打印出来就是纸面确认单。"""
        self.assertEqual(self.html.count("<input type='checkbox'>"), len(self.analysis.affected))

    def test_layer_summary_not_merged(self):
        self.assertIn("分层看", self.html)
        self.assertIn("工程假设", self.html)

    def test_diff_styling(self):
        self.assertIn("class='from'", self.html)
        self.assertIn("class='to'", self.html)

    def test_escaping(self):
        """字段值带尖括号时不能把页面炸出 XSS。"""
        evil = self.cfg.with_changes({"items.10086.name": "<script>alert(1)</script>"})
        analysis = deps.analyze(evil, {"items.10086.name": "ok"})
        report = rules_mod.run(analysis.after, loader.load_rules(RULES_CROSS))
        html = render(evil, analysis, report)
        self.assertNotIn("<script>alert", html)
        self.assertIn("&lt;script&gt;", html)

    def test_cli_html_writes_file(self):
        from gdw.cli import main

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "r.html"
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                code = main(
                    [
                        "impact",
                        str(Path(__file__).resolve().parent.parent / "fixtures" / "activity_cross_table.yaml"),
                        "--rules",
                        str(Path(__file__).resolve().parent.parent / "fixtures" / "rules_cross_table.yaml"),
                        "--set",
                        "items.10086.name=测试",
                        "--html",
                        "--out",
                        str(out),
                    ]
                )
            self.assertEqual(code, 0)
            text = out.read_text(encoding="utf-8")
            self.assertIn("变更确认单", text)
            self.assertIn("<!DOCTYPE html>", text)

    def test_diff_supports_html(self):
        from gdw.cli import main

        fixtures = Path(__file__).resolve().parent.parent / "fixtures"
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = main(
                [
                    "diff",
                    str(fixtures / "activity_v0.1.yaml"),
                    str(fixtures / "activity_v0.1_改后.yaml"),
                    "--rules",
                    str(fixtures / "rules_v0.1.yaml"),
                    "--html",
                ]
            )
        self.assertEqual(code, 0)
        self.assertIn("服务器人数", buffer.getvalue())


if __name__ == "__main__":
    unittest.main()
