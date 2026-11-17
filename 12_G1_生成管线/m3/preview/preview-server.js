'use strict';
/* G1 M3 · 最小预览页服务器（曦 M3 第三步）
   架构完全复用 M0 安全通道：生成数据 = 纯 JSON（application/json）→ 宿主 fetch →
   受控 postMessage → 游戏帧契约校验 → 可信 Runtime 渲染。
   启动时对全部构造样本执行接入桥预检（纯数据 + Schema 闸门）——不通过拒绝服务。
   仅绑定 127.0.0.1。
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { prepareGame } = require('../runtime-bridge');
const { loadSpikeGame, loadRuntime } = require('../../validator/solver');
const { generateViaWorkbench, listBriefs, listBudget } = require('../../pipeline/workbench/generate');
const { buildIndexPage } = require('../workbench/index-page');

const PORT = 8792;
const HOST = '127.0.0.1';
const SPIKE = path.join(__dirname, '..', '..', '..', '11_Spike_网格解谜');
const GAME_IDS = ['gameA_推箱', 'gameB_钥匙门', 'gameC_碎裂地板', 'gameD_开关闸门'];

// 启动预检：接入桥闸门串联（纯数据 + Schema）——不通过拒绝服务
const runtime = loadRuntime(path.join(SPIKE, 'engine', 'dsl_runtime.js'));
const games = {};
for (const id of GAME_IDS) {
  const g = loadSpikeGame(path.join(SPIKE, id));
  const p = prepareGame(runtime, g.mechanic, g.levels);
  if (!p.ok) {
    console.error('构造样本未通过接入桥，拒绝服务: ' + id + ' ' + JSON.stringify((p.errors || []).slice(0, 3)));
    process.exit(1);
  }
  games[id] = { mechanic: g.mechanic, levels: g.levels, sourceLabel: '构造样本' };
}
console.log('接入桥预检通过：' + GAME_IDS.join('、'));

// 产品目录扫描（幂等）：端到端演示产物 + 工作台生成产物——已过 M0+M2 全闸门才落盘，
// 注册前再过一次接入桥（纯数据 + Schema）。启动时与每次相关请求前调用（新产物即时可玩）。
const PRODUCT_DIRS = [
  { dir: path.join(__dirname, '..', '..', 'pipeline', 'e2e-products'), prefix: 'e2e-', sourceLabel: '端到端演示' },
  { dir: path.join(__dirname, '..', '..', 'pipeline', 'workbench', 'products'), prefix: '', sourceLabel: '工作台生成' }
];
function scanProducts() {
  for (const spec of PRODUCT_DIRS) {
    if (!fs.existsSync(spec.dir)) continue;
    for (const d of fs.readdirSync(spec.dir)) {
      const key = spec.prefix + d;
      if (games[key]) continue;                          // 幂等：已注册跳过
      const pf = path.join(spec.dir, d, 'product.json');
      if (!fs.existsSync(pf)) continue;
      try {
        const prod = JSON.parse(fs.readFileSync(pf, 'utf8'));
        const p = prepareGame(runtime, prod.mechanic, prod.levels);
        if (p.ok) {
          games[key] = { mechanic: prod.mechanic, levels: prod.levels, sourceLabel: spec.sourceLabel };
          console.log('产品已注册: ' + key + '（' + prod.mechanic.title + '）');
        } else {
          console.error('产品未过接入桥，跳过: ' + key);
        }
      } catch (e) {
        console.error('产品读取失败: ' + d + ' ' + e.message.slice(0, 80));
      }
    }
  }
}
scanProducts();

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body),
                        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(body);
}

const ENGINE_FILES = {
  'dsl_runtime.js': path.join(SPIKE, 'engine', 'dsl_runtime.js'),
  'strict-json.js': path.join(__dirname, '..', '..', 'security', 'strict-json.js'),
  'postmessage-guard.js': path.join(__dirname, '..', '..', 'security', 'postmessage-guard.js'),
  'data-guard.js': path.join(__dirname, '..', '..', 'security', 'data-guard.js'),
  'json-fetch.js': path.join(__dirname, '..', '..', 'security', 'json-fetch.js'),
  'preview-game.js': path.join(__dirname, 'preview-game.js'),
  'preview-host.js': path.join(__dirname, 'preview-host.js')
};

function previewHostPage(gameId) {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <link rel="icon" href="data:,">',
    '  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'unsafe-inline\'; connect-src \'self\'; frame-src \'self\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    '  <title>最小预览 · ' + gameId + '</title>',
    '</head>',
    '<body>',
    '  <h3>最小预览页 · ' + gameId + '</h3>',
    '  <p>方向键 / WASD 操作 · R 重新开始 · <button id="restart-btn">重新开始（重建帧）</button></p>',
    '  <div id="preview-host"></div>',
    '  <p id="host-status">初始化…</p>',
    '  <div id="events"></div>',
    '  <script src="/engine/postmessage-guard.js"></script>',
    '  <script src="/engine/preview-host.js"></script>',
    '</body>',
    '</html>'
  ].join('\n');
}

function previewGamePage() {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <link rel="icon" href="data:,">',
    '  <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'; font-src \'none\'; media-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    '  <title>Game</title>',
    '</head>',
    '<body>',
    '  <canvas id="game-canvas" width="320" height="320"></canvas>',
    '  <p id="status">等待数据...</p>',
    '  <div id="events"></div>',
    '  <script src="/engine/strict-json.js"></script>',
    '  <script src="/engine/dsl_runtime.js"></script>',
    '  <script src="/engine/postmessage-guard.js"></script>',
    '  <script src="/engine/data-guard.js"></script>',
    '  <script src="/engine/preview-game.js"></script>',
    '</body>',
    '</html>'
  ].join('\n');
}

function indexPageScript() {
  return fs.readFileSync(path.join(__dirname, '..', 'workbench', 'index.js'), 'utf8');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 65536) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const seg = url.split('/')[2];
  const id = seg ? decodeURIComponent(seg).replace(/\.json$/, '') : null;
  if (/^\/(preview|play|data)\//.test(url) || url === '/api/games') scanProducts();   // 新产物即时可玩
  const known = id && games[id];

  // ── 工作台（A 方案 MVP）──
  if (url === '/workbench' || url === '/workbench/') {
    return send(res, 200, buildIndexPage(), 'text/html; charset=utf-8');
  }
  if (url === '/workbench/index.js') {
    return send(res, 200, indexPageScript(), 'text/javascript; charset=utf-8');
  }
  if (url === '/api/games') {
    const list = Object.keys(games).map(k => ({
      id: k, title: games[k].mechanic.title || k,
      sourceLabel: games[k].sourceLabel || '构造样本',
      url: '/preview/' + encodeURIComponent(k)
    }));
    return send(res, 200, JSON.stringify({ games: list }), 'application/json; charset=utf-8');
  }
  if (url === '/api/briefs') {
    return send(res, 200, JSON.stringify({ briefs: listBriefs() }), 'application/json; charset=utf-8');
  }
  if (url === '/api/budget') {
    return send(res, 200, JSON.stringify(listBudget()), 'application/json; charset=utf-8');
  }
  if (url === '/api/generate' && req.method === 'POST') {
    return readJsonBody(req).then(body => generateViaWorkbench({ briefText: String(body.brief || '') }))
      .then(r => send(res, 200, JSON.stringify(r), 'application/json; charset=utf-8'))
      .catch(e => send(res, 400, JSON.stringify({ ok: false, reason: 'bad_request：' + e.message }), 'application/json; charset=utf-8'));
  }

  if (/^\/preview\/[^/]+$/.test(url) && known) {
    return send(res, 200, previewHostPage(id), 'text/html; charset=utf-8');
  }
  if (/^\/play\/[^/]+$/.test(url) && known) {
    return send(res, 200, previewGamePage(), 'text/html; charset=utf-8');
  }
  if (/^\/data\/[^/]+\.json$/.test(url)) {
    if (!known || !games[id].mechanic) return send(res, 404, 'unknown game', 'text/plain');
    // 生成数据 = DSL 信封（含 dsl_version 顶层——M0 契约格式），纯 JSON（application/json，永不作为脚本执行）
    return send(res, 200, JSON.stringify({ dsl_version: 'grid-puzzle/0.1', mechanic: games[id].mechanic, levels: games[id].levels }), 'application/json; charset=utf-8');
  }
  const m = url.match(/^\/engine\/([\w.-]+\.js)$/);
  if (m && ENGINE_FILES[m[1]]) {
    return send(res, 200, fs.readFileSync(ENGINE_FILES[m[1]]), 'text/javascript; charset=utf-8');
  }
  send(res, 404, 'not found', 'text/plain');
});

server.listen(PORT, HOST, () => console.log('M3 最小预览页: http://' + HOST + ':' + PORT + '/preview/' + encodeURIComponent(GAME_IDS[0]) +
  ' | 工作台: http://' + HOST + ':' + PORT + '/workbench'));
