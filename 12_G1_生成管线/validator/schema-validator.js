'use strict';
/* G1 M2 · Schema 校验器（Node 重实现，规范 = 前置2 Schema v1.2.1）
   与旧 Python 静态核对脚本的关系：规范同源、实现重写；Python 脚本仅作回归参考。
   职责：结构 + 白名单 + LIMITS + 交叉引用（完整 Schema 校验闸门，M2 核心交付之一）。
   输出：{ ok, errors:[{where,code,detail}], warnings:[...] }——供拦截-重试循环使用，
   错误信息结构化（可回喂模型做诊断重试）。

   ── Schema v1.2.1 约束 → 本实现 → 测试 映射表（曦指令 3）─────────────────
   │ Schema 约束                     │ 校验器实现              │ 测试  │
   ├─────────────────────────────────┼────────────────────────┼───────┤
   │ §5.1 四核心必填 + dsl 版本常量    │ BAD_DSL_VERSION 等      │ V1/V14│
   │ §5.1 可选字段缺省容错（两档必填） │ 仅类型校验不强制存在     │ V1    │
   │ §5.2 tiles style 枚举/glyph/solid│ BAD_STYLE/GLYPH_NOT_STRING│V15  │
   │ §5.2 tiles 键单字符              │ KEY_NOT_SINGLE_CHAR     │ V15   │
   │ §5.1 tiles 保留字符 # . p        │ RESERVED_KEY            │ V3    │
   │ §5.3 entities style 枚举         │ BAD_STYLE               │ V16   │
   │ §5.3 类型名 [a-z_]               │ BAD_TYPE_NAME           │ V10   │
   │ §5.3 pushable/solid 布尔         │ NOT_BOOL                │ V16   │
   │ §5.3 pickup 效果数组校验          │ checkEffects            │ V4/V13│
   │ §5.1 vars 数值                   │ VAR_NOT_NUMBER          │ V17   │
   │ §5.4 enter/turn/deny 规则形状     │ WHEN/MESSAGE/DENY_HAS_EFFECTS│V13│
   │ §5.4 效果 9 op 白名单             │ UNKNOWN_OP              │ V4    │
   │ §5.4 fx kind 枚举                │ BAD_FX_KIND             │ V13   │
   │ §5.4 var.add/sub value 数字字面量 │ VAR_VALUE_NOT_NUMBER    │ V18*  │
   │ §5.4 单规则效果 ≤64              │ TOO_MANY_EFFECTS        │ V18   │
   │ §5.5 表达式 ≤400 / 括号配对       │ EXPR_TOO_LONG/PARENS    │ V12   │
   │ §5.5 内建函数 12 白名单           │ UNKNOWN_FUNCTION        │ V5    │
   │ §5.5 v() 引用声明域（双层合并）    │ UNDECLARED_VAR          │ V6    │
   │ §5.1 overlays kind 枚举          │ BAD_KIND                │ V17   │
   │ §5.1 playerArt.eyes 布尔          │ NOT_BOOL                │ V17   │
   │ §四 map 矩形 / ≤4096             │ NOT_RECTANGLE/MAP_TOO_LARGE│V7/V19│
   │ §四 地图字符集（tiles∪基础∪规则引用）│ UNDECLARED_CHAR       │ V8    │
   │ §四 player 界内非墙               │ PLAYER_ON_WALL/OUT      │ V9    │
   │ §四 dynamic 类型声明/边界/落墙     │ UNDECLARED_ENTITY 等    │ V10   │
   │ §四 cell_props 键界内             │ PROP_OUT_OF_BOUNDS      │ V19   │
   │ §四 player-p 一致性（提示级）      │ （WARN 通道就绪，实例一致故未触发）│ — │
   │ §5.7 功能字符无样式（提示级）      │ FUNCTION_CHAR_NO_STYLE  │ V2    │
   │ 原型污染键全域（M0 安全层延伸）    │ FORBIDDEN_KEY           │ V11   │
   │ 静态盲区（裸标识符，V-2.3）        │ 交由运行时探针（solver N5/N6）│ N5/N6│
   ── 注：V18* 同时覆盖 var.add value 数字与效果上限；提示级项不出现在 errors。
   ────────────────────────────────────────────────────────────────────────
*/
const RESERVED_TILES_KEYS = new Set(['#', '.', 'p']);                 // v1.2.1：三者均为保留字符
const BASE_CHARS = new Set(['#', '.', 'p']);
const TILE_STYLES = new Set(['target', 'door', 'exit', 'stone']);
const ENTITY_STYLES = new Set(['crate', 'key']);
const FX_KINDS = new Set(['sparkle', 'dust', 'confetti', 'debris', 'flash']);
const OVERLAY_KINDS = new Set(['fracture', 'pit']);
const EFFECT_OPS = new Set(['var.add', 'var.sub', 'prop.set', 'prop.add', 'prop.sub', 'pit', 'fx', 'log', 'shake']);
const BUILTINS = new Set(['tile', 'px', 'py', 'tx', 'ty', 'tchar', 'prop', 'v', 'count_tile', 'count_entity', 'count_on', 'count_prop']);
const DSL_VERSION = 'grid-puzzle/0.1';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const LIMITS = { exprMaxLen: 400, maxEffects: 64, maxMapCells: 4096 };

