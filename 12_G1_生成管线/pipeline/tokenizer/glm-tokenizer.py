#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""GLM Tokenizer 辅助进程（曦 2026-11-16 指令）
   Node 主程序经 stdin 传入 { model, messages }，本进程：
   1. 按 tokenizer-config.json 加载对应模型仓库 + 固定 revision 的 Tokenizer/Processor
      （不加载模型权重）；GLM-4.7 → AutoTokenizer；GLM-5.3-Flash → AutoProcessor
      （导入失败时降级 AutoTokenizer 并如实标注——两者均有 tokenizer.json 与 chat template）；
   2. 对【完整 messages】应用对应 chat template（add_generation_prompt=True）后精确计数——
      不是只统计 Brief 文本；
   3. 依赖缺失/仓库不可达/revision 未锁定时输出明确错误——绝不用字符估算冒充精确计数。
   stdout: {"ok":true,"count":N,"loader":"...","revision":"..."} 或 {"ok":false,"error":"..."}
"""
import sys
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def fail(code, message):
    sys.stdout.write(json.dumps({"ok": False, "error": code + "：" + message}, ensure_ascii=False))
    sys.stdout.write("\n")


def main():
    try:
        req = json.load(sys.stdin)
        model = req["model"]
        messages = req["messages"]
    except Exception as e:
        fail("BAD_REQUEST", "stdin 非法 JSON：" + str(e)[:120])
        return

    try:
        with open(os.path.join(HERE, "tokenizer-config.json"), encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        fail("CONFIG_ERROR", str(e)[:160])
        return

    mc = cfg.get("models", {}).get(model)
    if not mc:
        fail("MODEL_NOT_BOUND", "模型 " + model + " 未在 tokenizer-config.json 绑定")
        return
    if not mc.get("revision"):
        fail("REVISION_NOT_PINNED", "模型 " + model + " 的 revision 未锁定——必须固定 revision 后才可精确计数")
        return

    # 镜像与缓存（直连 HF 被网络策略阻断，走 hf-mirror；缓存不入仓库运行时）
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    os.environ.setdefault("HF_HOME", os.path.join(HERE, "cache"))

    try:
        from transformers import AutoTokenizer, AutoProcessor
    except Exception as e:
        fail("DEPENDENCY_MISSING", "transformers 未安装或版本不符——pip install 按 requirements 锁定版本: " + str(e)[:160])
        return

    kw = {"revision": mc["revision"], "trust_remote_code": False}
    used = None
    try:
        if mc["loader"] == "AutoProcessor":
            try:
                loader = AutoProcessor.from_pretrained(mc["repo"], **kw)
                used = "AutoProcessor"
            except Exception as pe:
                # 处理器导入/加载失败（如缺 torch）→ 降级 AutoTokenizer（tokenizer.json + chat template 均在）
                loader = AutoTokenizer.from_pretrained(mc["repo"], **kw)
                used = "AutoTokenizer（AutoProcessor 降级：" + str(pe)[:100] + "）"
        else:
            loader = AutoTokenizer.from_pretrained(mc["repo"], **kw)
            used = mc["loader"]
    except Exception as e:
        fail("LOAD_FAILED", "Tokenzier/Processor 加载失败（repo=" + mc["repo"] + " revision=" + mc["revision"][:12] + "…）：" + str(e)[:200])
        return

    try:
        # 对完整 messages 应用 chat template 并 tokenize——精确计数（含系统提示 + 回喂 + Brief 全部内容）
        ids = loader.apply_chat_template(messages, add_generation_prompt=True, tokenize=True)
        if ids is None or not hasattr(ids, "__len__"):
            # 某些实现返回 BatchFeature
            ids = loader.apply_chat_template(messages, add_generation_prompt=True, tokenize=True, return_dict=True)["input_ids"]
        if hasattr(ids[0], "__len__"):
            ids = ids[0]
        count = len(ids)
        sys.stdout.write(json.dumps({"ok": True, "count": count, "loader": used,
                                     "revision": mc["revision"], "templateApplied": True}, ensure_ascii=False))
        sys.stdout.write("\n")
    except Exception as e:
        fail("COUNT_FAILED", "chat template 应用/计数失败：" + str(e)[:200])


if __name__ == "__main__":
    main()
