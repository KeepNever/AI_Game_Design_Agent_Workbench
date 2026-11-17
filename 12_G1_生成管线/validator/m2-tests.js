'use strict';
/* G1 M2 · 单元与回归测试
   V 组：Schema 校验器（v1.2.1 规范，含注入违规用例；约束→实现→测试映射见 schema-validator.js 头注）
   R 组：双路线回归 + 状态快照审计（R3 分支独立 / R4 顺序不变性 / R5 键区分度）
   N 组：新机制自动建模 + UNSAT/UNKNOWN 语义 + 运行时异常不误判（N5/N6）
   VM 组：vm 只装可信一方代码（VM1 沙箱无 Node 能力）
*/
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validate } = require('./schema-validator');
const { loadSpikeGame, loadRuntime, solveLevel } = require('./solver');

const SPIKE = path.join(__dirname, '..', '..', '11_Spike_网格解谜');
const RUNTIME = path.join(SPIKE, 'engine', 'dsl_runtime.js');
const results = [];
const testQueue = [];
async function t(name, fn) { testQueue.push({ name, fn }); }

const GAMES = [
  { dir: 'gameA_推箱', key: 'sokoban', name: 'A 推箱' },
  { dir: 'gameB_钥匙门', key: 'keydoor', name: 'B 钥匙门' },
  { dir: 'gameC_碎裂地板', key: 'crumble', name: 'C 碎裂地板' },
  { dir: 'gameD_开关闸门', key: 'switchgate', name: 'D 开关闸门' }
];

const runtime = loadRuntime(RUNTIME);
const DSLRules = runtime.DSLRules;
const errProbe = runtime.errProbe;
const loaded = {};
for (const g of GAMES) loaded[g.dir] = Object.assign(loadSpikeGame(path.join(SPIKE, g.dir)), g);

