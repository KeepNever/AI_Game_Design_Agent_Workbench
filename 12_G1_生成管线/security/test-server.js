'use strict';
/* M0 · 本地测试服务器（仅 127.0.0.1，供安全实测）
   关键职责：数据文件以 application/json 提供（不是 text/javascript）——
   生成数据是 JSON 资源，不是脚本资源。
   路由：
     /host/<id>        宿主页（iframe sandbox 包裹游戏帧）
     /play/<id>        游戏页（CSP 收紧，只挂固定一方脚本）
     /data/<id>.json   生成数据（application/json）
     /engine/<file>    固定一方脚本（守卫 + 引导 + 引擎占位）
*/
const http = require('http');
const path = require('path');
const { buildGamePage, buildHostPage } = require('./assemble');

const PORT = 8791;
const HOST = '127.0.0.1';

// 测试样本：合法结构 + 敌意标题（合法文本惰性展示的实测样本）
const SAMPLE = {
  dsl_version: 'grid-puzzle/0.1',
  mechanic: {
    dsl: 'grid-puzzle/0.1',
    title: '<script>alert(1)</script> 测试游戏 🎮',
    win: "px()==1",
    status: '{v(\'m\')}'
  },
  levels: [{ name: 'L1', map: ['###', '#.#', '###'], player: { x: 1, y: 1 }, dynamic: [] }]
};

// 游戏页固定脚本（M0 阶段：守卫 + 引导；M3 起再挂真实引擎）
// 顺序硬约束：strict-json 必须先于 data-guard（浏览器端依赖 window.SecureJSON）
const GAME_SCRIPTS = ['/engine/strict-json.js', '/engine/data-guard.js', '/engine/postmessage-guard.js', '/engine/game-bootstrap.js'];
const ENGINE_FILES = {
  'strict-json.js': path.join(__dirname, 'strict-json.js'),
  'data-guard.js': path.join(__dirname, 'data-guard.js'),
  'postmessage-guard.js': path.join(__dirname, 'postmessage-guard.js'),
  'json-fetch.js': path.join(__dirname, 'json-fetch.js'),
  'game-bootstrap.js': path.join(__dirname, 'game-bootstrap.js'),
  'host-bootstrap.js': path.join(__dirname, 'host-bootstrap.js')
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  // 超大响应测试路径：故意不分块发 Content-Length（chunked），用于验证流式读取中止
  if (url === '/data/big.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.write('{"a":"');                        // 故意不闭合 → 若被解析应为 INVALID_JSON
    res.write('x'.repeat(300 * 1024));
    res.end('');
    return;
  }
  if (/^\/host\/[\w-]+$/.test(url)) {
    const id = url.split('/')[2];
    return send(res, 200, buildHostPage('/play/' + id, ['/engine/postmessage-guard.js', '/engine/json-fetch.js', '/engine/host-bootstrap.js']), 'text/html; charset=utf-8');
  }
  if (/^\/play\/[\w-]+$/.test(url)) {
    return send(res, 200, buildGamePage(GAME_SCRIPTS, []), 'text/html; charset=utf-8');
  }
  if (/^\/data\/[\w-]+\.json$/.test(url)) {
    return send(res, 200, JSON.stringify(SAMPLE), 'application/json; charset=utf-8');
  }
  const m = url.match(/^\/engine\/([\w.-]+\.js)$/);
  if (m && ENGINE_FILES[m[1]]) {
    return send(res, 200, require('fs').readFileSync(ENGINE_FILES[m[1]]), 'text/javascript; charset=utf-8');
  }
  send(res, 404, 'not found', 'text/plain');
});

server.listen(PORT, HOST, () => console.log('M0 test server: http://' + HOST + ':' + PORT + '/host/g1'));
