/* 规则模块 B · 收集钥匙开启出口（v0.2 · 带动画与状态感知外观）
   核心机制：物品收集、状态条件（钥匙库存）、门锁逻辑（按需开门）、目标解锁（集齐才放行出口）。
   墙='#'，门='D'，出口='E'；钥匙在 level.dynamic（{type:'key',x,y}）；
   level.doors=[{x,y,need}] 与 map 中 'D' 位置对应。
   表现层：玩家滑动+眼神、钥匙漂浮发光、门与出口**根据库存状态**变化外观（锁=暗红脉冲/开=绿光）、
          拾取金屑粒子、通关彩纸。机制代码与 v0.1 完全一致。
   与规则模块 A（推箱）无任何共享机制代码。 */
window.KEYDOOR_RULES = {
  name: '收集钥匙开启出口',

  _a: null,
  _resetAnim() { this._a = { pFrom: null, pT0: 0, bump: null, parts: [], lastDir: 'D', flashes: [] }; },

  init(level) {
    this._resetAnim();
    return {
      player: { ...level.player },
      keys: level.dynamic.filter(e => e.type === 'key').map(k => ({ ...k })),
      collected: 0
    };
  },

  total(level) { return level.dynamic.filter(e => e.type === 'key').length; },
  doorAt(level, x, y) { return (level.doors || []).find(d => d.x === x && d.y === y); },

  /* ---- 机制（与 v0.1 一致） ---- */
  tryMove(s, dir, level) {
    const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[dir] || [0, 0];
    const nx = s.player.x + d[0], ny = s.player.y + d[1];
    const at = (x, y) => (level.map[y] || '')[x] || '#';
    const ev = [];
    const A = this._a, now = performance.now();

    if (at(nx, ny) === '#') {
      A.bump = { dir, t0: now };
      return { moved: false, state: s, events: [{ type: 'blocked', msg: '撞墙' }] };
    }
    const door = this.doorAt(level, nx, ny);
    if (door && s.collected < door.need) {
      A.bump = { dir, t0: now };
      return { moved: false, state: s, events: [{ type: 'locked', msg: '门锁着：还差 ' + (door.need - s.collected) + ' 把钥匙' }] };
    }

    const key = s.keys.find(k => k.x === nx && k.y === ny);
    const ns = JSON.parse(JSON.stringify(s));
    ns.player = { x: nx, y: ny };
    if (key) {
      ns.keys = ns.keys.filter(k => !(k.x === nx && k.y === ny));
      ns.collected++;
      A.pFrom = { ...s.player }; A.pT0 = now; A.lastDir = dir;
      this._sparkle((nx + .5) * 48, (ny + .5) * 48); // 拾取金屑
      // 飘字：钥匙 +1
      A.parts.push({ x: (nx + .5) * 48, y: (ny + .2) * 48, vx: 0, vy: -46, g: 0,
                     life: .9, max: .9, color: '#F0B429', text: '钥匙 +1' });
      // 门解锁瞬间：恰好集齐某扇门需要的钥匙数 → 绿光爆闪 + 粒子
      (level.doors || []).forEach(dd => {
        if (dd.need === ns.collected) {
          A.flashes.push({ x: (dd.x + .5) * 48, y: (dd.y + .5) * 48, t0: now });
          for (let i = 0; i < 10; i++) {
            A.parts.push({ x: (dd.x + .5) * 48, y: (dd.y + .5) * 48,
              vx: (Math.random() - .5) * 130, vy: -50 - Math.random() * 90,
              g: 240, life: .55, max: .55, size: 3, color: '#5BD88A', shape: 'circle' });
          }
        }
      });
      ev.push({ type: 'collect', msg: '拾取钥匙（' + ns.collected + '/' + this.total(level) + '）' });
    } else {
      A.pFrom = { ...s.player }; A.pT0 = now; A.lastDir = dir;
    }

    if (at(nx, ny) === 'E' && ns.collected < this.total(level)) {
      A.bump = { dir, t0: now };
      return { moved: false, state: s, events: [{ type: 'locked', msg: '出口未解锁：还差 ' + (this.total(level) - s.collected) + ' 把钥匙' }] };
    }
    return { moved: true, state: ns, events: ev };
  },

  isWin(s, level) {
    const at = (level.map[s.player.y] || '')[s.player.x];
    return at === 'E' && s.collected === this.total(level);
  },

  onWin(s, level) {
    for (let i = 0; i < 26; i++) {
      this._a.parts.push({
        x: (s.player.x + .5) * 48, y: (s.player.y + .5) * 48,
        vx: (Math.random() - .5) * 180, vy: -130 - Math.random() * 170,
        g: 320, life: 1, max: 1, size: 3 + Math.random() * 4,
        color: ['#F0B429', '#2F9E63', '#2E6FD8', '#E2574C', '#B57BD6'][i % 5],
        shape: i % 2 ? 'rect' : 'circle'
      });
    }
  },

  status(s, level) {
    return '钥匙 ' + s.collected + '/' + this.total(level) + ' ｜ 门 ' + (level.doors || []).length + ' 扇（按需开启）';
  },

  /* ---- 表现层 ---- */
  _sparkle(x, y) {
    for (let i = 0; i < 10; i++) {
      this._a.parts.push({
        x, y, vx: (Math.random() - .5) * 140, vy: -40 - Math.random() * 90,
        g: 220, life: .55, max: .55, size: 2 + Math.random() * 3,
        color: '#F0B429', shape: 'circle'
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
      if (p.text) {
        ctx.fillStyle = p.color; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * 1.6);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 1.6, 0, Math.PI * 2); ctx.fill(); }
      }
    });
    ctx.globalAlpha = 1;
  },

  drawStaticChar() {}, // 门与出口移到 drawDynamic，外观随状态变化

  drawDynamic(ctx, s, T, now, dt, level) {
    const a = this._a, ease = k => k * (2 - k);
    const unlockedAll = s.collected === this.total(level);

    // 门解锁爆闪：扩散绿色圆环
    a.flashes = a.flashes.filter(f => now - f.t0 < 350);
    a.flashes.forEach(f => {
      const k = (now - f.t0) / 350;
      ctx.strokeStyle = 'rgba(91,216,138,' + (1 - k) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, 10 + k * 36, 0, Math.PI * 2); ctx.stroke();
    });

    // 门：锁=暗色+红脉冲锁孔；开=亮起+绿光描边（状态感知外观）
    (level.doors || []).forEach(d => {
      const open = s.collected >= d.need;
      const px = d.x * T, py = d.y * T;
      const g = ctx.createLinearGradient(px, py, px + T, py + T);
      if (open) { g.addColorStop(0, '#5E9A6B'); g.addColorStop(1, '#33704A'); }
      else { g.addColorStop(0, '#9A6438'); g.addColorStop(1, '#6B3F1D'); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(px + 3, py + 3, T - 6, T - 6, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 3, py + T / 3); ctx.lineTo(px + T - 3, py + T / 3);
      ctx.moveTo(px + 3, py + T * 2 / 3); ctx.lineTo(px + T - 3, py + T * 2 / 3);
      ctx.stroke();
      if (open) {
        ctx.save(); ctx.shadowColor = '#2F9E63'; ctx.shadowBlur = 10;
        ctx.strokeStyle = '#7BD8A2'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(px + 3, py + 3, T - 6, T - 6, 5); ctx.stroke();
        ctx.restore();
      } else {
        const pulse = .55 + .45 * Math.sin(now / 280);
        ctx.fillStyle = 'rgba(226,87,76,' + pulse + ')';
        ctx.beginPath(); ctx.arc(px + T / 2, py + T / 2, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(px + T / 2 - 2, py + T / 2, 4, 8);
      }
    });

    // 出口：解锁前暗淡，解锁后强烈光晕呼吸
    level.map.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== 'E') return;
      const px = x * T, py = y * T;
      const glow = unlockedAll ? 14 + 8 * Math.sin(now / 240) : 4;
      ctx.save();
      ctx.shadowColor = '#2F9E63'; ctx.shadowBlur = glow;
      ctx.fillStyle = unlockedAll ? 'rgba(47,158,99,.30)' : 'rgba(47,158,99,.12)';
      ctx.beginPath(); ctx.roundRect(px + 4, py + 4, T - 8, T - 8, 8); ctx.fill();
      ctx.strokeStyle = '#2F9E63'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(px + 4, py + 4, T - 8, T - 8, 8); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = unlockedAll ? '#3DBB7C' : '#4E8A6C';
      ctx.font = 'bold ' + Math.floor(T / 2.4) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('出', px + T / 2, py + T / 2);
    }));

    // 钥匙：漂浮 + 光晕
    s.keys.forEach(k => {
      const cx = k.x * T + T / 2, cy = k.y * T + T / 2 + Math.sin(now / 260 + k.x * 2) * 3;
      ctx.save();
      ctx.shadowColor = '#F0B429'; ctx.shadowBlur = 10;
      ctx.strokeStyle = '#E8A61C'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx - 5, cy - 5, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 1, cy - 1); ctx.lineTo(cx + 11, cy + 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 7, cy + 2); ctx.lineTo(cx + 10, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 9, cy + 5); ctx.lineTo(cx + 12, cy + 3); ctx.stroke();
      ctx.restore();
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