/* ===== V Schema 校验器 ===== */
t('V1 A/B/C/D 四机制八关全部通过校验（基线不退化）', () => {
  for (const g of GAMES) {
    const { mechanic, levels, name } = loaded[g.dir];
    const r = validate(mechanic, levels);
    if (!r.ok) throw new Error(name + ' 校验失败: ' + JSON.stringify(r.errors.slice(0, 3)));
    assert.strictEqual(r.errors.length, 0);
  }
  return '4 机制 8 关全过，0 错误';
});
t('V2 D 机制功能字符 a/x 产生提示级警告（不判失败）', () => {
  const { mechanic, levels } = loaded['gameD_开关闸门'];
  const r = validate(mechanic, levels);
  assert.strictEqual(r.ok, true, '提示不得判失败');
  assert.ok(r.warnings.some(w => w.code === 'FUNCTION_CHAR_NO_STYLE'), '缺少功能字符提示');
});
t('V3 保留字符 "." 不得作为 tiles 键（v1.2.1）', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.tiles = m.tiles || {}; m.tiles['.'] = { style: 'door' };
  const r = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r.errors.some(e => e.code === 'RESERVED_KEY'));
});
t('V4 未知效果 op 拒绝（实体 pickup 效果数组）', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameB_钥匙门'].mechanic));
  m.entities.key.pickup.push({ op: 'self-destruct' });
  const r = validate(m, loaded['gameB_钥匙门'].levels);
  assert.ok(r.errors.some(e => e.code === 'UNKNOWN_OP' && e.detail === 'self-destruct'));
});
t('V5 未知内建函数拒绝', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.win = 'evilExec(px())';
  const r = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r.errors.some(e => e.code === 'UNKNOWN_FUNCTION' && e.detail === 'evilExec'));
});
t('V6 未声明变量引用拒绝', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.win = "v('ghost')==1";
  const r = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r.errors.some(e => e.code === 'UNDECLARED_VAR' && e.detail === 'ghost'));
});
t('V7 非矩形地图拒绝', () => {
  const lv = { name: 'X', map: ['###', '##', '###'], player: { x: 0, y: 0 }, dynamic: [] };
  const r = validate(loaded['gameA_推箱'].mechanic, [lv]);
  assert.ok(r.errors.some(e => e.code === 'NOT_RECTANGLE'));
});
t('V8 未声明地图字符拒绝', () => {
  const lv = { name: 'X', map: ['##Z', '###'], player: { x: 0, y: 0 }, dynamic: [] };
  const r = validate(loaded['gameA_推箱'].mechanic, [lv]);
  assert.ok(r.errors.some(e => e.code === 'UNDECLARED_CHAR' && e.detail === '"Z"'));
});
t('V9 玩家落墙 / 越界拒绝', () => {
  const lv1 = { name: 'X', map: ['###', '#.#', '###'], player: { x: 0, y: 0 }, dynamic: [] };
  const lv2 = { name: 'X', map: ['###', '#.#', '###'], player: { x: 9, y: 9 }, dynamic: [] };
  assert.ok(validate(loaded['gameA_推箱'].mechanic, [lv1]).errors.some(e => e.code === 'PLAYER_ON_WALL'));
  assert.ok(validate(loaded['gameA_推箱'].mechanic, [lv2]).errors.some(e => e.code === 'PLAYER_OUT_OF_BOUNDS'));
});
t('V10 未声明实体类型 / 实体落墙 / 类型名违规拒绝', () => {
  const lv = { name: 'X', map: ['###', '#.#', '###'], player: { x: 1, y: 1 },
               dynamic: [{ type: 'ghost', x: 1, y: 1 }, { type: 'box', x: 0, y: 0 }] };
  const r = validate(loaded['gameA_推箱'].mechanic, [lv]);
  assert.ok(r.errors.some(e => e.code === 'UNDECLARED_ENTITY' && e.detail === 'ghost'));
  assert.ok(r.errors.some(e => e.code === 'ENTITY_ON_WALL'));
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.entities.BadType = { style: 'crate' };
  const r2 = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r2.errors.some(e => e.code === 'BAD_TYPE_NAME'));
});
t('V11 原型污染键全域拒绝（JSON.parse 构造的真实攻击向量）', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.vars = JSON.parse('{"__proto__": 1}');   // JSON.parse 会创建名为 __proto__ 的自有属性
  const r = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r.errors.some(e => e.code === 'FORBIDDEN_KEY'));
});
t('V12 表达式括号不配对 / 超长拒绝', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.win = '((px()==1)';
  const r1 = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r1.errors.some(e => e.code === 'PARENS_UNBALANCED'));
  const m2 = JSON.parse(JSON.stringify(m)); m2.win = 'px()==' + '1+'.repeat(200) + '1';
  const r2 = validate(m2, loaded['gameA_推箱'].levels);
  assert.ok(r2.errors.some(e => e.code === 'EXPR_TOO_LONG'));
});
t('V13 deny 携带 effects 拒绝 / fx kind 越界拒绝（实体 pickup）', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameB_钥匙门'].mechanic));
  m.deny.push({ when: "tchar()=='#'", message: 'x', effects: [] });
  m.entities.key.pickup.push({ op: 'fx', kind: 'fireworks' });
  const r = validate(m, loaded['gameB_钥匙门'].levels);
  assert.ok(r.errors.some(e => e.code === 'DENY_HAS_EFFECTS'));
  assert.ok(r.errors.some(e => e.code === 'BAD_FX_KIND'));
});
t('V14 dsl 版本不符 / title 空串 / status 缺失拒绝', () => {
  const base = () => JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  const m1 = base(); m1.dsl = 'grid-puzzle/9.9';
  const m2 = base(); m2.title = '';
  const m3 = base(); delete m3.status;
  assert.ok(validate(m1, loaded['gameA_推箱'].levels).errors.some(e => e.code === 'BAD_DSL_VERSION'));
  assert.ok(validate(m2, loaded['gameA_推箱'].levels).errors.some(e => e.code === 'TITLE_REQUIRED'));
  assert.ok(validate(m3, loaded['gameA_推箱'].levels).errors.some(e => e.code === 'STATUS_REQUIRED'));
});
t('V15 tiles style 越界 / glyph 非字符串 / tile 键多字符拒绝', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.tiles = { W: { style: 'lava' }, E2: { style: 'exit' }, X: { style: 'exit', glyph: 123 } };
  const r = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r.errors.some(e => e.code === 'BAD_STYLE' && e.where.includes('W')));
  assert.ok(r.errors.some(e => e.code === 'KEY_NOT_SINGLE_CHAR'));
  assert.ok(r.errors.some(e => e.code === 'GLYPH_NOT_STRING'));
});
t('V16 实体 style 越界 / pushable 非布尔拒绝', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.entities = { box: { style: 'ball', pushable: 'yes' } };
  const r = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r.errors.some(e => e.code === 'BAD_STYLE'));
  assert.ok(r.errors.some(e => e.code === 'NOT_BOOL'));
});
t('V17 变量值非数值 / overlays kind 越界 / playerArt.eyes 非布尔拒绝', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.vars = { n: 'many' };
  m.overlays = { crack: { kind: 'melt' } };
  m.playerArt = { eyes: 'yes' };
  const r = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r.errors.some(e => e.code === 'VAR_NOT_NUMBER'));
  assert.ok(r.errors.some(e => e.code === 'BAD_KIND' && e.where.includes('overlays')));
  assert.ok(r.errors.some(e => e.code === 'NOT_BOOL' && e.where.includes('playerArt')));
});
t('V18 单规则效果数超 64 拒绝（LIMITS）/ var.add value 非数字拒绝', () => {
  const m = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m.enter = [{ when: 'true', effects: Array.from({ length: 65 }, () => ({ op: 'shake' })) }];
  const r = validate(m, loaded['gameA_推箱'].levels);
  assert.ok(r.errors.some(e => e.code === 'TOO_MANY_EFFECTS'));
  const m2 = JSON.parse(JSON.stringify(loaded['gameA_推箱'].mechanic));
  m2.enter = [{ when: 'true', effects: [{ op: 'var.add', name: 'n', value: '很多' }] }];
  const r2 = validate(m2, loaded['gameA_推箱'].levels);
  assert.ok(r2.errors.some(e => e.code === 'VAR_VALUE_NOT_NUMBER'));
});
t('V19 地图超 4096 格 / cell_props 越界拒绝', () => {
  const big = Array.from({ length: 65 }, () => 'x'.repeat(65));   // 65×65 = 4225 > 4096
  const lv1 = { name: 'X', map: big, player: { x: 0, y: 0 }, dynamic: [] };
  const r1 = validate(loaded['gameA_推箱'].mechanic, [lv1]);
  assert.ok(r1.errors.some(e => e.code === 'MAP_TOO_LARGE'), '未拒绝超限地图');
  const lv2 = { name: 'X', map: ['###', '#.#', '###'], player: { x: 1, y: 1 }, dynamic: [], cell_props: { '9,9': {} } };
  const r2 = validate(loaded['gameA_推箱'].mechanic, [lv2]);
  assert.ok(r2.errors.some(e => e.code === 'PROP_OUT_OF_BOUNDS'));
});

