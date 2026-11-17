'use strict';
/* M0 · 游戏帧固定引导脚本（一方代码，非生成物）
   职责：等待宿主经受控 postMessage 递入生成数据 → 双重校验（消息守卫 + 数据契约守卫）→
   通过则记录并惰性展示；拒绝则记录原因。不主动发起任何网络请求（CSP connect-src 'none'）。
*/
(function () {
  'use strict';
  var out = document.getElementById('status');
  function show(t) { out.textContent = t; }   // 惰性展示：生成文本只经 textContent
  show('等待数据...');

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;  // 只收宿主帧
    var r = window.PMGuard.validateMessage('hostToGame', ev, null);
    if (!r.ok) return;                        // 静默丢弃（可记录原因）
    if (r.type !== 'pipeline:data') return;
    try {
      window.DataGuard.checkEnvelope(r.data.data);   // 结构复检（安全级）
      window.__DATA_RECEIVED = true;
      show('DATA OK: ' + r.data.data.mechanic.title); // 标题含 <script> 时也只显示为文本
      window.parent.postMessage({ type: 'game:log', msg: 'data-accepted' }, '*');
    } catch (e) {
      window.__DATA_REJECTED = e.code || 'unknown';
      show('DATA REJECTED: ' + (e.code || 'unknown'));
    }
  });

  // 通知宿主：帧就绪（宿主收到后才 fetch 并递数据）
  window.parent.postMessage({ type: 'game:log', msg: 'game-frame-ready' }, '*');
})();
