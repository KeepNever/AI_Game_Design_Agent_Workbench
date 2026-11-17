import unittest

from gdw import expr


class ExprTest(unittest.TestCase):
    def test_arithmetic_and_compare(self):
        ns = {"activity": {"server_population": 1200}, "tiers": {"T_MID": {"count": 5}}}
        self.assertEqual(expr.evaluate("activity.server_population * 0.1", ns), 120.0)
        self.assertTrue(expr.evaluate("tiers.T_MID.count / activity.server_population < 0.01", ns))

    def test_chained_comparison(self):
        ns = {"a": 1, "b": 5, "c": 9}
        self.assertTrue(expr.evaluate("a < b < c", ns))
        self.assertFalse(expr.evaluate("a < b > c", ns))

    def test_bool_short_circuit(self):
        ns = {"x": 1}
        # 后半段引用不存在的字段，但因为前半段已经是 False，不应报错
        self.assertFalse(expr.evaluate("x == 2 and nope.deeper == 1", ns))

    def test_round_function(self):
        ns = {"p": 1200, "r": 0.1}
        self.assertEqual(expr.evaluate("round(p * r)", ns), 120)

    def test_unknown_field_message(self):
        with self.assertRaises(expr.ExprError) as ctx:
            expr.evaluate("tiers.T_MID.missing == 1", {"tiers": {"T_MID": {"count": 1}}})
        self.assertIn("字段不存在", str(ctx.exception))

    def test_rejects_dunder_call(self):
        """不允许调用任意函数——这是不用 eval 的意义所在。"""
        for bad in ["__import__('os').system('echo hi')", "open('x')", "eval('1+1')"]:
            with self.assertRaises(expr.ExprError):
                expr.evaluate(bad, {})

    def test_rejects_statement(self):
        with self.assertRaises(expr.ExprError):
            expr.evaluate("import os", {})

    def test_table_path_normalized(self):
        """items.10086.name 在 Python 里不合法，求值前会改写成 items["10086"].name。"""
        self.assertEqual(expr.normalize("items.10086.sell_price"), 'items["10086"].sell_price')
        ns = {"items": {"10086": {"sell_price": 10}}}
        self.assertTrue(expr.evaluate("items.10086.sell_price <= 20", ns))
        self.assertEqual(expr.evaluate("items.10086.sell_price", ns), 10)

    def test_normalize_leaves_plain_paths(self):
        self.assertEqual(expr.normalize("tiers.T_MID.count"), "tiers.T_MID.count")
        self.assertEqual(expr.normalize("a.b.c"), "a.b.c")

    def test_in_operator_with_list(self):
        ns = {"m": {"unresolved_refs": 0}}
        self.assertTrue(expr.evaluate("m.unresolved_refs in [0, 'x']", ns))


if __name__ == "__main__":
    unittest.main()