/* ===== R 双路线回归 + 状态快照审计 ===== */
t('R1 Node 自动建模 vs Python 手写模型：四机制八关 8/8 可解回归', async () => {
  const recorded = JSON.parse(fs.readFileSync(path.join(SPIKE, '验证结果.json'), 'utf8'));
  const details = [];
  for (const g of GAMES) {
    const { mechanic, levels, name, key } = loaded[g.dir];
    for (let i = 0; i < levels.length; i++) {
      const r = solveLevel(DSLRules, mechanic, levels[i], { errProbe });
      const ref = recorded[key][i];
      if (r.solvable !== ref.solvable) throw new Error(name + ' 第' + (i + 1) + '关可解性不一致: Node=' + r.solvable + ' Python=' + ref.solvable);
      if (r.steps !== ref.steps) throw new Error(name + ' 第' + (i + 1) + '关最少步数不一致: Node=' + r.steps + ' Python=' + ref.steps);
      assert.strictEqual(r.probeMissing, false, 'R1 必须带错误探针');
      details.push(name + ' #' + (i + 1) + ' ' + r.steps + '步');
    }
  }
  return details.join(' / ');
});
t('R2 回归解路径真实有效：路径喂回运行时重放通关（候选→真实通关证据链路）', async () => {
  const { mechanic, levels } = loaded['gameA_推箱'];
  const r = solveLevel(DSLRules, mechanic, levels[0], { errProbe });
  if (!r.solvable) throw new Error('回归关不可解');
  const rules = DSLRules(mechanic, [levels[0]]);
  let state = rules.init(levels[0], 0);
  for (const dir of r.path) state = rules.tryMove(state, dir, levels[0]).state;
  assert.strictEqual(rules.isWin(state, levels[0]), true, '重放终点未达胜利态');
  return '路径 ' + r.path + ' 重放后 isWin=true';
});
t('R3 分支独立性：tryMove 不改写入参状态（同一状态四向展开互不污染）', () => {
  const { mechanic, levels } = loaded['gameB_钥匙门'];
  const rules = DSLRules(mechanic, [levels[0]]);
  const s0 = rules.init(levels[0], 0);
  const before = JSON.stringify(s0);
  const outs = ['U', 'D', 'L', 'R'].map(d => rules.tryMove(s0, d, levels[0]));
  assert.strictEqual(JSON.stringify(s0), before, '入参状态被 tryMove 改写');
  outs.filter(o => o.moved).forEach(o => assert.notStrictEqual(o.state, s0, '分支返回了入参引用'));
  // 分支独立性：从同一 s0 出发的两条不同序列终态不同（无残留污染）
  let a = s0; ['R', 'R'].forEach(d => a = rules.tryMove(a, d, levels[0]).state);
  let b = s0; ['R'].forEach(d => b = rules.tryMove(b, d, levels[0]).state);
  assert.notStrictEqual(JSON.stringify(a), JSON.stringify(b), '不同序列产生相同终态（残留嫌疑）');
  return '入参零改写 + 分支深拷贝独立';
});
t('R4 搜索顺序不变性：两种 DIRS 顺序同解同步数（最短路与遍历顺序无关）', () => {
  const { mechanic, levels } = loaded['gameC_碎裂地板'];
  const a = solveLevel(DSLRules, mechanic, levels[0], { errProbe, dirsOrder: ['U', 'D', 'L', 'R'] });
  const b = solveLevel(DSLRules, mechanic, levels[0], { errProbe, dirsOrder: ['R', 'L', 'D', 'U'] });
  assert.strictEqual(a.solvable, b.solvable, '可解性随顺序改变');
  assert.strictEqual(a.steps, b.steps, '最少步数随顺序改变');
  return a.steps + ' 步（两种顺序一致）';
});
t('R5 状态区分度：不同历史 → 不同快照键；同状态序列化稳定', () => {
  const { mechanic, levels } = loaded['gameB_钥匙门'];
  const rules = DSLRules(mechanic, [levels[0]]);
  const s0 = rules.init(levels[0], 0);
  const k1 = JSON.stringify(rules.tryMove(s0, 'R', levels[0]).state);
  const k2 = JSON.stringify(rules.tryMove(rules.tryMove(s0, 'R', levels[0]).state, 'D', levels[0]).state);
  assert.notStrictEqual(k1, k2, '不同状态产生相同快照键（键区分度不足）');
  assert.strictEqual(JSON.stringify(rules.tryMove(s0, 'R', levels[0]).state), k1, '同状态序列化不稳定');
  return '键区分度与稳定性通过';
});

