import json
import tempfile
import unittest
from pathlib import Path

from gdw import loader
from gdw.model import Config

from . import CONFIG_V01, FIXTURES, RULES_V01


class LoaderTest(unittest.TestCase):
    def test_load_yaml(self):
        data = loader.load(CONFIG_V01)
        self.assertEqual(data["activity"]["id"], "ACT-1109-01")

    def test_load_json(self):
        data = loader.load(FIXTURES / "activity_v0.1.json")
        self.assertEqual(len(data["tiers"]), 3)

    def test_load_rules(self):
        rules = loader.load_rules(RULES_V01)
        self.assertEqual(len(rules), 8)
        self.assertTrue(all("when" in r for r in rules))

    def test_missing_file(self):
        with self.assertRaises(loader.LoadError):
            loader.load(FIXTURES / "不存在.yaml")

    def test_unsupported_suffix(self):
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as handle:
            path = handle.name
        with self.assertRaises(loader.LoadError):
            loader.load(path)

    def test_xlsx_roundtrip(self):
        """Excel 这条回路：生成模板 → 读回来 → 能跑规则与派生。"""
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "模板.xlsx"
            loader.write_xlsx_template(target)
            self.assertTrue(target.exists())
            data = loader.load(target)
            self.assertEqual(len(data["tiers"]), 3)
            self.assertEqual(data["activity"]["server_population"], 1200)
            self.assertEqual(
                data["downstream"][0]["refs"], ["tiers.T_HIGH.count", "tiers.T_MID.count"]
            )
            cfg = Config.from_dict(data)
            self.assertEqual(cfg.unresolved_refs(), [])
            self.assertEqual(cfg.derived_values()["tiers.T_LOW.count"], 120)
            # 模板里的 items sheet 会被当成外部表，引用写成 items.10086.name
            self.assertIn("items", cfg.tables)
            self.assertEqual(cfg.get("items.10086.name"), "霜月结晶")

    def test_json_fixture_matches_yaml(self):
        """两份样例同源：档位与引用必须一致，避免改了一边忘了另一边。"""
        yaml_data = loader.load(CONFIG_V01)
        json_data = json.loads((FIXTURES / "activity_v0.1.json").read_text(encoding="utf-8"))
        yaml_tiers = {t["id"]: (t.get("ratio"), t.get("count")) for t in yaml_data["tiers"]}
        json_tiers = {t["id"]: (t.get("ratio"), t.get("count")) for t in json_data["tiers"]}
        self.assertEqual(yaml_tiers, json_tiers)
        self.assertEqual(
            [o["id"] for o in yaml_data["downstream"]], [o["id"] for o in json_data["downstream"]]
        )


if __name__ == "__main__":
    unittest.main()
