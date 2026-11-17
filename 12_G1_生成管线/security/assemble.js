'use strict';
/* M0 安全层 · 安全装配（v2：生成数据不再作为脚本加载）
   数据通道（曦审阅修正）：生成数据 = 纯 JSON 文件（application/json），
   由宿主 fetch 后经受控 postMessage 递入游戏帧——生成数据全程不作为脚本加载。
   1. 游戏页 CSP：default-src 'none' + script-src 'self' + connect-src 'none'
      ——游戏帧只加载固定一方脚本，禁外联、禁内联、禁 eval
   2. 宿主页 CSP：script-src 'self' + connect-src 'self'（仅允许 fetch 本地 JSON）
   3. 宿主 iframe：sandbox="allow-scripts"（无 allow-same-origin）→ 游戏帧 opaque origin
   4. 文本惰性展示：生成文本一律 textContent / escapeHtml，绝不 innerHTML 原样注入
*/

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 产物序列化：纯 JSON 文本（由服务端以 application/json 提供；fetch + res.json() 解析）
function serializeData(obj) {
  return JSON.stringify(obj);
}

const GAME_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'none'",        // 游戏帧禁一切外联
  "font-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

const HOST_CSP = [
  "default-src 'none'",
  "script-src 'self'",         // 宿主只加载固定一方脚本（无内联）
  "style-src 'unsafe-inline'",
  "img-src 'self'",
  "connect-src 'self'",        // 仅允许 fetch 本地数据文件
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');
// 注：frame-ancestors 为 header-only 指令，meta CSP 中被浏览器忽略——宿主隔离由 iframe sandbox 属性承担

function favicon() { return '  <link rel="icon" href="data:,">'; }

// 游戏页：只挂固定一方脚本（守卫 + 引导），无任何生成数据脚本
function buildGamePage(engineSrcs, bootstrapSrcs) {
  const scripts = engineSrcs.concat(bootstrapSrcs)
    .map(src => '<script src="' + escapeHtml(src) + '"></script>')
    .join('\n  ');
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8">',
    favicon(),
    '  <meta http-equiv="Content-Security-Policy" content="' + GAME_CSP + '">',
    '  <title>Game</title>',
    '</head>',
    '<body>',
    '  <div id="mount"></div>',
    '  <div id="status">等待数据...</div>',
    '  ' + scripts,
    '</body>',
    '</html>'
  ].join('\n');
}

// 宿主页：sandbox iframe（无 allow-same-origin）+ 固定守卫/拉取/引导脚本
function buildHostPage(playPath, scriptSrcs) {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8">',
    favicon(),
    '  <meta http-equiv="Content-Security-Policy" content="' + HOST_CSP + '">',
    '  <title>预览</title>',
    '</head>',
    '<body>',
    '  <iframe sandbox="allow-scripts" src="' + escapeHtml(playPath) + '" style="border:0;width:100%;height:70vh"></iframe>',
    '  <div id="game-events"></div>',
    scriptSrcs.map(src => '  <script src="' + escapeHtml(src) + '"></script>').join('\n'),
    '</body>',
    '</html>'
  ].join('\n');
}

module.exports = { escapeHtml, serializeData, buildGamePage, buildHostPage, GAME_CSP, HOST_CSP };