/* ===== N 新机制自动建模 ===== */
t('N1 新机制（非 A/B/C/D）自动建模：双踏板计数开门可解', () => {
  const mechanic = {
    dsl: 'grid-puzzle/0.1', title: '双踏板计数',
    win: "tchar()=='E' && v('m')>=2",
    status: 'm={v(\'m\')}',
    vars: { m: 0 },
    enter: [{ when: "tchar()=='a'", effects: [{ op: 'var.add', name: 'm', value: 1 }, { op: 'log', text: '+1' }] }],
    tiles: { E: { style: 'exit', glyph: '出' } }
  };
  const level = { name: 'L', map: ['#####', '#a..#', '#..a#', '#..E#', '#####'],
                  player: { x: 1, y: 1 }, dynamic: [] };
  const r = solveLevel(DSLRules, mechanic, level, { errProbe });
  assert.strictEqual(r.solvable, true, '自动建模求解失败: ' + r.reason);
  assert.ok(r.steps > 0 && r.path.length === r.steps);
  return r.steps + ' 步可解';
});
t('N2 新机制 UNSAT：胜利格完全被墙隔离时完整穷举后判无解', () => {
  // 测试设计说明：踏板可重复触发 → 计数无上界 → 状态空间无限（只配 UNKNOWN，见 N2b）；
  // 确定性 UNSAT 需要"有限状态空间 + 胜利不可达"——本关出口 E 四周皆墙且无计数变量。
  const mechanic = {
    dsl: 'grid-puzzle/0.1', title: '出口不可达',
    win: "tchar()=='E'",
    status: '{tchar()}',
    tiles: { E: { style: 'exit', glyph: '出' } }
  };
  const level = { name: 'L', map: ['#####', '#a..#', '#..a#', '####E', '#####'],
                  player: { x: 1, y: 1 }, dynamic: [] };
  const r = solveLevel(DSLRules, mechanic, level, { errProbe });
  assert.strictEqual(r.solvable, false, '应 UNSAT（E 四周皆墙，玩家永不可达；可达态穷尽）');
  assert.strictEqual(r.errorCount || 0, 0, 'UNSAT 前提是零运行时异常');
  return r.reason.slice(0, 40) + '...';
});
t('N2b 真发现留档：无上界计数器使状态空间无限 → 胜利不可达也只能判 UNKNOWN（正确语义）', () => {
  // 构造：E 被墙围死（胜利不可达）+ 踏板可重复触发（m 无上界）→ (位置, m) 组合无限 →
  // 任何有限预算都无法穷举 → UNSAT 不可下结论，UNKNOWN 才是诚实回答。
  // 这是 L-3.2（状态爆炸）与 V-3.1（自动建模边界）的现实实例。
  const mechanic = {
    dsl: 'grid-puzzle/0.1', title: '围死出口+无上界计数',
    win: "tchar()=='E' && v('m')>=2",
    status: 'm={v(\'m\')}',
    vars: { m: 0 },
    enter: [{ when: "tchar()=='a'", effects: [{ op: 'var.add', name: 'm', value: 1 }] }],
    tiles: { E: { style: 'exit', glyph: '出' } }
  };
  const level = { name: 'L', map: ['#####', '#a..#', '#..a#', '####E', '#####'],
                  player: { x: 1, y: 1 }, dynamic: [] };
  const r = solveLevel(DSLRules, mechanic, level, { errProbe, maxStates: 5000 });
  assert.strictEqual(r.solvable, null, '无上界计数 + 胜利不可达：预算内应返回 UNKNOWN');
  assert.strictEqual(r.unknownKind, 'state_exploded', '应分类为状态空间超限/可能无限');
  assert.ok(r.reason.startsWith('UNKNOWN'), '理由应以 UNKNOWN 开头');
  return r.reason.slice(0, 46) + '...';
});
t('N3 UNKNOWN 语义：预算超限返回 null 且理由以 UNKNOWN 开头（禁止 UNSAT 措辞）', () => {
  const { mechanic, levels } = loaded['gameA_推箱'];
  const r = solveLevel(DSLRules, mechanic, levels[0], { errProbe, maxStates: 5 });
  assert.strictEqual(r.solvable, null, '应 UNKNOWN');
  assert.ok(r.reason.startsWith('UNKNOWN') && !r.reason.startsWith('UNSAT'), '理由措辞违规: ' + r.reason);
  return r.reason;
});
t('N4 校验闸门串联：新机制先过 Schema 校验才允许进入求解', () => {
  const mechanic = {
    dsl: 'grid-puzzle/0.1', title: '带非法效果的坏机制',
    win: "tchar()=='E'",
    status: 'm',
    enter: [{ when: "tchar()=='a'", effects: [{ op: 'nuke' }] }],
    tiles: { E: { style: 'exit' } }
  };
  const level = { name: 'L', map: ['###', '#aE#', '###'], player: { x: 1, y: 1 }, dynamic: [] };
  const v = validate(mechanic, [level]);
  assert.ok(!v.ok, '含 UNKNOWN_OP 的机制不应通过校验闸门');
  return '闸门拦截（' + v.errors[0].code + '）——求解器不接收未过闸门的产物';
});
t('N5 运行时异常不误判 UNSAT：裸标识符 win（Schema 静态盲区）→ UNKNOWN + 不支持样本', () => {
  // win = "m >= 1"：Schema 校验只查函数白名单与 v() 引用，裸标识符 m 是静态盲区（对应 V-2.3）；
  // 运行时求值抛"未知标识符"→ 每个状态 isWin 均失败。旧行为会穷举后误判 UNSAT；
  // 新行为：错误探针捕获 → UNKNOWN + unsupported 样本。
  const mechanic = {
    dsl: 'grid-puzzle/0.1', title: '裸标识符胜利条件',
    win: 'm >= 1',
    status: '{tchar()}',
    tiles: { E: { style: 'exit', glyph: '出' } }
  };
  const level = { name: 'L', map: ['###', '#.E#', '###'], player: { x: 1, y: 1 }, dynamic: [] };
  const r = solveLevel(DSLRules, mechanic, level, { errProbe });
  assert.strictEqual(r.solvable, null, '存在运行时异常时禁止判 UNSAT，应 UNKNOWN');
  assert.strictEqual(r.unknownKind, 'runtime_errors', '应分类为可修复运行时错误');
  assert.ok(r.unsupported && r.unsupported.length > 0, '应携带不支持样本');
  assert.ok(r.unsupported.some(s => s.message.includes('m')), '样本应含出错标识符');
  return '异常样本 ' + r.unsupported.length + ' 类，首类: ' + r.unsupported[0].kind + ' | ' + r.unsupported[0].message.slice(0, 50);
});
t('N6 效果执行异常不误判 UNSAT：log 模板引用未知标识符 → UNKNOWN', () => {
  // enter 效果 log{text:'{ghost}'}：Schema 合法（text 只是字符串），运行时 fillTemplate 抛"未知标识符"
  // → tryMove 抛异常 → 探针计数 → 穷尽后 UNKNOWN 而非 UNSAT。
  // 地图设计：单走廊 '#a.aE#'——a 踏板是必经之路（出发格与中途格），绕不开：所有越过 (2,0)
  // 的转移都会触发异常转移，状态只剩起点与 (2,0)，穷尽后 errorCount>0 → UNKNOWN。
  const mechanic = {
    dsl: 'grid-puzzle/0.1', title: '模板引用未声明标识符',
    win: "tchar()=='E'",
    status: '{tchar()}',
    enter: [{ when: "tchar()=='a'", effects: [{ op: 'log', text: '{ghost}' }] }],
    tiles: { E: { style: 'exit', glyph: '出' } }
  };
  const level = { name: 'L', map: ['#a.aE#'], player: { x: 1, y: 0 }, dynamic: [] };
  const r = solveLevel(DSLRules, mechanic, level, { errProbe });
  assert.strictEqual(r.solvable, null, '存在运行时异常时禁止判 UNSAT，应 UNKNOWN');
  assert.strictEqual(r.unknownKind, 'runtime_errors', '应分类为可修复运行时错误');
  assert.ok(r.unsupported && r.unsupported.some(s => s.kind === 'tryMove'), '应有 tryMove 异常样本');
  return 'errorCount ' + (r.errorCount || 0) + ' 次已捕获，穷尽后判 UNKNOWN（runtime_errors）';
});

