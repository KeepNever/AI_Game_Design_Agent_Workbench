'use strict';
/* G1 M3 · 最小预览页——游戏帧固定一方引导（非生成物）
   职责：接收 pipeline:data（M0 安全通道）→ 契约校验 → 可信 Runtime 渲染与交互。
   体验四要素：运行（canvas 渲染）/ 操作（方向键+WASD+R 重启）/ 反馈（状态栏+事件日志）/ 胜利反馈。
   硬规则：生成数据只作为 JSON 输入（DataGuard 契约校验后喂给可信 Runtime）；
   键盘 'R' = 帧内重启；window.__PREVIEW_TEST 仅供自动化冒烟读取。
*/
(function () {
  'use strict';
  var T = 32;
  var canvas = document.getElementById('game-canvas');
  var ctx = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var eventsEl = document.getElementById('events');
  var rules = null, level = null, state = null, moves = 0, won = false;

  // 握手：帧就绪即通知宿主（宿主收到后才 fetch 数据并递入——M0 安全通道时序）
  window.parent.postMessage({ type: 'game:log', msg: 'game-frame-ready' }, '*');

  function setStatus(t) { statusEl.textContent = t; }
  function logEvent(t) {
    var d = document.createElement('div');
    d.textContent = t;               // 惰性展示
    eventsEl.appendChild(d);
  }
  function testInfo() {
    return { player: { x: state.player.x, y: state.player.y }, moves: moves, won: won,
             status: statusEl.textContent };
  }

  function render() {
    var now = performance.now();
    ctx.fillStyle = '#0B1524';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (var y = 0; y < level.map.length; y++) {
      for (var x = 0; x < level.map[y].length; x++) {
        rules.drawStaticChar(ctx, level.map[y][x], x * T, y * T, T);
      }
    }
    rules.drawDynamic(ctx, state, T, now, 16, level);
  }

  function refreshHud() {
    setStatus((won ? '🎉 胜利！' : '进行中') + ' · 步数 ' + moves + ' · ' + rules.status(state, level));
  }

  function restart() {
    state = rules.init(level, 0);
    moves = 0; won = false;
    eventsEl.textContent = '';
    render(); refreshHud();
    logEvent('— 已重新开始 —');
  }

  function doMove(dir) {
    if (!rules || won) { if (won) setStatus('已胜利——按 R 重新开始'); return; }
    var r = rules.tryMove(state, dir, level);
    state = r.state;
    if (r.moved) moves++;
    (r.events || []).forEach(function (e) { if (e && e.msg) logEvent(e.msg); });
    render();
    won = rules.isWin(state, level);
    refreshHud();
    if (won) { rules.onWin(state, level); render(); }
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;                       // 只收宿主帧
    var g = window.PMGuard.validateMessage('hostToGame', ev, null);
    if (!g.ok) return;
    if (g.type !== 'pipeline:data') return;
    try {
      window.DataGuard.checkEnvelope(g.data.data);                 // 契约校验（生成数据只是 JSON）
    } catch (e) {
      setStatus('数据被安全层拒绝: ' + (e.code || ''));
      return;
    }
    var d = g.data.data;
    rules = window.DSLRules(d.mechanic, d.levels);                 // 可信 Runtime + 纯 JSON 数据
    level = d.levels[0];
    canvas.width = level.map[0].length * T;
    canvas.height = level.map.length * T;
    restart();
    window.parent.postMessage({ type: 'game:log', msg: 'preview-ready' }, '*');
  });

  window.addEventListener('keydown', function (e) {
    var map = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R' };
    if (map[e.key]) { e.preventDefault(); doMove(map[e.key]); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); restart(); }
  });

  // 冒烟测试钩子（只读）
  Object.defineProperty(window, '__PREVIEW_TEST', {
    get: function () { return state ? testInfo() : null; }
  });
})();
