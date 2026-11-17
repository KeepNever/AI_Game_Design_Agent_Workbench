import unittest

from gdw import deps, loader, rules as rules_mod, sheet
from gdw.model import Config

from . import CONFIG_V01, RULES_V01


class SheetTest(unittest.TestCase):
    def setUp(self):
        self.cfg = Config.from_dict(loader.load(CONFIG_V01))
        self.rules = loader.load_rules(RULES_V01)
        self.analysis = deps.analyze(self.cfg, {"tiers.T_MID.count": 8})
        self.report = rules_mod.run(self.analysis.after, self.rules)

    def test_plain_has_no_markdown_symbols(self):
        """粘进微信不能出现 # / [ ] / 行首 - ：这些符号在微信里不变格式，只会变噪音。"""
        text = sheet.render_plain(self.cfg, self.analysis, self.report)
        self.assertNotIn("#", text)
        self.assertNotIn("[ ]", text)
        self.assertNotIn("☐", text)
        for line in text.splitlines():
            self.assertFalse(line.lstrip().startswith("- "), f"出现 Markdown 列表：{line}")
            self.assertFalse(line.lstrip().startswith("|"), f"出现 Markdown 表格：{line}")

    def test_plain_contains_checkboxes_and_counts(self):
        text = sheet.render_plain(self.cfg, self.analysis, self.report)
        self.assertIn("□", text)
        self.assertIn("本次改动 1 项", text)
        self.assertIn("需要确认的对象 4 个", text)
        self.assertIn("中档 · 数量：5 → 8", text)

    def test_plain_sections_are_numbered_consecutively(self):
        """没有连带失效时，章节号不能跳号（曾出现 一、三、四）。"""
        text = sheet.render_plain(self.cfg, self.analysis, self.report)
        heads = [line for line in text.splitlines() if line[:2] in {"一、", "二、", "三、", "四、", "五、"}]
        self.assertEqual([h[:2] for h in heads], ["一、", "二、", "三、", "四、"])

    def test_plain_with_stale_has_five_sections(self):
        analysis = deps.analyze(self.cfg, {"activity.server_population": 600})
        report = rules_mod.run(analysis.after, self.rules)
        text = sheet.render_plain(self.cfg, analysis, report)
        heads = [line[:2] for line in text.splitlines() if line[:2] in {"一、", "二、", "三、", "四、", "五、"}]
        self.assertEqual(heads, ["一、", "二、", "三、", "四、", "五、"])
        self.assertIn("连带失效", text)

    def test_markdown_tables(self):
        text = sheet.render_markdown(self.cfg, self.analysis, self.report)
        self.assertIn("| 字段 | 原值 | 新值 | 字段路径 |", text)
        self.assertIn("☐ | 发奖邮件模板", text)
        self.assertIn("❌", text)

    def test_layout_note_always_present(self):
        """口径说明不能只在某一种输出里有。"""
        plain = sheet.render_plain(self.cfg, self.analysis, self.report)
        markdown = sheet.render_markdown(self.cfg, self.analysis, self.report)
        self.assertIn("只核对已经登记过的引用", plain)
        self.assertIn("只核对**已登记**的引用", markdown)

    def test_plain_starts_with_narration(self):
        """曦的反馈：输出要通俗易懂。每份确认单开头必须有一段人话。"""
        text = sheet.render_plain(self.cfg, self.analysis, self.report)
        self.assertIn("【先说人话】", text)
        self.assertIn("这次改了", text)
        self.assertIn("得有人跟着改的有 4 处", text)
        self.assertIn("运营名下的", text)  # 按负责人分组，不报字段路径

    def test_markdown_has_narration_quote(self):
        text = sheet.render_markdown(self.cfg, self.analysis, self.report)
        self.assertIn("> **先说人话**：", text)

    def test_as_dict(self):
        data = sheet.as_dict(self.analysis, self.report)
        self.assertEqual(data["changes"][0]["path"], "tiers.T_MID.count")
        self.assertEqual(len(data["affected"]), 4)
        self.assertEqual(data["rules"][2]["id"], "R-03")


if __name__ == "__main__":
    unittest.main()
