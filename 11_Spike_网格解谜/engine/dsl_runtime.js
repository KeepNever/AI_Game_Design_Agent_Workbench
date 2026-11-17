/* dsl_runtime.js —— 受约束规则 DSL 运行时 v0.1（预置能力原语）
   职责：把「结构化玩法规则描述」（各游戏 mechanic.js 里的 MECHANIC 对象）编译并执行，
   适配 grid_engine 的 rules 契约。

   ★代码审查基线：本文件是通用执行器，**不包含任何具体游戏的机制分支**
   （没有针对任何具体玩法的机制分支或关键词硬编码——示例样式名如 crate/key 属于预置视觉原语）；
   全部玩法语义都在各游戏的 mechanic.js 数据里——这正是"生成而非匹配"的技术保证。

   DSL（grid-puzzle/0.1）能力面（= 引擎能力原语之上的受约束规则词汇）：
     tiles[c]     : { style: target|door|exit|stone, glyph?, solid? }
     entities[t]  : { style: crate|key, pushable?, solid?, pickup?: [effects] }
     vars         : { name: 初值 }
     enter[]      : { when, effects }      —— 玩家进入格子时（focus=进入格）
     turn[]       : { forEachCell?, when, effects } —— 每回合（forEachCell 时逐格求 when）
     deny[]       : { when, message }      —— 移动附加拦截（focus=目标格）
     win          : expr                   —— focus=玩家格
     status       : 模板字符串，{expr} 会被求值替换
     overlays     : { propName: { kind: fracture|pit } }  —— 依据格子属性画的覆盖层
     playerArt    : { eyes: bool }

   effects 词汇（受约束，全部白名单）：
     var.add / var.sub        {name, value}
     prop.set / prop.add / prop.sub {prop, value}      （focus 格）
     pit                      （focus 格标记为洞）
     fx                       {kind: sparkle|dust|confetti|debris|flash}
     log                      {text: 模板}
     shake

   表达式：白名单递归下降求值（无 eval/Function）。
   内建：tile(x,y) px() py() tx() ty() tchar() prop(x,y,k) v(k)
        count_tile(c) count_entity(t) count_on(t,c) count_prop(k,min)
   运算：+ - * / < > <= >= == != && || ! 括号，数字与'字符串'。
*/
(function () {

  /* ================= 安全表达式求值器 ================= */
  const LIMITS = { exprMaxLen: 400, maxParenDepth: 24, maxEffects: 64, maxCellProps: 20000, maxMapCells: 4096 };

  function tokenize(src) {
    if (typeof src !== 'string' || src.length > LIMITS.exprMaxLen)
      throw new Error('DSL 表达式缺失或超长（上限 ' + LIMITS.exprMaxLen + ' 字符）');
    const toks = []; let i = 0; let parens = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9]/.test(ch)) {
        let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
        toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue;
      }
      if (ch === "'") {
        let j = i + 1; while (j < src.length && src[j] !== "'") j++;
        toks.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        toks.push({ t: 'id', v: src.slice(i, j) }); i = j; continue;
      }
      const two = src.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/<>!(),'.includes(ch)) {
        if (ch === '(') { parens++; if (parens > LIMITS.maxParenDepth) throw new Error('DSL 表达式嵌套过深'); }
        if (ch === ')') parens--;
        toks.push({ t: 'op', v: ch }); i++; continue;
      }
      throw new Error('DSL 表达式含非法字符：' + ch);
    }
    return toks;
  }

  function makeParser(toks, ctx) {
    let pos = 0;
    const peek = () => toks[pos];
    const next = () => toks[pos++];
    function primary() {
      const tk = next();
      if (!tk) throw new Error('DSL 表达式意外结束');
      if (tk.t === 'num') return tk.v;
      if (tk.t === 'str') return tk.v;
      if (tk.t === 'op' && tk.v === '(') { const v = or(); expect(')'); return v; }
      if (tk.t === 'op' && tk.v === '-') return -unary();
      if (tk.t === 'op' && tk.v === '!') return !unary();
      if (tk.t === 'id') {
        if (peek() && peek().t === 'op' && peek().v === '(') {
          next(); const args = [];
          if (!(peek() && peek().v === ')')) { args.push(or()); while (peek() && peek().v === ',') { next(); args.push(or()); } }
          expect(')');
          const fn = ctx.builtins[tk.v];
          if (!fn) throw new Error('DSL 未知函数：' + tk.v);
          return fn(...args);
        }
        if (tk.v in ctx.vars) return ctx.vars[tk.v];
        if (tk.v === 'true') return true;
        if (tk.v === 'false') return false;
        throw new Error('DSL 未知标识符：' + tk.v);
      }
      throw new Error('DSL 表达式语法错误：' + JSON.stringify(tk));
    }
    function expect(v) { const tk = next(); if (!tk || tk.v !== v) throw new Error('DSL 表达式缺 ' + v); }
    function mul() { let v = unary(); while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) { const o = next().v; v = o === '*' ? v * unary() : v / unary(); } return v; }
    function add() { let v = mul(); while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) { const o = next().v; v = o === '+' ? v + mul() : v - mul(); } return v; }
    function cmp() { let v = add(); while (peek() && peek().t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek().v)) { const o = next().v; const r = add(); v = { '<': v < r, '>': v > r, '<=': v <= r, '>=': v >= r, '==': v == r, '!=': v != r }[o]; } return v; }
    function and() { let v = cmp(); while (peek() && peek().t === 'op' && peek().v === '&&') { next(); v = cmp() && v; } return v; }
    function or() { let v = and(); while (peek() && peek().t === 'op' && peek().v === '||') { next(); v = and() || v; } return v; }
    function unary() { return primary(); }
    return { or, unary };
  }

  function evalExpr(src, ctx) {
    if (typeof src === 'number' || typeof src === 'boolean') return src;
    const toks = tokenize(src);
    if (!toks.length) return 0;
    const p = makeParser(toks, ctx);
    return p.or();
  }

  function fillTemplate(tpl, ctx) {
    return String(tpl).replace(/\{([^}]+)\}/g, (_, expr) => {
      const v = evalExpr(expr, ctx);
      return typeof v === 'number' ? (Math.round(v * 100) / 100) : String(v);
    });
  }

  /* ================= DSL 运行时适配器 ================= */
  window.DSLRules = function (dsl, levels) {
    if (dsl.dsl !== 'grid-puzzle/0.1') throw new Error('不支持的 DSL 版本：' + dsl.dsl);

    const tileDef = ch => (dsl.tiles && dsl.tiles[ch]) || {};
    const entDef = t => (dsl.entities && dsl.entities[t]) || {};
    const overlays = dsl.overlays || {};

    const A = { parts: [], shake: null, bump: null, pFrom: null, pT0: 0, lastDir: 'D', moveT: {}, logs: [] };
    let li = 0, level = null, won = false;

    function ctxFor(fx, fy, extra) {
      const g = level.map;
      const c = {
        vars: Object.assign({}, state.vars),
        builtins: {
          tile: (x, y) => (g[y] || '')[x] || '#',
          px: () => state.player.x, py: () => state.player.y,
          tx: () => fx, ty: () => fy,
          tchar: () => (g[fy] || '')[fx] || '#',
          prop: (x, y, k) => { const p = state.cellProps[x + ',' + y]; return (p && k in p) ? p[k] : 0; },
          v: k => state.vars[k],
          count_tile: ch => { let n = 0; g.forEach(row => [...row].forEach(c => { if (c === ch) n++; })); return n; },
          count_entity: t => state.entities.filter(e => e.type === t).length,
          count_on: (t, ch) => state.entities.filter(e => e.type === t && (g[e.y] || '')[e.x] === ch).length,
          count_prop: (k, min) => { let n = 0; for (const key in state.cellProps) { const p = state.cellProps[key]; if (p[k] !== undefined && p[k] >= (min || 0)) n++; } return n; }
        }
      };
      return Object.assign(c, extra || {});
    }

    let state = null;
    function snapshot() { return JSON.stringify({ vars: state.vars, cellProps: state.cellProps, entities: state.entities, player: state.player }); }
    function restore(json) { const o = JSON.parse(json); state.vars = o.vars; state.cellProps = o.cellProps; state.entities = o.entities; state.player = o.player; }

    function runEffects(list, fx, fy) {
      if ((list || []).length > LIMITS.maxEffects) throw new Error('单条规则效果数超上限 ' + LIMITS.maxEffects);
      if (Object.keys(state.cellProps).length > LIMITS.maxCellProps) throw new Error('格子属性规模超上限');
      (list || []).forEach(ef => {
        const key = fx + ',' + fy;
        switch (ef.op) {
          case 'var.add': state.vars[ef.name] = (state.vars[ef.name] || 0) + ef.value; break;
          case 'var.sub': state.vars[ef.name] = (state.vars[ef.name] || 0) - ef.value; break;
          case 'prop.set': { const p = state.cellProps[key] = state.cellProps[key] || {}; p[ef.prop] = ef.value; break; }
          case 'prop.add': { const p = state.cellProps[key] = state.cellProps[key] || {}; p[ef.prop] = (p[ef.prop] || 0) + ef.value; break; }
          case 'prop.sub': { const p = state.cellProps[key] = state.cellProps[key] || {}; p[ef.prop] = (p[ef.prop] || 0) - ef.value; break; }
          case 'pit': { const p = state.cellProps[key] = state.cellProps[key] || {}; p.hole = 1; break; }
          case 'fx': spawnFx(ef.kind, fx, fy); break;
          case 'log': A.logs.push(fillTemplate(ef.text, ctxFor(fx, fy))); break;
          case 'shake': A.shake = { t0: performance.now() }; break;
          default: throw new Error('DSL 未知效果：' + ef.op);
        }
      });
    }

    function spawnFx(kind, gx, gy) {
      const cx = gx + .5, cy = gy + .5;
      const confettiColors = ['#E2574C', '#F0B429', '#2F9E63', '#2E6FD8', '#B57BD6'];
      if (kind === 'sparkle') for (let i = 0; i < 10; i++) A.parts.push({ u: 1, x: cx, y: cy, vx: (Math.random() - .5) * 3, vy: -1 - Math.random() * 2, g: 5, life: .55, max: .55, size: 3, color: '#F0B429', shape: 'circle' });
      if (kind === 'dust') for (let i = 0; i < 6; i++) A.parts.push({ u: 1, x: cx, y: cy, vx: (Math.random() - .5) * 2, vy: -.6 - Math.random(), g: 4, life: .45, max: .45, size: 3, color: '#B9A98C', shape: 'circle' });
      if (kind === 'debris') for (let i = 0; i < 10; i++) A.parts.push({ u: 1, x: cx, y: cy, vx: (Math.random() - .5) * 3, vy: -1 - Math.random() * 2, g: 5, life: .55, max: .55, size: 3, color: '#96703C', shape: 'circle' });
      if (kind === 'confetti') for (let i = 0; i < 30; i++) A.parts.push({ u: 1, x: cx, y: cy, vx: (Math.random() - .5) * 4, vy: -2.5 - Math.random() * 3.5, g: 7, life: 1, max: 1, size: 4, color: confettiColors[i % 5], shape: i % 2 ? 'rect' : 'circle' });
      if (kind === 'flash') A.flashes = (A.flashes || []).concat([{ x: cx, y: cy, t0: performance.now() }]);
    }

    function evalWhen(list, fx, fy) {
      for (const r of list || []) {
        if (evalExpr(r.when, ctxFor(fx, fy))) return r;
      }
      return null;
    }

    /* ---- rules 契约实现 ---- */
    return {
      _dsl: dsl,
      name: dsl.title,

      init(lv, index) {
        li = index; level = lv; won = false;
        A.parts = []; A.shake = null; A.bump = null; A.pFrom = null; A.moveT = {}; A.flashes = []; A.logs = [];
        state = {
          vars: Object.assign({}, dsl.vars || {}, level.vars || {}),
          cellProps: JSON.parse(JSON.stringify(level.cell_props || {})),
          entities: (level.dynamic || []).map(e => ({ type: e.type, x: e.x, y: e.y })),
          player: { ...level.player }
        };
        return state;
      },

      tryMove(s, dir, lv) {
        state = s;                    // ★当前状态对齐（否则快照总从初始态取）
        A._logMark = A.logs.length;   // 本次动作产生的事件从这条线之后收集
        const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[dir] || [0, 0];
        const nx = s.player.x + d[0], ny = s.player.y + d[1];
        const at = (x, y) => (lv.map[y] || '')[x] || '#';
        const now = performance.now();
        state = s;

        if (at(nx, ny) === '#') { A.bump = { dir, t0: now }; return { moved: false, state: s, events: [{ msg: '撞墙' }] }; }

        // 实体：可推 vs 实体阻挡（pickup 类实体可走上去，拾取在移动后发生）
        const hit = s.entities.find(e => e.x === nx && e.y === ny);
        if (hit && !entDef(hit.type).pickup) {
          const spec = entDef(hit.type);
          if (!spec.pushable) { A.bump = { dir, t0: now }; return { moved: false, state: s, events: [{ msg: '被挡住了' }] }; }
          const lx = nx + d[0], ly = ny + d[1];
          const blocked = at(lx, ly) === '#' || tileDef(at(lx, ly)).solid || s.entities.some(e => e.x === lx && e.y === ly);
          if (blocked) { A.bump = { dir, t0: now }; return { moved: false, state: s, events: [{ msg: '推不动' }] }; }
          const ns = JSON.parse(snapshot());
          const me = ns.entities.find(e => e.x === nx && e.y === ny);
          me.x = lx; me.y = ly;
          A.moveT[lx + ',' + ly] = { from: { x: nx, y: ny }, t0: now };
          spawnFx('dust', lx + .5, ly + .5);
          // 推完后玩家再走这一步（下方统一处理）
          ns.player = { x: nx, y: ny };
          A.pFrom = { ...s.player }; A.pT0 = now; A.lastDir = dir;
          state = ns;                    // ★turn 规则必须对新状态求值
          commitTurn(ns, nx, ny, now);
          return { moved: true, state: ns, events: currentEvents() };
        }

        // DSL 附加拦截（门锁/洞/出口条件……全部来自数据）
        const deny = evalWhen(dsl.deny, nx, ny);
        if (deny) {
          A.bump = { dir, t0: now };
          return { moved: false, state: s, events: [{ msg: fillTemplate(deny.message, ctxFor(nx, ny)) }] };
        }

        const ns = JSON.parse(snapshot());
        ns.player = { x: nx, y: ny };
        state = ns;                    // ★pickup/enter/turn 的效果都要落在新状态上
        A.pFrom = { ...s.player }; A.pT0 = now; A.lastDir = dir;

        // 拾取：进入格上的 pickup 实体
        const picked = ns.entities.filter(e => e.x === nx && e.y === ny && entDef(e.type).pickup);
        picked.forEach(e => runEffects(entDef(e.type).pickup, nx, ny, e.type));
        ns.entities = ns.entities.filter(e => !(e.x === nx && e.y === ny && entDef(e.type).pickup));

        // enter 规则
        (dsl.enter || []).forEach(r => {
          if (evalExpr(r.when, ctxFor(nx, ny))) runEffects(r.effects, nx, ny);
        });

        commitTurn(ns, nx, ny, now);
        return { moved: true, state: ns, events: currentEvents() };
      },

      isWin(s, lv) {
        state = s;
        try { return !!evalExpr(dsl.win, ctxFor(s.player.x, s.player.y)); } catch (e) { window.__dslErr = 'isWin: ' + e.message; return false; }
      },

      status(s, lv) {
        state = s;
        try { return fillTemplate(dsl.status, ctxFor(s.player.x, s.player.y)); } catch (e) { window.__dslErr = 'status: ' + e.message; return ''; }
      },

      drawStaticChar(ctx, ch, px, py, T) {
        const st = tileDef(ch).style;
        if (st === 'target') {
          ctx.fillStyle = 'rgba(226,87,76,.12)';
          ctx.beginPath(); ctx.roundRect(px + 6, py + 6, T - 12, T - 12, 6); ctx.fill();
          ctx.strokeStyle = '#E2574C'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.roundRect(px + 6, py + 6, T - 12, T - 12, 6); ctx.stroke();
          ctx.setLineDash([]);
        }
        if (st === 'door') {
          const g = ctx.createLinearGradient(px, py, px + T, py + T);
          g.addColorStop(0, '#9A6438'); g.addColorStop(1, '#6B3F1D');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.roundRect(px + 3, py + 3, T - 6, T - 6, 5); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px + 3, py + T / 3); ctx.lineTo(px + T - 3, py + T / 3);
          ctx.moveTo(px + 3, py + T * 2 / 3); ctx.lineTo(px + T - 3, py + T * 2 / 3);
          ctx.stroke();
          ctx.fillStyle = '#F0B429';
          ctx.beginPath(); ctx.arc(px + T / 2, py + T / 2, 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(px + T / 2 - 2, py + T / 2, 4, 8);
        }
        if (st === 'exit') {
          ctx.save(); ctx.shadowColor = '#2F9E63'; ctx.shadowBlur = 12;
          ctx.strokeStyle = '#2F9E63'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.roundRect(px + 4, py + 4, T - 8, T - 8, 8); ctx.stroke();
          ctx.restore();
          ctx.fillStyle = '#2F9E63'; ctx.font = 'bold ' + Math.floor(T / 2.4) + 'px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(tileDef(ch).glyph || '出', px + T / 2, py + T / 2);
        }
        if (st === 'stone') {
          const g = ctx.createLinearGradient(px, py, px + T, py + T);
          g.addColorStop(0, '#9AA3B2'); g.addColorStop(1, '#737D8E');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.roundRect(px + 3, py + 3, T - 6, T - 6, 4); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.roundRect(px + 3, py + 3, T - 6, T - 6, 4); ctx.stroke();
        }
      },

      drawDynamic(ctx, s, T, now, dt, lv) {
        state = s;
        // overlays：依据格子属性（fracture / pit）——样式由 DSL overlays 声明，绘制为通用实现
        for (const key in state.cellProps) {
          const p = state.cellProps[key];
          const [x, y] = key.split(',').map(Number);
          const px = x * T, py = y * T;
          for (const propName in overlays) {
            if (!p[propName]) continue;
            const kind = overlays[propName].kind;
            if (kind === 'fracture') {
              const t = p[propName];
              const depth = t === 0 ? 1 : t === 1 ? .6 : .3;
              ctx.strokeStyle = 'rgba(90,60,30,' + (.35 + depth * .5) + ')'; ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(px + 6, py + 6); ctx.lineTo(px + T / 2, py + T / 2); ctx.lineTo(px + T - 5, py + T - 8);
              ctx.moveTo(px + T - 6, py + 6); ctx.lineTo(px + T / 2, py + T / 2); ctx.lineTo(px + 6, py + T - 6);
              ctx.stroke();
              for (let i = 0; i < Math.max(0, t); i++) {
                ctx.fillStyle = '#E2574C';
                ctx.beginPath(); ctx.arc(px + 8 + i * 9, py + T - 8, 3, 0, Math.PI * 2); ctx.fill();
              }
            }
            if (kind === 'pit') {
              ctx.fillStyle = '#0B1524';
              ctx.beginPath();
              ctx.moveTo(px + 4, py + 8); ctx.lineTo(px + T / 2, py + 3); ctx.lineTo(px + T - 4, py + 9);
              ctx.lineTo(px + T - 3, py + T - 5); ctx.lineTo(px + T / 2, py + T - 2); ctx.lineTo(px + 4, py + T - 6);
              ctx.closePath(); ctx.fill();
            }
          }
        }

        // 实体：样式由 DSL entities[style] 决定（crate / key —— 预置视觉原语）
        const moveT = A.moveT, ease = k => k * (2 - k);
        const drawn = {};
        s.entities.forEach(e => {
          const style = entDef(e.type).style;
          let ex = e.x, ey = e.y, moving = false;
          const twKey = e.x + ',' + e.y;
          if (moveT[twKey]) {
            const k = Math.min(1, (now - moveT[twKey].t0) / 130);
            if (k < 1) { const f = moveT[twKey].from; ex = f.x + (e.x - f.x) * ease(k); ey = f.y + (e.y - f.y) * ease(k); moving = true; }
            else delete moveT[twKey];
          }
          const px = ex * T, py = ey * T;
          if (drawn[twKey]) return; drawn[twKey] = 1;
          if (style === 'crate') {
            ctx.fillStyle = 'rgba(0,0,0,.16)';
            ctx.beginPath(); ctx.roundRect(px + 7, py + 10, T - 10, T - 8, 6); ctx.fill();
            const g = ctx.createLinearGradient(px, py, px + T, py + T);
            g.addColorStop(0, '#EBAC52'); g.addColorStop(1, '#C07A1E');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.roundRect(px + 4, py + 4, T - 8, T - 8, 6); ctx.fill();
            ctx.strokeStyle = moving ? '#F4CE7A' : '#8A5B12'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.roundRect(px + 4, py + 4, T - 8, T - 8, 6); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px + 7, py + 7); ctx.lineTo(px + T - 7, py + T - 7);
            ctx.moveTo(px + T - 7, py + 7); ctx.lineTo(px + 7, py + T - 7);
            ctx.strokeStyle = 'rgba(138,91,18,.55)'; ctx.stroke();
          }
          if (style === 'key') {
            const cx = px + T / 2, cy = py + T / 2 + Math.sin(now / 260 + e.x * 2) * 3;
            ctx.save(); ctx.shadowColor = '#F0B429'; ctx.shadowBlur = 10;
            ctx.strokeStyle = '#E8A61C'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(cx - 5, cy - 5, 6, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - 1, cy - 1); ctx.lineTo(cx + 11, cy + 7); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx + 7, cy + 2); ctx.lineTo(cx + 10, cy); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx + 9, cy + 5); ctx.lineTo(cx + 12, cy + 3); ctx.stroke();
            ctx.restore();
          }
        });

        // 玩家（通用视觉原语）
        let px = s.player.x * T, py = s.player.y * T;
        if (A.pFrom) {
          const k = Math.min(1, (now - A.pT0) / 130);
          if (k < 1) { const e = ease(k); px = (A.pFrom.x + (s.player.x - A.pFrom.x) * e) * T; py = (A.pFrom.y + (s.player.y - A.pFrom.y) * e) * T; }
          else A.pFrom = null;
        }
        if (A.bump) {
          const k = (now - A.bump.t0) / 150;
          if (k < 1) { const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[A.bump.dir] || [0, 0]; const off = Math.sin(k * Math.PI) * 5; px += d[0] * off; py += d[1] * off; }
          else A.bump = null;
        }
        const cx = px + T / 2, cy = py + T / 2;
        ctx.fillStyle = 'rgba(0,0,0,.16)';
        ctx.beginPath(); ctx.ellipse(cx, cy + T / 2 - 7, T / 3.2, T / 9, 0, 0, Math.PI * 2); ctx.fill();
        const pg = ctx.createRadialGradient(cx - T / 6, cy - T / 6, 2, cx, cy, T / 2 - 8);
        pg.addColorStop(0, '#6FA3EE'); pg.addColorStop(1, '#2E5FB8');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(cx, cy, T / 2 - 9, 0, Math.PI * 2); ctx.fill();
        if ((dsl.playerArt || {}).eyes) {
          const fd = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[A.lastDir] || [0, 1];
          [-4, 4].forEach(off => {
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(cx + off + fd[0] * 2, cy - 3 + fd[1] * 2, T / 9, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#1A2F4A';
            ctx.beginPath(); ctx.arc(cx + off + fd[0] * 4, cy - 3 + fd[1] * 4, T / 18, 0, Math.PI * 2); ctx.fill();
          });
        }

        // 粒子（单位坐标 → 像素）
        A.parts = A.parts.filter(p => p.life > 0);
        A.parts.forEach(p => {
          p.life -= dt / 1000;
          p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vy += p.g * dt / 1000;
          ctx.globalAlpha = Math.max(0, p.life / p.max);
          ctx.fillStyle = p.color;
          const X = p.x * T, Y = p.y * T;
          if (p.shape === 'rect') ctx.fillRect(X - p.size / 2, Y - p.size / 2, p.size, p.size * 1.6);
          else { ctx.beginPath(); ctx.arc(X, Y, p.size / 1.6, 0, Math.PI * 2); ctx.fill(); }
        });
        ctx.globalAlpha = 1;

        // flash 圆环
        (A.flashes || []).forEach(f => A.flashes = A.flashes.filter(x => now - x.t0 < 350));
        (A.flashes || []).forEach(f => {
          const k = (now - f.t0) / 350;
          ctx.strokeStyle = 'rgba(91,216,138,' + (1 - k) + ')'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(f.x * T, f.y * T, 10 + k * 34, 0, Math.PI * 2); ctx.stroke();
        });
      },

      onWin(s, lv) { spawnFx('confetti', s.player.x + .5, s.player.y + .5); },
      getShake(now) {
        if (!A.shake) return null;
        const k = (now - A.shake.t0) / 180;
        if (k >= 1) { A.shake = null; return null; }
        const amp = 3 * (1 - k);
        return [(Math.random() - .5) * 2 * amp, (Math.random() - .5) * 2 * amp];
      }
    };

    /* ---- 内部工具：回合提交 / 事件收集 ---- */
    function currentEvents() {
      const e = A.logs.slice(A._logMark || 0).map(m => ({ msg: m }));
      A._logMark = A.logs.length;
      return e;
    }
    function commitTurn(ns, nx, ny, now) {
      (dsl.turn || []).forEach(r => {
        if (r.forEachCell) {
          if (level.map.length * level.map[0].length > LIMITS.maxMapCells) throw new Error('地图规模超上限');
          level.map.forEach((row, y) => [...row].forEach((ch, x) => {
            if (evalExpr(r.when, ctxFor(x, y))) runEffects(r.effects, x, y);
          }));
        } else {
          if (evalExpr(r.when, ctxFor(nx, ny))) runEffects(r.effects, nx, ny);
        }
      });
    }
  };
})();
