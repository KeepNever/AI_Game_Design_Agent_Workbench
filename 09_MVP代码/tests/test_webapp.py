"""本地交互工具：起真服务、走完整流程（上传 → 分析 → 导出）。"""

import io
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

from gdw import webapp
from tools.make_dirty_fixture import build

from . import FIXTURES


def call(port: int, path: str, body: bytes | None = None):
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def call_json(port: int, path: str, payload: dict | None = None, raw: bytes | None = None):
    """payload=None 且 raw=None → GET；raw 给了 → 原样字节 POST；否则 JSON POST。"""
    if raw is not None:
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=raw)
    elif payload is not None:
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
    else:
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status, body = response.status, response.read()
    except urllib.error.HTTPError as exc:
        status, body = exc.code, exc.read()
    return status, json.loads(body.decode("utf-8"))


class WebAppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dirty = Path(cls.tmp.name) / "dirty.xlsx"
        build(str(cls.dirty))
        cls.server = webapp.start(port=0, open_browser=False)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        call_json(self.port, "/api/reset", {})

    def test_index_served(self):
        status, raw = call(self.port, "/")
        self.assertEqual(status, 200)
        self.assertIn("配置变更工作台".encode(), raw)

    def test_full_flow(self):
        # 1. 上传规则包 + 脏表
        status, res = call_json(
            self.port,
            "/api/upload?kind=rules&name=rules.yaml",
            raw=(FIXTURES / "rules_v0.1.yaml").read_bytes(),
        )
        self.assertTrue(res["ok"])
        body = self.dirty.read_bytes()
        status, res = call_json(
            self.port, "/api/upload?kind=config&name=dirty.xlsx", raw=body
        )
        self.assertEqual(status, 200)
        self.assertTrue(res["ok"])
        self.assertEqual(len(res["overview"]["downstream"]), 4)

        # 2. 改数并分析
        status, res = call_json(
            self.port, "/api/analyze", {"changes": {"tiers.T_MID.count": "8"}}
        )
        self.assertEqual(status, 200)
        ids = {o["id"] for o in res["affected"]}
        # 脏表里公告引用的是 ratio 和道具名，不引用 count——只有榜单和邮件该出现
        self.assertEqual(ids, {"OBJ_RANK", "OBJ_MAIL"})
        blocking = [r for r in res["rules"] if r["status"] == "违反" and r["level"] == "阻断"]
        self.assertTrue(blocking)

        # 3. 勾选已同步后导出
        status, raw = call(self.port, "/api/export?format=txt&synced=OBJ_RANK")
        text = raw.decode("utf-8")
        self.assertIn("☑ 排行榜奖励展示", text)
        self.assertIn("□ 发奖邮件模板", text)
        self.assertIn("已同步", text)

    def test_rules_upload_keeps_config(self):
        """★换规则包不再清空配置——2026-11-10 曦实测抓到的 bug：页面显示着编辑器，
        服务端却把配置丢了，点分析就是「先上传配置」。现在的语义：规则包只换规则。"""
        status, res = call_json(
            self.port,
            "/api/upload?kind=config&name=c.yaml",
            raw=(FIXTURES / "activity_cross_table.yaml").read_bytes(),
        )
        self.assertTrue(res["ok"])
        status, res = call_json(
            self.port,
            "/api/upload?kind=rules&name=rules.yaml",
            raw=(FIXTURES / "rules_cross_table.yaml").read_bytes(),
        )
        self.assertTrue(res["ok"])
        self.assertIn("note", res)
        # 配置还在：分析照常能跑
        status, res = call_json(self.port, "/api/analyze", {"changes": {}})
        self.assertTrue(res["ok"])

    def test_analyze_before_upload(self):
        status, res = call_json(self.port, "/api/analyze", {"changes": {}})
        self.assertEqual(status, 400)

    def test_table_pagination(self):
        status, res = call_json(self.port, "/api/upload?kind=config&name=c.yaml",
                                raw=(FIXTURES / "activity_cross_table.yaml").read_bytes())
        status, res = call_json(self.port, "/api/table?name=items&start=0&count=1")
        self.assertEqual(res["total"], 2)
        self.assertEqual(len(res["fields"]), 3)  # 一行 3 个非 id 字段

    def test_bad_yaml_gives_readable_error(self):
        status, res = call_json(self.port, "/api/upload?kind=config&name=bad.yaml", raw=b": : :")
        self.assertFalse(res["ok"])


if __name__ == "__main__":
    unittest.main()


class SyncAndDiffTest(unittest.TestCase):
    """v0.2 收尾三件事：勾选落盘、恢复、diff 打通。"""

    @classmethod
    def setUpClass(cls):
        import threading

        cls.server = webapp.start(port=0, open_browser=False)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        call_json(self.port, "/api/reset", {})
        import shutil

        sync_dir = Path(__file__).resolve().parent.parent / ".gdw-sync"
        if sync_dir.exists():
            shutil.rmtree(sync_dir)

    def test_sync_persists_across_reupload(self):
        status, res = call_json(
            self.port,
            "/api/upload?kind=config&name=c.yaml",
            raw=(FIXTURES / "activity_cross_table.yaml").read_bytes(),
        )
        activity_id = res["overview"]["activity"]["id"]

        # 勾选 → 落盘
        status, res = call_json(
            self.port, "/api/sync",
            {"object_id": "OBJ_SHOP", "synced": True},
        )
        self.assertTrue(res["ok"])
        self.assertIn("OBJ_SHOP", res["synced"])

        # 重传同一份配置 → 勾选历史恢复
        status, res = call_json(
            self.port,
            "/api/upload?kind=config&name=c.yaml",
            raw=(FIXTURES / "activity_cross_table.yaml").read_bytes(),
        )
        self.assertIn("OBJ_SHOP", res["overview"]["synced"])

        # 取消勾选 → 落盘移除
        status, res = call_json(
            self.port, "/api/sync", {"object_id": "OBJ_SHOP", "synced": False}
        )
        self.assertNotIn("OBJ_SHOP", res["synced"])
        self.assertIsNotNone(activity_id)

    def test_diff_flow(self):
        # 先传旧版本，再传新版本
        call_json(self.port, "/api/upload?kind=before&name=old.yaml",
                  raw=(FIXTURES / "activity_v0.1.yaml").read_bytes())
        call_json(self.port, "/api/upload?kind=config&name=new.yaml",
                  raw=(FIXTURES / "activity_v0.1_改后.yaml").read_bytes())
        status, res = call_json(self.port, "/api/diff", {})
        self.assertTrue(res["ok"])
        self.assertEqual(len(res["changes"]), 1)
        self.assertEqual(res["changes"][0]["path"], "activity.server_population")
        self.assertEqual(res["changes"][0]["new"], 600)
        # diff 之后导出可用
        status, raw = call(self.port, "/api/export?format=txt")
        self.assertIn("1200 → 600", raw.decode("utf-8"))

    def test_diff_without_before(self):
        call_json(self.port, "/api/upload?kind=config&name=new.yaml",
                  raw=(FIXTURES / "activity_v0.1.yaml").read_bytes())
        status, res = call_json(self.port, "/api/diff", {})
        self.assertEqual(status, 400)