function validate(mechanic, levels) {
  const errors = [], warnings = [];
  const E = (where, code, detail) => errors.push({ where, code, detail: detail || '' });
  const W = (where, code, detail) => warnings.push({ where, code, detail: detail || '' });
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  // 0. 原型污染键全域拒绝
  (function walk(node, where) {
    if (node === null || typeof node !== 'object') return;
    for (const k of Object.keys(node)) {
      if (FORBIDDEN_KEYS.has(k)) E(where, 'FORBIDDEN_KEY', k);
      else walk(node[k], where + '.' + k);
    }
  })({ mechanic, levels }, '$');

  // 1. 机制顶层
  if (!isObj(mechanic)) { E('mechanic', 'NOT_OBJECT'); return fin(); }
  if (mechanic.dsl !== DSL_VERSION) E('mechanic.dsl', 'BAD_DSL_VERSION', String(mechanic.dsl));
  if (typeof mechanic.title !== 'string' || !mechanic.title.length) E('mechanic.title', 'TITLE_REQUIRED');
  if (typeof mechanic.win !== 'string' || !mechanic.win.length) E('mechanic.win', 'WIN_REQUIRED');
  if (typeof mechanic.status !== 'string' || !mechanic.status.length) E('mechanic.status', 'STATUS_REQUIRED');

  // 2. tiles
  const tileKeys = new Set();
  if (mechanic.tiles !== undefined) {
    if (!isObj(mechanic.tiles)) E('mechanic.tiles', 'NOT_OBJECT');
    else for (const ch of Object.keys(mechanic.tiles)) {
      tileKeys.add(ch);
      if (ch.length !== 1) E('mechanic.tiles.' + ch, 'KEY_NOT_SINGLE_CHAR');
      if (RESERVED_TILES_KEYS.has(ch)) E('mechanic.tiles.' + ch, 'RESERVED_KEY', '保留字符 #/./p 不得作为 tiles 键（v1.2.1）');
      const td = mechanic.tiles[ch];
      if (!isObj(td)) { E('mechanic.tiles.' + ch, 'TILEDEF_NOT_OBJECT'); continue; }
      if (!TILE_STYLES.has(td.style)) E('mechanic.tiles.' + ch, 'BAD_STYLE', String(td.style) + ' ∉ {target,door,exit,stone}');
      if (td.glyph !== undefined && typeof td.glyph !== 'string') E('mechanic.tiles.' + ch + '.glyph', 'GLYPH_NOT_STRING');
      if (td.solid !== undefined && typeof td.solid !== 'boolean') E('mechanic.tiles.' + ch + '.solid', 'SOLID_NOT_BOOL');
    }
  }

  // 3. entities
  const entityTypes = new Set();
  if (mechanic.entities !== undefined) {
    if (!isObj(mechanic.entities)) E('mechanic.entities', 'NOT_OBJECT');
    else for (const type of Object.keys(mechanic.entities)) {
      entityTypes.add(type);
      if (!/^[a-z_]+$/.test(type)) E('mechanic.entities.' + type, 'BAD_TYPE_NAME', '须为 [a-z_]');
      const ed = mechanic.entities[type];
      if (!isObj(ed)) { E('mechanic.entities.' + type, 'ENTITYDEF_NOT_OBJECT'); continue; }
      if (!ENTITY_STYLES.has(ed.style)) E('mechanic.entities.' + type, 'BAD_STYLE', String(ed.style) + ' ∉ {crate,key}');
      if (ed.pushable !== undefined && typeof ed.pushable !== 'boolean') E('mechanic.entities.' + type + '.pushable', 'NOT_BOOL');
      if (ed.solid !== undefined && typeof ed.solid !== 'boolean') E('mechanic.entities.' + type + '.solid', 'NOT_BOOL');
      if (ed.pickup !== undefined) checkEffects(ed.pickup, 'mechanic.entities.' + type + '.pickup');
    }
  }

  // 4. vars
  if (mechanic.vars !== undefined) {
    if (!isObj(mechanic.vars)) E('mechanic.vars', 'NOT_OBJECT');
    else for (const k of Object.keys(mechanic.vars)) {
      if (typeof mechanic.vars[k] !== 'number') E('mechanic.vars.' + k, 'VAR_NOT_NUMBER');
    }
  }

  // 5. 规则数组
  const declaredVars = new Set(Object.keys((mechanic.vars) || {}));
  if (mechanic.enter !== undefined) {
    if (!Array.isArray(mechanic.enter)) E('mechanic.enter', 'NOT_ARRAY');
    else mechanic.enter.forEach((r, i) => {
      if (!isObj(r)) { E('mechanic.enter[' + i + ']', 'RULE_NOT_OBJECT'); return; }
      if (typeof r.when !== 'string') E('mechanic.enter[' + i + '].when', 'WHEN_NOT_EXPR');
      checkEffects(r.effects, 'mechanic.enter[' + i + '].effects');
    });
  }
  if (mechanic.deny !== undefined) {
    if (!Array.isArray(mechanic.deny)) E('mechanic.deny', 'NOT_ARRAY');
    else mechanic.deny.forEach((r, i) => {
      if (!isObj(r)) { E('mechanic.deny[' + i + ']', 'RULE_NOT_OBJECT'); return; }
      if (typeof r.when !== 'string') E('mechanic.deny[' + i + '].when', 'WHEN_NOT_EXPR');
      if (typeof r.message !== 'string') E('mechanic.deny[' + i + '].message', 'MESSAGE_NOT_STRING');
      if ('effects' in r) E('mechanic.deny[' + i + ']', 'DENY_HAS_EFFECTS', 'deny 无 effects（命中即拦截）');
    });
  }
  if (mechanic.turn !== undefined) {
    if (!Array.isArray(mechanic.turn)) E('mechanic.turn', 'NOT_ARRAY');
    else mechanic.turn.forEach((r, i) => {
      if (!isObj(r)) { E('mechanic.turn[' + i + ']', 'RULE_NOT_OBJECT'); return; }
      if (r.forEachCell !== undefined && typeof r.forEachCell !== 'boolean') E('mechanic.turn[' + i + '].forEachCell', 'NOT_BOOL');
      if (typeof r.when !== 'string') E('mechanic.turn[' + i + '].when', 'WHEN_NOT_EXPR');
      checkEffects(r.effects, 'mechanic.turn[' + i + '].effects');
    });
  }

  // 6. overlays
  if (mechanic.overlays !== undefined) {
    if (!isObj(mechanic.overlays)) E('mechanic.overlays', 'NOT_OBJECT');
    else for (const prop of Object.keys(mechanic.overlays)) {
      const od = mechanic.overlays[prop];
      if (!isObj(od) || !OVERLAY_KINDS.has(od.kind)) E('mechanic.overlays.' + prop, 'BAD_KIND', String(od && od.kind) + ' ∉ {fracture,pit}');
    }
  }
  if (mechanic.playerArt !== undefined) {
    if (!isObj(mechanic.playerArt)) E('mechanic.playerArt', 'NOT_OBJECT');
    else if (mechanic.playerArt.eyes !== undefined && typeof mechanic.playerArt.eyes !== 'boolean') E('mechanic.playerArt.eyes', 'NOT_BOOL');
  }

  // 7. 关卡
  if (!Array.isArray(levels) || levels.length === 0) { E('levels', 'LEVELS_EMPTY'); return fin(); }
  const ruleChars = new Set();
  const mtext = JSON.stringify(mechanic);
  for (const m of mtext.matchAll(/tchar\(\)\s*==\s*'(.)'/g)) ruleChars.add(m[1]);

  levels.forEach((lv, i) => {
    const p = 'levels[' + i + ']';
    if (!isObj(lv)) { E(p, 'LEVEL_NOT_OBJECT'); return; }
    if (typeof lv.name !== 'string' || !lv.name.length) E(p + '.name', 'NAME_REQUIRED');
    if (!Array.isArray(lv.map) || lv.map.length === 0) { E(p + '.map', 'MAP_REQUIRED'); return; }
    if (!lv.map.every(r => typeof r === 'string')) { E(p + '.map', 'MAP_ROW_NOT_STRING'); return; }
    const h = lv.map.length, w = lv.map[0].length;
    if (lv.map.some(r => r.length !== w)) E(p + '.map', 'NOT_RECTANGLE');
    if (h * w > LIMITS.maxMapCells) E(p + '.map', 'MAP_TOO_LARGE', h * w + ' > 4096');
    // 字符集 ⊆ tiles 键 ∪ 基础字符 ∪ 规则引用字符
    for (let y = 0; y < h; y++) for (let x = 0; x < lv.map[y].length; x++) {
      const ch = lv.map[y][x];
      if (!(BASE_CHARS.has(ch) || tileKeys.has(ch) || ruleChars.has(ch))) E(p + '.map[' + y + '][' + x + ']', 'UNDECLARED_CHAR', JSON.stringify(ch));
    }
    // player
    if (!isObj(lv.player)) { E(p + '.player', 'PLAYER_REQUIRED'); }
    else {
      const { x, y } = lv.player;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || y >= h || x >= (lv.map[y] || '').length) E(p + '.player', 'PLAYER_OUT_OF_BOUNDS');
      else if (lv.map[y][x] === '#') E(p + '.player', 'PLAYER_ON_WALL');
    }
    // dynamic
    if (lv.dynamic !== undefined) {
      if (!Array.isArray(lv.dynamic)) E(p + '.dynamic', 'NOT_ARRAY');
      else lv.dynamic.forEach((e, j) => {
        if (!isObj(e)) { E(p + '.dynamic[' + j + ']', 'ENTITY_NOT_OBJECT'); return; }
        if (!entityTypes.has(e.type)) E(p + '.dynamic[' + j + '].type', 'UNDECLARED_ENTITY', e.type);
        if (!Number.isInteger(e.x) || !Number.isInteger(e.y) || e.y < 0 || e.y >= h || e.x < 0 || e.x >= (lv.map[e.y] || '').length) E(p + '.dynamic[' + j + ']', 'ENTITY_OUT_OF_BOUNDS');
        else if (lv.map[e.y][e.x] === '#') E(p + '.dynamic[' + j + ']', 'ENTITY_ON_WALL');
      });
    }
    // level.vars 进声明域（表达式 v() 引用合法性）
    if (lv.vars !== undefined) {
      if (!isObj(lv.vars)) E(p + '.vars', 'NOT_OBJECT');
      else for (const k of Object.keys(lv.vars)) {
        declaredVars.add(k);
        if (typeof lv.vars[k] !== 'number') E(p + '.vars.' + k, 'VAR_NOT_NUMBER');
      }
    }
    // cell_props
    if (lv.cell_props !== undefined) {
      if (!isObj(lv.cell_props)) { E(p + '.cell_props', 'NOT_OBJECT'); }
      else for (const key of Object.keys(lv.cell_props)) {
        const [cx, cy] = key.split(',').map(Number);
        if (!Number.isInteger(cx) || !Number.isInteger(cy) || cy < 0 || cy >= h || cx < 0 || cx >= w) E(p + '.cell_props.' + key, 'PROP_OUT_OF_BOUNDS');
      }
    }
  });

  // 8. 表达式静态检查（win + 全部 when）
  checkExpr(mechanic.win, 'mechanic.win', declaredVars, E);
  for (const arr of [mechanic.enter, mechanic.deny, mechanic.turn]) {
    (arr || []).forEach((r, i) => { if (isObj(r) && typeof r.when === 'string') checkExpr(r.when, 'rule[' + i + '].when', declaredVars, E); });
  }

  // 9. 功能字符提示（规则引用但无样式声明——合法，提示级）
  for (const ch of ruleChars) {
    if (!tileKeys.has(ch)) W('mechanic.rules', 'FUNCTION_CHAR_NO_STYLE', '字符 ' + JSON.stringify(ch) + ' 由规则引用但无 tiles 样式声明（合法，视觉走缺省地板；§5.7）');
  }

  return fin();

  function checkEffects(effects, where) {
    if (effects === undefined) return;
    if (!Array.isArray(effects)) { E(where, 'EFFECTS_NOT_ARRAY'); return; }
    if (effects.length > LIMITS.maxEffects) E(where, 'TOO_MANY_EFFECTS', effects.length + ' > 64');
    effects.forEach((ef, j) => {
      const q = where + '[' + j + ']';
      if (!isObj(ef)) { E(q, 'EFFECT_NOT_OBJECT'); return; }
      if (!EFFECT_OPS.has(ef.op)) { E(q, 'UNKNOWN_OP', String(ef.op)); return; }
      if (ef.op === 'fx' && !FX_KINDS.has(ef.kind)) E(q, 'BAD_FX_KIND', String(ef.kind));
      if ((ef.op === 'var.add' || ef.op === 'var.sub') && typeof ef.value !== 'number') E(q, 'VAR_VALUE_NOT_NUMBER');
      if ((ef.op === 'var.add' || ef.op === 'var.sub') && typeof ef.name !== 'string') E(q, 'VAR_NAME_NOT_STRING');
      if ((ef.op === 'prop.set' || ef.op === 'prop.add' || ef.op === 'prop.sub') && typeof ef.prop !== 'string') E(q, 'PROP_NAME_NOT_STRING');
      if (ef.op === 'log' && typeof ef.text !== 'string') E(q, 'LOG_TEXT_NOT_STRING');
    });
  }

  function checkExpr(expr, where, vars, E) {
    if (typeof expr !== 'string') { E(where, 'EXPR_NOT_STRING'); return; }
    if (expr.length > LIMITS.exprMaxLen) E(where, 'EXPR_TOO_LONG', expr.length + ' > 400');
    let depth = 0, ok = true;
    for (const ch of expr) { if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth < 0) { ok = false; break; } } }
    if (!ok || depth !== 0) E(where, 'PARENS_UNBALANCED');
    for (const m of expr.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
      if (!BUILTINS.has(m[1])) E(where, 'UNKNOWN_FUNCTION', m[1]);
    }
    for (const m of expr.matchAll(/v\(\s*'(\w+)'\s*\)/g)) {
      if (!vars.has(m[1])) E(where, 'UNDECLARED_VAR', m[1]);
    }
  }

  function fin() {
    return { ok: errors.length === 0, errors, warnings,
             stats: { errorCount: errors.length, warningCount: warnings.length } };
  }
}

module.exports = { validate, LIMITS, DSL_VERSION };
