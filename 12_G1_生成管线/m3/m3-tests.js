'use strict';
/* G1 M3 · 测试（构造样本；曦 M3 启动指令）
   V 组：Runtime 接入桥——纯数据断言 + Schema 闸门串联（生成数据只作为 JSON 输入）
   G 组：通关路径重放（候选路径 → 逐步重放 → 真实通关证据，四构造样本）
   M 组：机制专项断言（推箱跟随/撞墙、拾钥门禁、碎裂衰减成洞、踏板开闸）
*/
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadSpikeGame, loadRuntime } = require('../validator/solver');
const { prepareGame } = require('./runtime-bridge');
const { runGame } = require('./gt2a');

const SPIKE = path.join(__dirname, '..', '..', '11_Spike_网格解谜');
const RUNTIME = path.join(SPIKE, 'engine', 'dsl_runtime.js');
const ASSERT_DIR = path.join(__dirname, 'assertions');
const results = [];
const testQueue = [];
async function t(name, fn) { testQueue.push({ name, fn }); }

const runtime = loadRuntime(RUNTIME);
const GAMES = ['gameA_推箱', 'gameB_钥匙门', 'gameC_碎裂地板', 'gameD_开关闸门'].map(dir => {
  const g = loadSpikeGame(path.join(SPIKE, dir));
  return Object.assign({ dir, def: JSON.parse(fs.readFileSync(path.join(ASSERT_DIR, dir + '.json'), 'utf8')) }, g);
});

/* ===== V Runtime 接入桥 ===== */
t('V1 四构造样本全部通过接入桥（纯数据 + Schema 双闸门）', () => {
  for (const g of GAMES) {
    const p = prepareGame(runtime, g.mechanic, g.levels);
    if (!p.ok) throw new Error(g.dir + ' 接入被拒: ' + JSON.stringify(p.errors && p.errors.slice(0, 2)));
    assert.strictEqual(typeof p.DSLRules, 'function');
  }
  return '4 样本通过（gate=pure-data+schema）';
});
t('V2 含函数的生成数据被纯数据闸门拒绝（生成物只是 JSON——曦 M3 硬规则）', () => {
  const g = GAMES[0];
  const evil = JSON.parse(JSON.stringify(g));
  evil.levels[0].name = () => 'boom';     // 注入函数
  const p = prepareGame(runtime, evil.mechanic, evil.levels);
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.gate, 'pure-data');
  return 'gate=pure-data 拦截';
});
t('V3 Schema 违规数据被 Schema 闸门拒绝（闸门串联顺序：纯数据 → Schema）', () => {
  const g = GAMES[0];
  const bad = JSON.parse(JSON.stringify(g.mechanic));
  bad.win = 'evilExec(px())';
  const p = prepareGame(runtime, bad, g.levels);
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.gate, 'schema');
  assert.ok(p.errors.some(e => e.code === 'UNKNOWN_FUNCTION'));
  return 'gate=schema 拦截（UNKNOWN_FUNCTION）';
});

/* ===== G 通关路径重放 ===== */
t('G1 四构造样本通关路径重放：逐步重放后终点 win=true', async () => {
  const details = [];
  for (const g of GAMES) {
    const prep = prepareGame(runtime, g.mechanic, g.levels);
    assert.strictEqual(prep.ok, true);
    const rr = runGame(prep.DSLRules, g.mechanic, g.levels, g.def, { errProbe: prep.errProbe });
    for (const p of rr.pathReplays) {
      if (!p.pass) throw new Error(g.dir + ' ' + p.name + ' 失败: ' + JSON.stringify(p.failures));
      assert.strictEqual(p.won, true, p.name + ' 重放终点未胜利');
      details.push(p.name + '（' + p.steps + ' 步）');
    }
  }
  return details.join(' / ');
});
t('G2 通关路径重放的逐步观测完整：每步记录 dir/moved/events', async () => {
  const g = GAMES.find(x => x.dir === 'gameA_推箱');
  const prep = prepareGame(runtime, g.mechanic, g.levels);
  const rr = runGame(prep.DSLRules, g.mechanic, g.levels, g.def, { errProbe: prep.errProbe });
  const p = rr.pathReplays[0];
  assert.strictEqual(p.observations.length, p.steps, '观测数与步数不符');
  p.observations.forEach((o, i) => {
    assert.strictEqual(o.step, i + 1);
    assert.ok('UDLR'.includes(o.dir));
    assert.strictEqual(typeof o.moved, 'boolean');
    assert.ok(Array.isArray(o.events), 'events 缺失');
  });
  return p.steps + ' 步观测齐全';
});

/* ===== M 机制专项断言 ===== */
t('M1 机制专项全场景通过（推箱跟随/撞墙、拾钥门禁、碎裂衰减成洞、踏板开闸）', async () => {
  const details = [];
  for (const g of GAMES) {
    const prep = prepareGame(runtime, g.mechanic, g.levels);
    const rr = runGame(prep.DSLRules, g.mechanic, g.levels, g.def, { errProbe: prep.errProbe });
    for (const m of rr.mechanisms) {
      if (!m.pass) throw new Error(g.dir + ' ' + m.name + ' 失败: ' + JSON.stringify(m.failures));
      details.push(m.name);
    }
  }
  return details.length + ' 项：' + details.join('；');
});
t('M2 机制专项与通关路径在结果中分类呈现（曦要求区分两类路径）', async () => {
  const g = GAMES[0];
  const prep = prepareGame(runtime, g.mechanic, g.levels);
  const rr = runGame(prep.DSLRules, g.mechanic, g.levels, g.def, { errProbe: prep.errProbe });
  assert.ok(Array.isArray(rr.pathReplays) && rr.pathReplays.every(x => x.kind === 'path-replay'));
  assert.ok(Array.isArray(rr.mechanisms) && rr.mechanisms.every(x => x.kind === 'mechanism'));
  return rr.summary.pathReplays + '；' + rr.summary.mechanisms;
});
t('M3 机制专项断言可复核：失败输出含 step/期望/实际（逐步观测确定性）', async () => {
  const g = GAMES[0];
  const def = JSON.parse(JSON.stringify(g.def));
  def.scenarios[1].assertions.push({ afterStep: 1, type: 'var', key: 'keys', value: 1 });  // 故意注入错误断言
  const prep = prepareGame(runtime, g.mechanic, g.levels);
  const rr = runGame(prep.DSLRules, g.mechanic, g.levels, def, { errProbe: prep.errProbe });
  const m = rr.mechanisms[0];
  assert.strictEqual(m.pass, false);
  const f = m.failures.find(x => x.desc.includes('var'));
  assert.ok(f && 'actual' in f && 'expect' in f, '失败输出不含期望/实际');
  return '注入错误断言 → 失败可复核（' + f.desc + ' expect ' + f.expect + ' actual ' + f.actual + '）';
});

/* ===== 汇总 ===== */
(async () => {
  const queue = testQueue.slice();
  for (const { name, fn } of queue) {
    try { const d = await fn(); results.push({ name, ok: true, detail: d }); }
    catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  const done = results.filter(r => r.ok).length, fail = results.length - done;
  console.log('=== G1 M3 测试（Runtime 接入桥 + GT-2a 观测断言）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? (r.detail ? '  → ' + r.detail : '') : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + done + ' / 失败 ' + fail + ' / 共 ' + results.length + ' ===');
  process.exit(fail ? 1 : 0);
})();
