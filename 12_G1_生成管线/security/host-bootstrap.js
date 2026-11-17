'use strict';
/* M0 · 宿主固定引导脚本（一方代码，非生成物）
   职责：等游戏帧就绪 → fetch 生成数据（纯 JSON，application/json）→
   经受控 postMessage 递入游戏帧；转发游戏帧回传消息（逐条过守卫，不合规静默丢弃）。
   数据来源：location.pathname 由 /host/<id> 映射到 /data/<id>.json。
*/
(function () {
  'use strict';
  var frame = document.querySelector('iframe');
  var logEl = document.getElementById('game-events');
  window.__DROPPED = 0;
  window.__EVENTS = [];
  var DATA_PATH = location.pathname.replace(/^\/host\//, '/data/') + '.json';

  function addLine(t) {
    var d = document.createElement('div');
    d.textContent = t;   // 惰性展示
    logEl.appendChild(d);
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow) { window.__DROPPED++; return; }   // 只收游戏帧（来源不匹配也计入丢弃）
    var r = window.PMGuard.validateMessage('gameToHost', ev, null);
    if (!r.ok) { window.__DROPPED++; return; }       // 静默丢弃
    window.__EVENTS.push(r.type);
    if (r.type === 'game:log' && r.data.msg === 'game-frame-ready') {
      fetch(DATA_PATH)
        .then(function (res) {
          window.__DATA_MIME = res.headers.get('content-type');
          // 大小限制先于解析：头筛 + 流式计数，超限中止，绝不完整读取/解析超大响应
          return window.JsonFetch.readJsonCapped(res, window.JsonFetch.MAX_BYTES);
        })
        .then(function (data) {
          frame.contentWindow.postMessage({ type: 'pipeline:data', data: data }, '*');
        })
        .catch(function (e) { addLine('DATA FETCH FAILED: ' + e.code + ' ' + e.message); });
    }
    addLine(r.type + ' | ' + JSON.stringify(r.data));
  });
  // 供安全实测：受限拉取入口（大小限制先于解析）
  window.__fetchCapped = function (path) {
    return fetch(path).then(function (res) { return window.JsonFetch.readJsonCapped(res, window.JsonFetch.MAX_BYTES); });
  };
})();
