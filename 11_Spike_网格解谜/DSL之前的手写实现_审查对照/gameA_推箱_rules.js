/* 规则模块 A · 推箱到目标点（v0.2 · 带动画与粒子反馈）
   核心机制：物体推动、位置约束（推不动/卡死）、目标达成（全部箱子就位）。
   墙='#'，目标点='o'；箱子在 level.dynamic（{x,y}）。
   表现层：玩家/箱子平滑滑动、推箱扬尘、撞墙顶一下、目标点呼吸、通关彩纸。
   机制代码与 v0.1 完全一致（tryMove 的判定逻辑零改动），动画只发生在 drawDynamic。
   与规则模块 B（钥匙与门）无任何共享机制代码。 */
window.SOKOBAN_RULES = {
  name: '推箱到目标点',

  /* ---- 表现层动画状态（不参与序列化/撤销） ---- */
  _a: null,
  _resetAnim() { this._a = { pFrom: null, pT0: 0, boxT: {}, bump: null, parts: [], lastDir: 'D', shake: null, flashes: [], lands: [] }; },

  init(level) {
    this._resetAnim();
    return { player: { ...level.player }, boxes: level.dynamic.map(b => ({ ...b })), pushes: 0 };
  },

  /* ---- 机制（与 v0.1 一致） ---- */
  tryMove(s, dir, level) {
    const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[dir] || [0, 0];
    const nx = s.player.x + d[0], ny = s.player.y + d[1];
    const at = (x, y) => (level.map[y] || '')[x] || '#';
    const now = performance.now();
    const A = this._a;

    if (at(nx, ny) === '#') {
      A.bump = { dir, t0: now }; // 撞墙：顶一下
      return { moved: false, state: s, events: [{ type: 'blocked', msg: '撞墙' }] };
    }
    const bi = s.boxes.findIndex(b => b.x === nx && b.y === ny);
    if (bi >= 0) {
      const bx = nx + d[0], by = ny + d[1];
      if (at(bx, by) === '#' || s.boxes.some(b => b.x === bx && b.y === by)) {
        A.bump = { dir, t0: now };
        return { moved: false, state: s, events: [{ type: 'blocked', msg: '箱子推不动' }] };
      }
      const ns = JSON.parse(JSON.stringify(s));
      ns.player = { x: nx, y: ny }; ns.boxes[bi] = { x: bx, y: by }; ns.pushes++;
      // 表现：玩家与箱子滑动 + 扬尘 + 推击震屏
      A.pFrom = { ...s.player }; A.pT0 = now; A.lastDir = dir;
      A.boxT[bx + ',' + by] = { from: { x: nx, y: ny }, t0: now };
      A.shake = { t0: now };
      this._dust((bx + .5) * 44, (by + .5) * 44);
      // 箱子落上目标点：绿光爆闪 + 粒子迸发
      if (at(bx, by) === 'o') {
        A.flashes.push({ x: (bx + .5) * 44, y: (by + .5) * 44, t0: now });
        for (let i = 0; i < 8; i++) {
          A.parts.push({ x: (bx + .5) * 44, y: (by + .5) * 44,
            vx: (Math.random() - .5) * 120, vy: -60 - Math.random() * 80,
            g: 240, life: .5, max: .5, size: 3, color: '#5BD88A', shape: 'circle' });
        }
      }
      return { moved: true, state: ns, events: [{ type: 'push', msg: '推动了箱子' }] };
    }
    const ns = JSON.parse(JSON.stringify(s));
    ns.player = { x: nx, y: ny };
    A.pFrom = { ...s.player }; A.pT0 = now; A.lastDir = dir;
    return { moved: true, state: ns, events: [] };
  },

  isWin(s, level) {
    for (let y = 0; y < level.map.length; y++) for (let x = 0; x < level.map[y].length; x++)
      if (level.map[y][x] === 'o' && !s.boxes.some(b => b.x === x && b.y === y)) return false;
    return true;
  },

  onWin(s, level) {
    // 彩纸：从玩家与每个箱子位置向上喷
    const spots = [s.player, ...s.boxes];
    spots.forEach(p => {
      for (let i = 0; i < 14; i++) {
        this._a.parts.push({
          x: (p.x + .5) * 44, y: (p.y + .5) * 44,
          vx: (Math.random() - .5) * 160, vy: -120 - Math.random() * 160,
          g: 320, life: 1, max: 1, size: 3 + Math.random() * 4,
          color: ['#E2574C', '#F0B429', '#2F9E63', '#2E6FD8', '#B57BD6'][i % 5],
          shape: i % 2 ? 'rect' : 'circle'
        });
      }
    });
  },

  getShake(now) {
    const a = this._a;
    if (!a.shake) return null;
    const k = (now - a.shake.t0) / 160;
    if (k >= 1) { a.shake = null; return null; }
    const amp = 3 * (1 - k);
    return [(Math.random() - .5) * 2 * amp, (Math.random() - .5) * 2 * amp];
  },

  status(s, level) {
    const total = level.map.join('').split('o').length - 1;
    const done = s.boxes.filter(b => level.map[b.y][b.x] === 'o').length;
    return '箱子就位 ' + done + '/' + total + ' ｜ 推进 ' + s.pushes + ' 次（卡死了就撤销）';
  },

  /* ---- 表现层：粒子工具 ---- */
  _dust(x, y) {
    for (let i = 0; i < 6; i++) {
      this._a.parts.push({
        x, y, vx: (Math.random() - .5) * 90, vy: -30 - Math.random() * 50,
        g: 200, life: .45, max: .45, size: 2 + Math.random() * 3,
        color: '#B9A98C', shape: 'circle'
      });
    }
  },

  _drawParts(ctx, dt) {
    const a = this._a;
    a.parts = a.parts.filter(p => p.life > 0);
    a.parts.forEach(p => {
      p.life -= dt / 1000;
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vy += p.g * dt / 1000;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') { ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * 1.6); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 1.6, 0, Math.PI * 2); ctx.fill(); }
    });
    ctx.globalAlpha = 1;
  },

  /* ---- 表现层：逐帧绘制 ---- */
  drawStaticChar() {}, // 目标点移到 drawDynamic 做呼吸动画

  drawDynamic(ctx, s, T, now, dt, level) {
    const a = this._a, ease = k => k * (2 - k);

    // 目标点：呼吸光圈
    level.map.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== 'o') return;
      const pulse = .10 + .06 * Math.sin(now / 320 + x + y);
      const filled = s.boxes.some(b => b.x === x && b.y === y);
      ctx.fillStyle = filled ? 'rgba(226,87,76,.05)' : 'rgba(226,87,76,' + pulse + ')';
      ctx.beginPath(); ctx.roundRect(x * T + 5, y * T + 5, T - 10, T - 10, 7); ctx.fill();
      ctx.strokeStyle = '#E2574C'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.roundRect(x * T + 6, y * T + 6, T - 12, T - 12, 6); ctx.stroke();
      ctx.setLineDash([]);
    }));

    // 箱子：滑动插值（到达后清除补间）
    const boxPos = {};
    s.boxes.forEach(b => { boxPos[b.x + ',' + b.y] = { x: b.x, y: b.y }; });
    for (const key in a.boxT) {
      const tw = a.boxT[key], k = Math.min(1, (now - tw.t0) / 130);
      if (k >= 1) { a.lands.push({ key, t0: now }); delete a.boxT[key]; continue; }
      const e = ease(k), [fx, fy] = [tw.from.x, tw.from.y], [tx, ty] = key.split(',').map(Number);
      boxPos[key] = { x: fx + (tx - fx) * e, y: fy + (ty - fy) * e, moving: true };
    }
    // 落位弹跳：箱子停稳后的轻微回弹
    a.lands = a.lands.filter(l => now - l.t0 < 200);
    const landScale = {};
    a.lands.forEach(l => {
      const k = (now - l.t0) / 200;
      landScale[l.key] = 1 + Math.sin(k * Math.PI) * 0.10;
    });
    for (const key in boxPos) {
      const p = boxPos[key], scale = landScale[key] || 1;
      const shrink = (1 - scale) * T / 2;
      const px = p.x * T + shrink, py = p.y * T + shrink, size = T - shrink * 2;
      ctx.fillStyle = 'rgba(0,0,0,.16)';
      ctx.beginPath(); ctx.roundRect(px + 7, py + 10, size - 3, size - 1, 6); ctx.fill();
      const g = ctx.createLinearGradient(px, py, px + size, py + size);
      g.addColorStop(0, '#EBAC52'); g.addColorStop(1, '#C07A1E');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(px + 4, py + 4, size - 8, size - 8, 6); ctx.fill();
      ctx.strokeStyle = p.moving ? '#F4CE7A' : '#8A5B12'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(px + 4, py + 4, size - 8, size - 8, 6); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px + 7, py + 7); ctx.lineTo(px + size - 7, py + size - 7);
      ctx.moveTo(px + size - 7, py + 7); ctx.lineTo(px + 7, py + size - 7);
      ctx.strokeStyle = 'rgba(138,91,18,.55)'; ctx.stroke();
    }

    // 到点爆闪：扩散的绿色圆环
    a.flashes = a.flashes.filter(f => now - f.t0 < 350);
    a.flashes.forEach(f => {
      const k = (now - f.t0) / 350;
      ctx.strokeStyle = 'rgba(91,216,138,' + (1 - k) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, 10 + k * 34, 0, Math.PI * 2); ctx.stroke();
    });

    // 玩家：滑动插值 + 撞墙顶一下 + 朝向眼神
    let px = s.player.x * T, py = s.player.y * T;
    if (a.pFrom) {
      const k = Math.min(1, (now - a.pT0) / 130);
      if (k < 1) {
        const e = ease(k);
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
    // 朝向眼神
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
