import contextlib
import io
import unittest

from gdw.cli import main

from . import CONFIG_5TIER, CONFIG_V01, RULES_5TIER, RULES_V01


def run(argv):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = main(argv)
    return code, buffer.getvalue()


class CliTest(unittest.TestCase):
    def test_validate(self):
        code, out = run(["validate", str(CONFIG_V01)])
        self.assertEqual(code, 0)
        self.assertIn("3 个", out)

    def test_check_clean(self):
        code, out = run(["check", str(CONFIG_V01), "--rules", str(RULES_V01)])
        self.assertEqual(code, 0)
        self.assertIn("8/8 通过", out)

    def test_impact_exits_nonzero_on_blocking_violation(self):
        code, out = run(
            ["impact", str(CONFIG_V01), "--rules", str(RULES_V01), "--set", "tiers.T_MID.count=8"]
        )
        self.assertEqual(code, 1)
        self.assertIn("R-03", out)

    def test_impact_without_set_lists_refs(self):
        code, out = run(["impact", str(CONFIG_V01)])
        self.assertEqual(code, 0)
        self.assertIn("tiers.T_MID.count", out)

    def test_json_output(self):
        code, out = run(
            [
                "impact",
                str(CONFIG_V01),
                "--rules",
                str(RULES_V01),
                "--set",
                "tiers.T_MID.count=8",
                "--json",
            ]
        )
        self.assertEqual(code, 1)
        self.assertIn('"path": "tiers.T_MID.count"', out)

    def test_second_dataset(self):
        code, out = run(
            [
                "impact",
                str(CONFIG_5TIER),
                "--rules",
                str(RULES_5TIER),
                "--set",
                "tiers.T4.reward_points=5200",
            ]
        )
        self.assertEqual(code, 0)
        self.assertIn("连带失效", out)

    def test_diff_same(self):
        code, out = run(["diff", str(CONFIG_V01), str(CONFIG_V01)])
        self.assertEqual(code, 0)
        self.assertIn("没有数值差异", out)

    def test_bad_set_format(self):
        with self.assertRaises(SystemExit):
            run(["impact", str(CONFIG_V01), "--set", "没有等号"])


if __name__ == "__main__":
    unittest.main()
