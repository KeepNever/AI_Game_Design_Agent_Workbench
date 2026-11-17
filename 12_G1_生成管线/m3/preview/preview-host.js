'use strict';
/* G1 M3 · 最小预览页——宿主固定一方引导（非生成物）
   职责：等游戏帧就绪 → fetch 生成数据（M0 安全通道）→ postMessage 递入；
   事件转发显示；重启 = 重建 iframe（全新加载，零跨源调用）。
*/
(function () {
  'use strict';
  var host = document.getElementById('preview-host');
  var eventsEl = document.getElementById('events');
  var statusEl = document.getElementById('host-status');
  var frame = null;

  function addLine(t) {
    var d = document.createElement('div');
    d.textContent = t;
    eventsEl.appendChild(d);
  }

  function buildFrame(gameId) {
    // 重建 iframe = 重新开始（全新加载，无跨源调用）
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = '/play/' + gameId;
    frame.style.cssText = 'border:0;width:100%;height:70vh';
    host.appendChild(frame);
    statusEl.textContent = '游戏帧已重建，等待数据通道…';
  }

  window.addEventListener('message', function (ev) {
    if (frame && ev.source !== frame.contentWindow) return;
    var g = window.PMGuard.validateMessage('gameToHost', ev, null);
    if (!g.ok) return;
    if (g.type === 'game:log' && g.data.msg === 'game-frame-ready') {
      statusEl.textContent = '数据通道建立中…';
      fetch('/data/' + location.pathname.split('/').pop() + '.json')
        .then(function (res) { return res.json(); })   // 数据永不作为脚本执行
        .then(function (data) {
          frame.contentWindow.postMessage({ type: 'pipeline:data', data: data }, '*');
          statusEl.textContent = '数据已递入游戏帧';
        })
        .catch(function (e) { addLine('DATA FETCH FAILED: ' + e.message); });
    }
    addLine(g.type + ' | ' + JSON.stringify(g.data));
  });

  document.getElementById('restart-btn').addEventListener('click', function () {
    buildFrame(location.pathname.split('/').pop());
  });

  buildFrame(location.pathname.split('/').pop());
})();
