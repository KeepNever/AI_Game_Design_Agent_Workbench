/* grid_engine.js —— 网格运行时模板 v0.2（Spike 版 · 玩法无关）
   引擎职责：静态层缓存渲染、rAF 逐帧循环、方向输入、回合调度、撤销/重开/切关、
            autoplay 重放、胜负面板（延迟弹出让庆祝特效可见）、事件日志。
   玩法机制全部在 rules 模块——引擎对"箱子/钥匙/门"一无所知。

   rules 契约：
     init(level, index) -> state                     state 须可 JSON 序列化（撤销用）
     tryMove(state, dir, level) -> {moved, state, events:[{type,msg}]}
     isWin(state, level) -> bool
     status(state, level) -> string
     drawStaticChar(ctx, ch, px, py, T)              静态字符（可选；状态相关外观请放 drawDynamic）
     drawDynamic(ctx, state, T, now, dt, level)      逐帧调用（可选）：now=时间戳 dt=帧间隔ms
     onWin(state, level)                             通关瞬间回调（可选，用于庆祝特效）

   autoplay：URL 带 ?level=N&autoplay=UUDDL... 时按 90ms/步重放（确定性运行验证用）。
*/
(function () {
  const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const KEYS = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
                 w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R' };

  window.GridGame = function (cfg) {
    const T = cfg.tile || 44;
    const mount = typeof cfg.mount === 'string' ? document.querySelector(cfg.mount) : cfg.mount;
    const rules = cfg.rules, levels = cfg.levels;
    const params = new URLSearchParams(location.search);
    let li = Math.min(levels.length - 1, Math.max(0, (parseInt(params.get('level'), 10) || 1) - 1));
    let state = null, undo = [], moves = 0, won = false, timer = null;
    let staticLayer = null, staticFor = -1, lastFrame = performance.now();

    // 深色游戏风 UI
    const style = document.createElement('style');
    style.textContent =
      '.gg-btn{padding:4px 12px;margin-right:5px;border:1px solid #3A5578;background:#1A2F4A;color:#C9D6E8;' +
      'border-radius:6px;cursor:pointer;font-size:13px;transition:background .15s}' +
      '.gg-btn:hover{background:#24405F;border-color:#4E6E96}';
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.style.cssText = 'font-family:PingFang SC,Microsoft YaHei,sans-serif;display:inline-block';
    root.innerHTML =
      '<div style="font-size:19px;font-weight:800;color:#E8EDF5;margin-bottom:8px;letter-spacing:1px">' + cfg.title + '</div>' +
      '<div style="margin-bottom:8px">' +
        '<button class="gg-btn" data-act="undo">撤销(Z)</button><button class="gg-btn" data-act="restart">重开(R)</button>' +
        '<button class="gg-btn" data-act="prev">上一关</button><button class="gg-btn" data-act="next">下一关</button>' +
        '<span id="hud" style="margin-left:10px;color:#9FB0C8;font-size:13px"></span></div>' +
      '<div style="position:relative;display:inline-block">' +
        '<canvas id="cv"></canvas>' +
        '<div id="overlay" style="display:none;position:absolute;inset:0;background:linear-gradient(160deg,rgba(23,54,93,.95),rgba(10,28,52,.96));' +
          'color:#fff;flex-direction:column;align-items:center;justify-content:center;border-radius:10px;' +
          'transform:scale(.9);opacity:0;transition:all .28s cubic-bezier(.34,1.56,.64,1)"></div></div>' +
      '<div id="status" style="margin-top:8px;font-size:13px;color:#C9D6E8"></div>' +
      '<div id="log" style="margin-top:4px;font-size:12px;color:#7E90A8;max-height:96px;overflow:auto;' +
        'white-space:pre-line;border-top:1px solid #26364D;padding-top:5px;min-width:' + (cfg.logWidth || 320) + 'px"></div>';
    mount.appendChild(root);

    const cv = root.querySelector('#cv'), ctx = cv.getContext('2d');
    cv.style.cssText = 'display:block;border-radius:10px;box-shadow:0 10px 32px rgba(0,0,0,.5),0 0 0 1px rgba(120,150,190,.25)';
    const overlay = root.querySelector('#overlay'), hud = root.querySelector('#hud'),
          statusEl = root.querySelector('#status'), logEl = root.querySelector('#log');

    function log(msg) { if (msg) logEl.textContent = msg + '\n' + logEl.textContent; }

    function resize() {
      const lv = levels[li];
      cv.width = lv.map[0].length * T; cv.height = lv.map.length * T;
      staticFor = -1; // 触发静态层重建
    }

    function buildStatic() {
      const lv = levels[li];
      staticLayer = document.createElement('canvas');
      staticLayer.width = cv.width; staticLayer.height = cv.height;
      const c = staticLayer.getContext('2d');
      for (let y = 0; y < lv.map.length; y++) for (let x = 0; x < lv.map[y].length; x++) {
        const ch = lv.map[y][x], px = x * T, py = y * T;
        if (ch === '#') {
          c.fillStyle = '#1C3A5F'; c.fillRect(px, py, T, T);
          c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(px, py, T, 5);
          c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(px, py + T - 6, T, 6);
          continue;
        }
        c.fillStyle = (x + y) % 2 ? '#E9ECF2' : '#F1F3F8';
        c.fillRect(px, py, T, T);
        if (ch !== '.' && rules.drawStaticChar) rules.drawStaticChar(c, ch, px, py, T);
      }
      staticFor = li;
    }

    function frame(now) {
      const dt = Math.min(50, now - lastFrame); lastFrame = now;
      if (staticFor !== li || !staticLayer) buildStatic();
      const sh = rules.getShake ? rules.getShake(now) : null;
      ctx.save();
      if (sh) ctx.translate(sh[0], sh[1]); // 震屏（规则模块可选提供）
      ctx.drawImage(staticLayer, 0, 0);
      if (rules.drawDynamic) rules.drawDynamic(ctx, state, T, now, dt, levels[li]);
      ctx.restore();
      requestAnimationFrame(frame);
    }

    function render() {
      const lv = levels[li];
      hud.textContent = '第 ' + (li + 1) + '/' + levels.length + ' 关 · ' + lv.name + ' · 步数 ' + moves;
      statusEl.textContent = rules.status(state, lv) || '';
    }

    function showWin() {
      overlay.innerHTML = '<div style="font-size:30px;font-weight:800;text-shadow:0 2px 12px rgba(240,180,41,.6)">通关！</div>' +
        '<div style="margin-top:10px;font-size:13px;color:#D8DCE4">「' + levels[li].name + '」 · ' + moves + ' 步</div>' +
        '<div style="margin-top:14px"><button class="gg-btn" data-act="next">下一关</button> <button class="gg-btn" data-act="restart">重玩本关</button></div>';
      overlay.style.display = 'flex';
      requestAnimationFrame(() => { overlay.style.transform = 'scale(1)'; overlay.style.opacity = '1'; });
    }

    function load(i) {
      li = (i + levels.length) % levels.length;
      state = rules.init(levels[li], li);
      undo = []; moves = 0; won = false;
      overlay.style.display = 'none';
      resize(); render(); log('—— 进入「' + levels[li].name + '」——');
    }

    function step(dir) {
      if (won || !DIRS[dir]) return false;
      const r = rules.tryMove(state, dir, levels[li]);
      (r.events || []).forEach(e => log(e.msg || e.type));
      if (!r.moved) { render(); return false; }
      undo.push(JSON.stringify(state));
      state = r.state; moves++;
      render();
      if (rules.isWin(state, levels[li])) {
        won = true;
        if (rules.onWin) rules.onWin(state, levels[li]);
        log('★ 通关（' + moves + ' 步）');
        setTimeout(showWin, 620); // 留时间让庆祝特效播完
        return true;
      }
      return false;
    }

    function undoMove() {
      if (won || !undo.length) return;
      state = JSON.parse(undo.pop()); moves++;
      render();
    }

    root.addEventListener('click', e => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'undo') undoMove();
      else if (act === 'restart') load(li);
      else if (act === 'prev') load(li - 1);
      else if (act === 'next') load(li + 1);
    });

    document.addEventListener('keydown', e => {
      const d = KEYS[e.key];
      if (d) { e.preventDefault(); step(d); }
      else if (e.key === 'z' || e.key === 'Z') undoMove();
      else if (e.key === 'r' || e.key === 'R') load(li);
    });

    load(li);
    requestAnimationFrame(frame);

    const seq = params.get('autoplay');
    if (seq) {
      let i = 0;
      timer = setInterval(() => {
        if (won || i >= seq.length) { clearInterval(timer); return; }
        step(seq[i]); i++;
      }, 90);
    }
  };
})();
