"""本地交互工具：上传表 → 改数 → 算影响 → 勾「已同步」→ 导出。

启动：``python -m gdw web``（自动开浏览器，只监听 127.0.0.1）。
服务端只做三件事：读表（复用 loader）、算影响（复用 deps/rules）、出确认单（复用 sheet）。
页面本身是单文件 HTML，无外部资源。

**刻意不做的事**：不存历史、不做多人、不做登录。它是给一个人在本地核对配置用的，
把这些做进去就违背 v0.1 的边界了。
"""

from __future__ import annotations

import json
import tempfile
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import deps, loader, quest as quest_mod, rules as rules_mod, sheet, structure as structure_mod

SYNC_DIR = Path(__file__).resolve().parent.parent / ".gdw-sync"
from .model import Config, ConfigError

STATE: dict = {"config": None, "rules": [], "analysis": None, "name": "",
               "before_config": None, "synced": {}}


def _coerce(text: str):
    text = str(text).strip()
    low = text.lower()
    if low in {"true", "false"}:
        return low == "true"
    for cast in (int, float):
        try:
            return cast(text)
        except ValueError:
            continue
    return text


def _overview(config: Config) -> dict:
    return {
        "loaded": True,
        "name": STATE.get("name", ""),
        "activity": config.activity,
        "tiers": [
            {"id": t.id, "name": t.name, "count": t.count, "ratio": t.ratio}
            for t in config.tiers.values()
        ],
        "downstream": [
            {"id": d.id, "name": d.name, "owner": d.owner, "refs": d.refs}
            for d in config.downstream
        ],
        "tables": {
            name: {"rows": len(rows), "columns": list(rows[0].keys()) if rows else []}
            for name, rows in config.tables.items()
        },
        "rules_count": len(STATE["rules"]),
        "warnings": config.warnings,
        "quest": config.quest is not None,
        "synced": sorted(STATE["synced"].keys()),
        "has_before": STATE["before_config"] is not None,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # 安静点，控制台留给结果
        pass

    # ---------- 基础 ----------

    def _json(self, payload: dict, code: int = 200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    # ---------- 路由 ----------

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/":
            body = UI_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif parsed.path == "/api/state":
            if STATE["config"] is None:
                self._json({"loaded": False})
            else:
                self._json(_overview(STATE["config"]))
        elif parsed.path == "/api/quest":
            self._quest()
        elif parsed.path == "/api/table":
            self._json(self._table(query))
        elif parsed.path == "/api/export":
            self._export(query)
        else:
            self._json({"ok": False, "error": "未知路径"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        routes = {
            "/api/upload": lambda: self._upload(query),
            "/api/analyze": self._analyze,
            "/api/sync": self._sync,
            "/api/diff": self._diff,
            "/api/reset": self._reset,
        }
        handler = routes.get(parsed.path)
        if handler is None:
            self._json({"ok": False, "error": "未知路径"}, 404)
            return
        handler()

    def _reset(self):
        STATE.update(
            {"config": None, "rules": [], "analysis": None, "name": "",
             "before_config": None, "synced": {}}
        )
        self._json({"ok": True})

    # ---------- 实现 ----------

    def _sync_file(self, config: Config) -> Path:
        key = str(config.activity.get("id") or "default").replace("/", "_")
        return SYNC_DIR / f"{key}.json"

    def _load_sync(self, config: Config) -> dict:
        file = self._sync_file(config)
        if file.exists():
            try:
                return json.loads(file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _save_sync(self, config: Config) -> None:
        SYNC_DIR.mkdir(parents=True, exist_ok=True)
        self._sync_file(config).write_text(
            json.dumps(STATE["synced"], ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _upload(self, query: dict):
        kind = (query.get("kind") or ["config"])[0]
        name = (query.get("name") or ["未命名"])[0]
        body = self._body()
        if not body:
            self._json({"ok": False, "error": "没有收到文件内容"}, 400)
            return
        suffix = Path(name).suffix or ".yaml"
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
                handle.write(body)
                tmp = handle.name
            if kind == "before":
                STATE["before_config"] = Config.from_dict(loader.load(tmp), path="旧版本:" + name)
                self._json({"ok": True, "kind": "before"})
                return
            if kind == "rules":
                STATE["rules"] = loader.load_rules(tmp)
                note = (
                    "规则包已换。注意：如果它和当前配置不是一套，规则会大量「无法判定」——那是正常的，不是坏了。"
                    if STATE["config"] is not None
                    else "规则包已加载。"
                )
                self._json({"ok": True, "kind": "rules", "count": len(STATE["rules"]), "note": note})
                return
            config = Config.from_dict(loader.load(tmp), path=name)
            STATE["config"] = config
            STATE["name"] = name
            STATE["synced"] = self._load_sync(config)
            self._json({"ok": True, "kind": "config", "overview": _overview(config)})
        except loader.LoadError as exc:
            self._json({"ok": False, "error": f"读不了：{exc}"}, 400)
        except ConfigError as exc:
            self._json({"ok": False, "error": "配置不合法", "details": exc.errors}, 400)
        except Exception as exc:  # 坏 YAML、坏编码……总之给一句人话，不让连接直接断
            self._json({"ok": False, "error": f"处理失败：{type(exc).__name__}: {exc}"}, 400)
        finally:
            Path(tmp).unlink(missing_ok=True)

    def _sync(self):
        config = STATE["config"]
        if config is None:
            self._json({"ok": False, "error": "先上传配置"}, 400)
            return
        try:
            payload = json.loads(self._body() or b"{}")
        except json.JSONDecodeError:
            self._json({"ok": False, "error": "请求体不是 JSON"}, 400)
            return
        object_id = str(payload.get("object_id") or "")
        if not object_id:
            self._json({"ok": False, "error": "缺 object_id"}, 400)
            return
        from datetime import datetime

        if payload.get("synced"):
            STATE["synced"][object_id] = {"synced": True, "at": datetime.now().isoformat(timespec="minutes")}
        else:
            STATE["synced"].pop(object_id, None)
        self._save_sync(config)
        self._json({"ok": True, "synced": sorted(STATE["synced"].keys())})

    def _diff(self):
        before = STATE["before_config"]
        after = STATE["config"]
        if before is None or after is None:
            self._json({"ok": False, "error": "需要两个版本：先传配置（新），再传旧版本"}, 400)
            return
        changes, notes = deps.diff_configs(before, after)
        if not changes:
            self._json({"ok": True, "changes": [], "notes": notes,
                        "message": "两个版本没有数值差异。"})
            return
        payload = {c.path: c.new for c in changes}
        analysis = deps.analyze(before, payload)
        report = rules_mod.run(analysis.after, STATE["rules"])
        STATE["analysis"] = analysis
        data = sheet.as_dict(analysis, report)
        data.update(
            {
                "ok": True,
                "notes": notes,
                "rule_summary": report.summary(),
                "layers": {label: [ok, total] for label, (ok, total) in report.by_source().items()},
            }
        )
        self._json(data)

    def _analyze(self):
        config = STATE["config"]
        if config is None:
            self._json({"ok": False, "error": "先上传配置", "recover": True}, 400)
            return
        try:
            payload = json.loads(self._body() or b"{}")
            changes = {str(k): _coerce(v) for k, v in (payload.get("changes") or {}).items()}
            analysis = deps.analyze(config, changes)
        except KeyError as exc:
            self._json({"ok": False, "error": str(exc)}, 400)
            return
        except Exception as exc:  # 数值转换失败等，给可读错误而不是 500
            self._json({"ok": False, "error": f"算不了：{exc}"}, 400)
            return
        report = rules_mod.run(analysis.after, STATE["rules"])
        STATE["analysis"] = analysis
        data = sheet.as_dict(analysis, report)
        data.update(
            {
                "ok": True,
                "rule_summary": report.summary(),
                "layers": {label: [ok, total] for label, (ok, total) in report.by_source().items()},
            }
        )
        self._json(data)

    def _quest(self):
        config = STATE["config"]
        if config is None:
            self._json({"ok": False, "error": "先上传配置"}, 400)
            return
        if not config.quest:
            self._json({"ok": False, "error": "这份配置没有 quest 段"}, 400)
            return
        try:
            findings = structure_mod.check_structure(config.quest)
            result = quest_mod.check_quest(config.quest)
            per_target = quest_mod.check_per_target(config.quest)
        except quest_mod.QuestError as exc:
            self._json({"ok": False, "error": f"任务图数据有问题：{exc}"}, 400)
            return
        self._json(
            {
                "ok": True,
                "result": result,
                "describe": quest_mod.describe(result),
                "findings": findings,
                "per_target": [
                    {"target": e["target"], "result": e["result"],
                     "blocking": [b["condition"] for b in e.get("blocking_edges", [])]}
                    for e in per_target
                ],
            }
        )

    def _table(self, query: dict):
        config = STATE["config"]
        if config is None:
            self._json({"ok": False, "error": "先上传配置"}, 400)
            return
        name = (query.get("name") or [""])[0]
        start = int((query.get("start") or ["0"])[0])
        count = min(int((query.get("count") or ["30"])[0]), 200)
        rows = config.tables.get(name)
        if rows is None:
            self._json({"ok": False, "error": f"没有这张表：{name}"}, 404)
            return
        slice_rows = rows[start : start + count]
        fields = []
        for row in slice_rows:
            row_id = row.get("id")
            for key, value in row.items():
                if key == "id":
                    continue
                fields.append({"path": f"{name}.{row_id}.{key}", "field": key, "value": value})
        self._json(
            {
                "ok": True,
                "total": len(rows),
                "start": start,
                "fields": fields,
                "row_ids": [str(row.get("id")) for row in slice_rows],
            }
        )

    def _export(self, query: dict):
        analysis = STATE["analysis"]
        if analysis is None:
            self._json({"ok": False, "error": "先算一次影响面"}, 400)
            return
        fmt = (query.get("format") or ["txt"])[0]
        synced = set((query.get("synced") or [""])[0].split(",")) - {""}
        config = STATE["config"]
        report = rules_mod.run(analysis.after, STATE["rules"])
        if fmt == "md":
            text = sheet.render_markdown(config, analysis, report, synced=synced)
        else:
            text = sheet.render_plain(config, analysis, report, synced=synced)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Disposition", f"attachment; filename=confirm.{fmt}")
        body = text.encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start(port: int = 8765, open_browser: bool = True) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    bound = server.server_address[1]
    url = f"http://127.0.0.1:{bound}"
    print(f"交互工具已启动：{url}  （Ctrl+C 停止）")
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    return server


def serve_forever(port: int = 8765, open_browser: bool = True) -> None:
    start(port, open_browser).serve_forever()


# ---------- 页面 ----------

UI_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>配置变更工作台</title>
<style>
:root{--navy:#17365D;--ink:#1F2937;--muted:#6B7280;--line:#E5E7EB;--bg:#F5F7FA;
--fail:#B42318;--failbg:#FBE9E7;--pass:#0F7B4F;--passbg:#E6F4EA;--warn:#B54708;--warnbg:#FFF4E0;}
*{box-sizing:border-box;}
body{margin:0;padding:20px 24px 40px;background:var(--bg);color:var(--ink);
font-family:"微软雅黑",system-ui,sans-serif;font-size:13px;line-height:1.6;}
.wrap{max-width:1100px;margin:0 auto;}
header{background:var(--navy);border-radius:10px;padding:16px 20px;color:#fff;}
h1{margin:0;font-size:18px;}
.sub{margin-top:4px;font-size:11.5px;color:#B9C7DA;}
.card{background:#fff;border:1px solid var(--line);border-radius:9px;margin-top:14px;overflow:hidden;}
.hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
border-bottom:1px solid var(--line);background:#FAFBFC;}
.hd h2{margin:0;font-size:12.5px;color:var(--navy);}
.hd .tag{font-size:10px;color:var(--muted);}
.bd{padding:12px 14px;}
button{background:var(--navy);color:#fff;border:none;border-radius:6px;padding:7px 14px;
font-size:12px;cursor:pointer;margin-right:8px;}
button.ghost{background:#fff;color:var(--navy);border:1px solid var(--line);}
button:disabled{opacity:.45;cursor:not-allowed;}
input[type=text],input[type=number]{border:1px solid var(--line);border-radius:5px;
padding:5px 8px;font-size:12px;font-family:inherit;}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.kv{display:grid;grid-template-columns:110px 1fr;gap:6px 10px;font-size:12px;}
.kv .k{color:var(--muted);}
.badge{display:inline-block;font-size:10px;padding:1px 7px;border-radius:10px;font-weight:600;}
.ok{color:var(--pass);background:var(--passbg);}
.no{color:var(--fail);background:var(--failbg);}
.q{color:var(--warn);background:var(--warnbg);}
table{width:100%;border-collapse:collapse;font-size:12px;}
th{background:#F3F6FA;color:var(--navy);text-align:left;padding:6px 9px;
border-bottom:1px solid var(--line);font-size:11.5px;white-space:nowrap;}
td{padding:6px 9px;border-bottom:1px solid #F0F2F5;}
code{background:#F3F5F9;border:1px solid #E7EBF1;border-radius:4px;padding:1px 5px;
font-family:Consolas,monospace;font-size:11px;}
.obj{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #F0F2F5;}
.obj:last-child{border-bottom:none;}
.obj input{margin-top:3px;transform:scale(1.2);}
.err{background:var(--failbg);border:1px solid #F0B4B4;border-radius:7px;padding:9px 12px;
color:var(--fail);font-size:12px;margin-top:10px;}
.hint{background:var(--warnbg);border:1px solid #F2C94C;border-radius:8px;padding:9px 12px;
font-size:12px;margin-top:10px;}
.muted{color:var(--muted);font-size:11px;}
.step-no{display:inline-block;width:20px;height:20px;border-radius:10px;background:var(--navy);
color:#fff;text-align:center;line-height:20px;font-size:11px;margin-right:6px;}
.fieldrow{display:grid;grid-template-columns:200px 160px 1fr;gap:8px;align-items:center;
padding:4px 0;border-bottom:1px dashed #EEF1F5;}
.fieldrow .path{font-family:Consolas,monospace;font-size:11px;color:#334155;overflow:hidden;
text-overflow:ellipsis;white-space:nowrap;}
.changed{background:#FDF3E3;}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
.tab{border:1px solid var(--line);border-radius:6px;padding:4px 10px;font-size:11.5px;cursor:pointer;background:#fff;}
.tab.on{background:var(--navy);color:#fff;}
.changes-count{font-weight:700;color:#B42318;}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>配置变更工作台</h1>
  <div class="sub">上传表 → 改数 → 算影响面 → 勾「已同步」→ 导出确认单　|　内核 v0.1（冻结）：只核对已登记的引用</div>
</header>

<div class="card">
  <div class="hd"><h2><span class="step-no">1</span>上传</h2><span class="tag">xlsx / yaml / json；规则包可选</span></div>
  <div class="bd">
    <p style="margin:4px 0">配置表（新版本）：<input type="file" id="fileConfig" accept=".xlsx,.yaml,.yml,.json"></p>
    <p style="margin:4px 0">旧版本（可选，上传后可一键对比）：<input type="file" id="fileBefore" accept=".xlsx,.yaml,.yml,.json">
      　规则包（可选）：<input type="file" id="fileRules" accept=".yaml,.yml,.json"></p>
    <p style="margin:4px 0"><button id="btnUpload">上传</button>
      　<button class="ghost" id="btnDiff" disabled>和旧版本对比</button>
      　<button class="ghost" id="btnReset">清空重来</button></p>
    <div id="uploadMsg" class="muted">还没上传。没有规则包就不跑规则，只算影响面。</div>
    <div id="overview"></div>
  </div>
</div>

<div class="card">
  <div class="hd"><h2><span class="step-no">2</span>改数</h2>
    <span class="tag">改动 <span class="changes-count" id="chgCount">0</span> 项　<button class="ghost" id="btnClear" style="margin-left:8px">清空改动</button></span></div>
  <div class="bd" id="editor" style="display:none">
    <div class="tabs" id="tabs"></div>
    <div id="fields"></div>
    <p class="muted" id="moreWrap" style="margin-top:8px"><button class="ghost" id="btnMore">继续加载 30 行</button></p>
  </div>
</div>

<div class="card">
  <div class="hd"><h2><span class="step-no">3</span>影响面</h2>
    <span class="tag"><button id="btnAnalyze">算影响面</button>
    <button class="ghost" id="btnExportTxt" disabled>导出 txt</button>
    <button class="ghost" id="btnExportMd" disabled>导出 md</button></span></div>
  <div class="bd" id="result"><p class="muted">改完数点「算影响面」。</p></div>
</div>

<div class="err" id="err" style="display:none"></div>
</div>

<script>
const S = {changes:{}, synced:new Set(), table:null, start:0, total:0};

async function api(path, opts){ const r = await fetch(path, opts); return await r.json(); }
function err(msg){ const e = document.getElementById('err'); e.style.display = msg?'block':'none'; e.textContent = msg||''; }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function chgCount(){ document.getElementById('chgCount').textContent = Object.keys(S.changes).length; }

// ---------- 上传 ----------
document.getElementById('btnUpload').onclick = async () => {
  err('');
  const fc = document.getElementById('fileConfig').files[0];
  const fb = document.getElementById('fileBefore').files[0];
  const fr = document.getElementById('fileRules').files[0];
  if(!fc && !fb && !fr){ err('选一个文件先。'); return; }
  try{
    if(fc){
      const body = await fc.arrayBuffer();
      const res = await api('/api/upload?kind=config&name='+encodeURIComponent(fc.name),
        {method:'POST', body});
      if(!res.ok){ err(res.error + (res.details?'：'+res.details.join('；'):'')); return; }
      renderOverview(res.overview);
      document.getElementById('btnDiff').disabled = !res.overview.has_before;
    }
    if(fb){
      const body = await fb.arrayBuffer();
      const res = await api('/api/upload?kind=before&name='+encodeURIComponent(fb.name),
        {method:'POST', body});
      if(!res.ok){ err(res.error); return; }
      document.getElementById('btnDiff').disabled = false;
    }
    if(fr){
      const body = await fr.arrayBuffer();
      const res = await api('/api/upload?kind=rules&name='+encodeURIComponent(fr.name),
        {method:'POST', body});
      if(!res.ok){ err(res.error); return; }
      document.getElementById('uploadMsg').textContent = '规则包已加载：'+res.count+' 条。'+(res.note||'');
    }
  }catch(e){ err('上传失败：'+e); }
};

document.getElementById('btnDiff').onclick = async () => {
  err('');
  const res = await api('/api/diff', {method:'POST'});
  if(!res.ok){ err(res.error); return; }
  if(res.message){ err(res.message); return; }
  if(res.notes && res.notes.length){
    err('结构变化（不推导影响）：' + res.notes.join('；'));
  }
  S.changes = {};
  for(const c of res.changes){ S.changes[c.path] = c.new; }
  chgCount();
  hasAnalysis = true;
  renderResult(res);
  document.getElementById('btnExportTxt').disabled = false;
  document.getElementById('btnExportMd').disabled = false;
};

document.getElementById('btnReset').onclick = async () => {
  await api('/api/reset', {method:'POST'});
  location.reload();
};

function renderOverview(o){
  document.getElementById('uploadMsg').textContent = '已加载：'+o.name;
  S.synced = new Set(o.synced || []);
  let html = '<div class="grid"><div>';
  html += '<div class="kv">';
  for(const [k,v] of Object.entries(o.activity)){
    html += '<div class="k">'+esc(k)+'</div><div><b>'+esc(v)+'</b></div>';
  }
  html += '</div></div><div>';
  html += '<div class="kv">';
  html += '<div class="k">档位</div><div>'+o.tiers.map(t=>esc(t.id)).join('、')+'</div>';
  html += '<div class="k">下游对象</div><div>'+o.downstream.length+' 个</div>';
  html += '<div class="k">外部表</div><div>'+(Object.keys(o.tables).length?
    Object.entries(o.tables).map(([n,t])=>esc(n)+'('+t.rows+'行)').join('、'):'无')+'</div>';
  html += '<div class="k">规则</div><div>'+o.rules_count+' 条</div>';
  html += '</div>';
  if(o.warnings && o.warnings.length){
    html += '<div class="muted" style="margin-top:6px">提醒：'+o.warnings.map(esc).join('；')+'</div>';
  }
  html += '</div></div>';
  html += '<div class="muted" style="margin-top:8px">下游对象：'+
    o.downstream.map(d=>esc(d.name)+'（'+esc(d.owner||'—')+'）').join('、')+'</div>';
  document.getElementById('overview').innerHTML = html;
  loadEditor(o);
}

// ---------- 编辑器 ----------
async function loadEditor(o){
  document.getElementById('editor').style.display = 'block';
  document.getElementById('fields').innerHTML = '';
  let html = '<div class="fieldrow"><div class="path">activity.*</div><div></div><div></div></div>';
  for(const [k,v] of Object.entries(o.activity)){
    const p = 'activity.'+k;
    html += fieldRow(p, k, v);
  }
  html += '<div class="fieldrow"><div class="path">tiers.*</div><div></div><div></div></div>';
  for(const t of o.tiers){
    for(const [k,v] of Object.entries({count:t.count, ratio:t.ratio})){
      if(v===null||v===undefined) continue;
      const p = 'tiers.'+t.id+'.'+k;
      html += fieldRow(p, t.name+' · '+k, v);
    }
  }
  document.getElementById('fields').innerHTML = html;
  // 外部表：一个 tab 一张表，按需加载
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '';
  for(const name of Object.keys(o.tables)){
    const b = document.createElement('button');
    b.className = 'tab'; b.textContent = name+'('+o.tables[name].rows+'行)';
    b.onclick = () => { S.table=name; S.start=0;
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
      b.classList.add('on');
      document.getElementById('fields').querySelectorAll('[data-table]').forEach(x=>x.remove());
      document.getElementById('moreWrap').style.display='block';
      loadTable(name, 0, true); };
    tabs.appendChild(b);
  }
}

document.addEventListener('click', async (e) => {
  if(e.target && e.target.id === 'btnQuest'){
    const box = document.getElementById('questOut');
    box.textContent = '搜索中……';
    const res = await api('/api/quest');
    if(!res.ok){ box.innerHTML = '<span style="color:var(--fail)">'+esc(res.error)+'</span>'; return; }
    const r = res.result;
    const cls = r.result==='SAT'?'ok':(r.result==='UNSAT'?'no':'q');
    box.innerHTML = '<span class="badge '+cls+'" style="font-size:12px">'+esc(r.result)+'</span> '
      + '<span style="font-size:12px">'+esc(res.describe)+'</span>';
  }
});

function fieldRow(path, label, value){
  return '<div class="fieldrow" data-path="'+esc(path)+'">'
    +'<div class="path" title="'+esc(path)+'">'+esc(label)+'</div>'
    +'<div class="muted">'+esc(path)+'</div>'
    +'<div><input type="text" value="'+esc(value)+'" data-path="'+esc(path)+'" data-old="'+esc(value)+'" style="width:100%"></div></div>';
}

async function loadTable(name, start, replace){
  const res = await api('/api/table?name='+encodeURIComponent(name)+'&start='+start+'&count=30');
  if(!res.ok){ err(res.error); return; }
  S.total = res.total;
  const box = document.getElementById('fields');
  if(replace){ box.querySelectorAll('[data-table]').forEach(x=>x.remove()); }
  let html = replace ? '<div class="fieldrow" data-table="1"><div class="path">'+esc(name)+'.*</div><div></div><div></div></div>' : '';
  for(const f of res.fields){
    html += '<div class="fieldrow" data-table="1">'+fieldRow(f.path, f.field, f.value)+'</div>';
  }
  const more = document.getElementById('moreWrap');
  more.insertAdjacentHTML('beforebegin', html);
  document.getElementById('btnMore').style.display = (start+30 >= res.total)?'none':'inline-block';
  bindInputs();
}

document.getElementById('btnMore').onclick = () => { if(S.table) loadTable(S.table, S.start+30, false); };

function bindInputs(){
  document.querySelectorAll('#fields input[type=text]').forEach(inp => {
    if(inp.dataset.bound) return;
    inp.dataset.bound = '1';
    inp.addEventListener('input', () => {
      const path = inp.dataset.path;
      const row = inp.closest('.fieldrow');
      if(inp.value === inp.dataset.old){ delete S.changes[path]; row.classList.remove('changed'); }
      else { S.changes[path] = inp.value; row.classList.add('changed'); }
      chgCount();
    });
  });
}
bindInputs();

document.getElementById('btnClear').onclick = () => {
  S.changes = {};
  document.querySelectorAll('#fields input').forEach(i=>{ i.value = i.dataset.old; });
  document.querySelectorAll('.fieldrow').forEach(r=>r.classList.remove('changed'));
  chgCount();
};

// ---------- 影响面 ----------
document.getElementById('btnAnalyze').onclick = async () => {
  err('');
  const res = await api('/api/analyze', {method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({changes:S.changes})});
  if(!res.ok){
    err(res.error);
    if(res.recover){  // 服务端状态和页面不同步（比如中途清空过），自动拉一次
      const st = await api('/api/state');
      if(st.loaded){ renderOverview(st); err('页面状态和服务端没对上，已自动恢复。重新点一次「算影响面」。'); }
    }
    return;
  }
  hasAnalysis = true;
  renderResult(res);
  document.getElementById('btnExportTxt').disabled = false;
  document.getElementById('btnExportMd').disabled = false;
};

function renderResult(a){
  S.synced.forEach(id => { if(!a.affected.some(x=>x.id===id)) S.synced.delete(id); });
  let html = '';
  html += '<div class="grid"><div><div class="kv">'
    +'<div class="k">本次改动</div><div><b class="changes-count">'+a.changes.length+'</b> 项</div>'
    +'<div class="k">规则</div><div>'+esc(a.rule_summary)+'</div>'
    +'<div class="k">分层</div><div>'+Object.entries(a.layers||{}).map(([l,v])=>esc(l)+' '+v[0]+'/'+v[1]).join('，')+'</div>'
    +'</div></div><div><div class="kv">'
    +'<div class="k">连带失效</div><div>'+a.stale.length+'</div>'
    +'<div class="k">待确认对象</div><div><b>'+a.affected.length+'</b> 个（已勾 '+S.synced.size+'）</div>'
    +'</div></div></div>';

  html += '<table style="margin-top:10px"><tr><th>字段</th><th>变化</th><th>路径</th></tr>';
  for(const c of a.changes){
    html += '<tr><td>'+esc(c.label)+'</td><td><s style="color:#9AA4B2">'+esc(c.old)+'</s>'
      +' → <b style="color:var(--fail)">'+esc(c.new)+'</b></td><td><code>'+esc(c.path)+'</code></td></tr>';
  }
  html += '</table>';

  if(a.stale.length){
    html += '<p style="margin:10px 0 2px"><b>连带失效</b></p><table><tr><th>字段</th><th>当前</th><th>应为</th></tr>';
    for(const st of a.stale){
      html += '<tr><td><code>'+esc(st.path)+'</code></td><td>'+esc(st.configured)
        +'</td><td style="color:var(--fail)">'+esc(st.expected)+'</td></tr>';
    }
    html += '</table>';
  }

  html += '<p style="margin:10px 0 2px"><b>规则</b></p><table><tr><th>规则</th><th>结果</th><th>说明</th></tr>';
  for(const r of a.rules){
    const cls = r.status==='通过'?'ok':(r.status==='违反'?'no':'q');
    html += '<tr><td><code>'+esc(r.rule_id)+'</code> '+esc(r.name)+'</td>'
      +'<td><span class="badge '+cls+'">'+esc(r.status)+'</span></td>'
      +'<td style="color:var(--muted)">'+esc(r.detail)+'</td></tr>';
  }
  html += '</table>';

  html += '<p style="margin:10px 0 2px"><b>需要确认的对象（勾上 = 已同步）</b></p>';
  if(!a.affected.length){ html += '<p class="muted">没有下游对象引用这几个字段。</p>'; }
  for(const o of a.affected){
    const checked = S.synced.has(o.id) ? 'checked' : '';
    html += '<div class="obj"><input type="checkbox" data-id="'+esc(o.id)+'" '+checked+'>'
      +'<div><b>'+esc(o.name)+'</b> <span class="muted">（'+esc(o.owner||'—')+' · '+esc(o.kind)+'）</span><br>'
      +o.refs.map(r=>'<code>'+esc(r)+'</code>').join(' ')+'</div></div>';
  }
  html += '</div>';

  if((a.hints||[]).length){
    html += '<div class="hint"><b>推不出来的部分（必须人工确认）</b><br>'
      + a.hints.map(h=>'· '+esc(h)).join('<br>') + '</div>';
  }
  html += '<p class="muted">没列出来的对象 ≠ 没有影响，只是没登记。导出时会带上勾选状态。</p>';
  document.getElementById('result').innerHTML = html;

  document.querySelectorAll('#result input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      if(cb.checked) S.synced.add(cb.dataset.id); else S.synced.delete(cb.dataset.id);
      api('/api/sync', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({object_id: cb.dataset.id, synced: cb.checked})});
      const el = [...document.querySelectorAll('#result .kv div')].find(d=>d.textContent.startsWith('待确认对象'));
      if(el) el.innerHTML = '<b>'+a.affected.length+'</b> 个（已勾 '+S.synced.size+'）';
    });
  });
}

// ---------- 导出 ----------
let hasAnalysis = false;
function doExport(fmt){
  if(!hasAnalysis){ err('先算一次影响面。'); return; }
  const url = '/api/export?format='+fmt+'&synced='+encodeURIComponent([...S.synced].join(','));
  window.open(url);
}
document.getElementById('btnExportTxt').onclick = () => doExport('txt');
document.getElementById('btnExportMd').onclick = () => doExport('md');

// 启动时恢复状态（刷新页面不丢）
(async () => {
  const st = await api('/api/state');
  if(st.loaded){ renderOverview(st); }
})();
</script>
</body>
</html>
"""