/* ===== VM vm 边界 ===== */
t('VM1 vm 边界回归：只加载可信 Runtime，不执行任何模型生成代码或 DSL 表达式', () => {
  // 结论口径（曦 2026-11-13 指令 3）：vm 只加载可信一方 Runtime 代码——模型生成数据
  // 永不进入 vm 求值。下方 require/process/global 不可访问属于【环境回归测试】，
  // 不作为 VM 安全隔离证明（VM 安全隔离由 M0 安全层承担：数据通道 + iframe sandbox + CSP）。
  const vm2 = require('vm');
  const sandbox = { window: {}, performance: require('perf_hooks').performance };
  vm2.createContext(sandbox);
  vm2.runInContext(fs.readFileSync(RUNTIME, 'utf8'), sandbox);
  const caps = vm2.runInContext('({ hasRequire: typeof require, hasProcess: typeof process, hasGlobal: typeof global })', sandbox);
  assert.strictEqual(caps.hasRequire, 'undefined');
  assert.strictEqual(caps.hasProcess, 'undefined');
  assert.strictEqual(caps.hasGlobal, 'undefined');
  assert.strictEqual(typeof sandbox.window.DSLRules, 'function', '引擎仍正常挂载');
  return '环境回归测试通过（非安全隔离证明）；Runtime 未执行任何生成代码';
});

/* ===== 汇总 ===== */
(async () => {
  const queue = testQueue.slice();
  for (const { name, fn } of queue) {
    try { const d = await fn(); results.push({ name, ok: true, detail: d }); }
    catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  const done = results.filter(r => r.ok).length, fail = results.length - done;
  console.log('=== G1 M2 测试（Schema 校验器 + GT-1 自动建模 + 状态审计）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? (r.detail ? '  → ' + r.detail : '') : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + done + ' / 失败 ' + fail + ' / 共 ' + results.length + ' ===');
  process.exit(fail ? 1 : 0);
})();
