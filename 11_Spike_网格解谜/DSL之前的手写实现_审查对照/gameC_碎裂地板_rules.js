/* 规则模块 C · 碎裂地板（新机制 Brief：MU-10 试金石）
   Brief：「踩过的格子在两回合后碎裂成洞，洞不可通行，抵达出口获胜。」
   该机制不在任何预置玩法样例中——状态变量（碎裂倒计时）、触发条件（踏入→开裂；
   倒计时归零且无人→碎裂）和规则逻辑全部按 Brief 生成。

   地图字符：墙='#'，可碎裂地板='.'，实心石板='S'（永不开裂），出口='E'。
   机制规则（与 validate_levels.py 的 solve_crumble 逐条一致）：
     1. 踏入可碎裂地板 → 该格开裂，倒计时 = 2；
     2. 每走一步（一回合），所有已开裂格子倒计时 -1；
     3. 倒计时归零且**无人在其上** → 碎裂成洞；有人则暂停（保持 0，离开后下回合碎裂）；
     4. 洞不可进入；实心石板与出口不会开裂；
     5. 走到出口 = 胜利。
   与规则模块 A/B 无任何共享机制代码。 */
window.CRUMBLE_RULES = {
  name: '碎裂地板',

  _a: null,
  _resetAnim() { this._a = { pFrom: null, pT0: 0, bump: null, parts: [], lastDir: 'D', shake: null, crumbleFx: [] }; },

  init(level) {
    this._resetAnim();
    return {
      player: { ...level.player },
      cracked: [],    // [{x, y, t}]  倒计时
      crumbled: []    // [{x, y}]    已成洞
    };
  },

  _isHole(s, x, y) { return s.crumbled.some(c => c.x === x && c.y === y); },

  tryMove(s, dir, level) {
    const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[dir] || [0, 0];
    const nx = s.player.x + d[0], ny = s.player.y + d[1];
    const at = (x, y) => (level.map[y] || '')[x] || '#';
    const now = performance.now();
    const A = this._a;

    if (at(nx, ny) === '#') {
      A.bump = { dir, t0: now };
      return { moved: false, state: s, events: [{ type: 'blocked', msg: '撞墙' }] };
    }
    if (this._isHole(s, nx, ny)) {
      A.bump = { dir, t0: now };
      return { moved: false, state: s, events: [{ type: 'blocked', msg: '这里是塌掉的洞，过不去' }] };
    }

    const ns = JSON.parse(JSON.stringify(s));
    ns.player = { x: nx, y: ny };
    A.pFrom = { ...s.player }; A.pT0 = now; A.lastDir = dir;

    // 回合推进：所有已开裂格子倒计时 -1；归零且无人 → 碎裂
    const keep = [];
    ns.cracked.forEach(c => {
      c.t -= 1;
      const occupied = c.x === ns.player.x && c.y === ns.player.y;
      if (c.t <= 0 && !occupied) {
        ns.crumbled.push({ x: c.x, y: c.y });
        A.crumbleFx.push({ x: c.x, y: c.y, t0: now });
        ev_crumble(c, level);
      } else {
        if (c.t < 0) c.t = 0; // 有人站着，暂停在 0
        keep.push(c);
      }
    });
    function ev_crumble(c, lv) { /* 日志在 events 汇总 */ }
    ns.cracked = keep;
    if (A.crumbleFx.length && A.crumbleFx.some(f => now - f.t0 < 20)) A.shake = { t0: now };

    // 踏入可碎裂地板 → 开裂，倒计时 2（实心石板与出口除外）
    if (at(nx, ny) === '.' && !ns.cracked.some(c => c.x === nx && c.y === ny) && !this._isHole(ns, nx, ny)) {
      ns.cracked.push({ x: nx, y: ny, t: 2 });
    }

    const crumbledNow = ns.crumbled.length - s.crumbled.length;
    const ev = [];
    if (crumbledNow > 0) ev.push({ type: 'crumble', msg: '地板碎裂了！（' + crumbledNow + ' 格）' });
    return { moved: true, state: ns, events: ev };
  },

  isWin(s, level) {
    return (level.map[s.player.y] || '')[s.player.x] === 'E';
  },

  onWin(s, level) {
    for (let i = 0; i < 24; i++) {
      this._a.parts.push({
        x: (s.player.x + .5) * 48, y: (s.player.y + .5) * 48,
        vx: (Math.random() - .5) * 170, vy: -120 - Math.random() * 160,
        g: 320, life: 1, max: 1, size: 3 + Math.random() * 4,
        color: ['#2F9E63', '#F0B429', '#2E6FD8', '#E2574C'][i % 4],
        shape: i % 2 ? 'rect' : 'circle'
      });
    }
  },

  status(s, level) {
    const danger = s.cracked.filter(c => c.t <= 1).length;
    return '开裂中 ' + s.cracked.length + ' 格（' + danger + ' 格即将碎裂）｜ 已碎 ' + s.crumbled.length;
  },

  /* ---- 表现层 ---- */
  _drawParts(ctx, dt) {
    const a = this._a;
    a.parts = a.parts.filter(p => p.life > 0);
    a.parts.forEach(p => {
      p.life -= dt / 1000;
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vy += p.g * dt / 1000;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * 1.6);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 1.6, 0, Math.PI * 2); ctx.fill(); }
    });
    ctx.globalAlpha = 1;
  },

  getShake(now) {
    const a = this._a;
    if (!a.shake) return null;
    const k = (now - a.shake.t0) / 180;
    if (k >= 1) { a.shake = null; return null; }
    const amp = 2.5 * (1 - k);
    return [(Math.random() - .5) * 2 * amp, (Math.random() - .5) * 2 * amp];
  },

  drawStaticChar(ctx, ch, px, py, T) {
    if (ch === 'S') {
      // 实心石板：灰色，明确"这里安全"
      const g = ctx.createLinearGradient(px, py, px + T, py + T);
      g.addColorStop(0, '#9AA3B2'); g.addColorStop(1, '#737D8E');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(px + 3, py + 3, T - 6, T - 6, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(px + 3, py + 3, T - 6, T - 6, 4); ctx.stroke();
    }
    if (ch === 'E') {
      ctx.save();
      ctx.shadowColor = '#2F9E63'; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#2F9E63'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(px + 4, py + 4, T - 8, T - 8, 8); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#2F9E63'; ctx.font = 'bold ' + Math.floor(T / 2.4) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('出', px + T / 2, py + T / 2);
    }
  },

  drawDynamic(ctx, s, T, now, dt, level) {
    const a = this._a;

    // 开裂地板：裂纹 + 倒计时指示点（2=两个点 1=一个点），裂纹随倒计时加深
    s.cracked.forEach(c => {
      const px = c.x * T, py = c.y * T;
      const depth = c.t <= 0 ? 1 : c.t === 1 ? .6 : .3;
      ctx.strokeStyle = 'rgba(90,60,30,' + (.35 + depth * .5) + ')'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 6, py + 6); ctx.lineTo(px + T / 2, py + T / 2); ctx.lineTo(px + T - 5, py + T - 8);
      ctx.moveTo(px + T - 6, py + 6); ctx.lineTo(px + T / 2, py + T / 2); ctx.lineTo(px + 6, py + T - 6);
      ctx.stroke();
      for (let i = 0; i < Math.max(0, c.t); i++) {
        ctx.fillStyle = '#E2574C';
        ctx.beginPath(); ctx.arc(px + 8 + i * 9, py + T - 8, 3, 0, Math.PI * 2); ctx.fill();
      }
    });

    // 碎裂成洞：深色塌坑 + 碎边
    s.crumbled.forEach(c => {
      const px = c.x * T, py = c.y * T;
      ctx.fillStyle = '#0B1524';
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 8); ctx.lineTo(px + T / 2, py + 3); ctx.lineTo(px + T - 4, py + 9);
      ctx.lineTo(px + T - 3, py + T - 5); ctx.lineTo(px + T / 2, py + T - 2); ctx.lineTo(px + 4, py + T - 6);
      ctx.closePath(); ctx.fill();
    });

    // 碎裂特效：尘土环
    a.crumbleFx = a.crumbleFx.filter(f => now - f.t0 < 300);
    a.crumbleFx.forEach(f => {
      const k = (now - f.t0) / 300;
      ctx.strokeStyle = 'rgba(150,110,60,' + (1 - k) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x * T + T / 2, f.y * T + T / 2, 6 + k * T / 2, 0, Math.PI * 2); ctx.stroke();
    });

    // 玩家：滑动 + 顶一下 + 眼神（与 A/B 同款）
    let px = s.player.x * T, py = s.player.y * T;
    if (a.pFrom) {
      const k = Math.min(1, (now - a.pT0) / 130);
      if (k < 1) {
        const e = k * (2 - k);
        px = (a.pFrom.x + (s.player.x - a.pFrom.x) * e) * T;
        py = (a.pFrom.y + (s.player.y - a.pFrom.y) * e) * T;
      } else a.pFrom = null;
    }
    if (a.bump) {
      const k = (now - a.bump.t0) / 150;
      if (k < 1) {
        const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[a.bump.dir] || [0, 0];
        const off = Math.sin(k * Math.PI) * 5;
        px += d[0] * off; py += d[1] * off;
      } else a.bump = null;
    }
    const cx = px + T / 2, cy = py + T / 2;
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.beginPath(); ctx.ellipse(cx, cy + T / 2 - 7, T / 3.2, T / 9, 0, 0, Math.PI * 2); ctx.fill();
    const pg = ctx.createRadialGradient(cx - T / 6, cy - T / 6, 2, cx, cy, T / 2 - 8);
    pg.addColorStop(0, '#6FA3EE'); pg.addColorStop(1, '#2E5FB8');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(cx, cy, T / 2 - 9, 0, Math.PI * 2); ctx.fill();
    const fd = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[a.lastDir] || [0, 1];
    [-4, 4].forEach(off => {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx + off + fd[0] * 2, cy - 3 + fd[1] * 2, T / 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1A2F4A';
      ctx.beginPath(); ctx.arc(cx + off + fd[0] * 4, cy - 3 + fd[1] * 4, T / 18, 0, Math.PI * 2); ctx.fill();
    });

    this._drawParts(ctx, dt);
  }
};
