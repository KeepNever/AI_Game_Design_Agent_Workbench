'use strict';
/* G1 M3 · 端到端闭环测试（模拟模型段 + 全部真实闸门）
   E 组：端到端编排器（候选 → 安全解析 → Schema → GT-1 → 组装器 → 产品包）
   N-E 组：坏候选在对应闸门被拒（留档）
*/
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runE2E } = require('./e2e-demo');
const { createArchiver } = require('./archive');
const { loadRuntime } = require('../validator/solver');
const { createBudgetGuard } = require('./budget');

const results = [];
const testQueue = [];
async function t(name, fn) { testQueue.push({ name, fn }); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'g1-e2e-')); }

const SPIKE = path.join(__dirname, '..', '..', '11_Spike_网格解谜');
const runtime = loadRuntime(path.join(SPIKE, 'engine', 'dsl_runtime.js'));
const { DSLRules, errProbe } = runtime;

const candidateFile = path.join(__dirname, 'e2e', 'candidate-glm5-demo.json');
const CANDIDATE = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));

function e2eOpts(briefId, overrides) {
  const dir = tmpDir();
  return Object.assign({
    brief: '设计一个按序踩灯机制的网格解谜游戏',
    briefId, model: 'glm-5.3-flash', apiKey: 'mock-key',
    DSLRules, errProbe,
    archiver: createArchiver({ dir: path.join(dir, 'archives'), briefId }),
    outDir: path.join(dir, 'e2e-products')
  }, overrides || {});
}

/* ===== E 端到端闭环 ===== */
t('E1 全闸门闭环：候选（含围栏）→ 安全解析 → Schema → GT-1 → 组装器 → 产品包落盘', async () => {
  const o = e2eOpts('e1');
  const r = await runE2E(Object.assign(o, { candidate: CANDIDATE }));
  assert.strictEqual(r.ok, true, '闭环失败: ' + r.reason);
  assert.strictEqual(r.mockedGeneration, true, '模拟段必须如实标注');
  assert.ok(fs.existsSync(r.productPath), '产品包未落盘');
  const product = JSON.parse(fs.readFileSync(r.productPath, 'utf8'));
  assert.strictEqual(product.dsl_version, 'grid-puzzle/0.1');
  assert.strictEqual(product.mechanic.title, '按序踩灯');
  const sv = r.solvability.filter(e => e.outcome === 'solve_pass');
  assert.strictEqual(sv.length, 1, 'GT-1 可解性闸门未通过记录');
  assert.ok(r.events.some(e => e.kind === 'solvability' && e.outcome === 'solve_pass'));
  // 台账/档案留存
  assert.ok(o.archiver.list().length >= 1, '生成档案未留痕');
  return '产品包落盘（按序踩灯，第 1 关 GT-1 PASS）';
});
t('E2 产品包直接通过 GT-2a 逐步重放（产品级候选→真实通关证据）', async () => {
  const o = e2eOpts('e2');
  const r = await runE2E(Object.assign(o, { candidate: CANDIDATE }));
  assert.strictEqual(r.ok, true);
  // 用产品包数据跑 GT-2a 通关路径重放（求解器供路 → 逐步重放 → win）
  const { runGame } = require('../m3/gt2a');
  const rr = runGame(DSLRules, r.candidate.mechanic, r.candidate.levels,
                     { scenarios: [{ kind: 'path-replay', name: 'E2 重放', level: 0 }] }, { errProbe });
  assert.strictEqual(rr.pathReplays[0].pass, true, '产品级候选重放失败');
  assert.strictEqual(rr.pathReplays[0].won, true);
  return '重放 ' + rr.pathReplays[0].steps + ' 步通关（机制专项断言路径就绪）';
});
t('E3 坏候选：Schema 违规在闸门被拒并留档（重试耗尽后闭环拒绝）', async () => {
  const o = e2eOpts('e3');
  const bad = JSON.parse(JSON.stringify(CANDIDATE));
  const parsed = JSON.parse(bad.content.match(/```json\n([\s\S]*?)\n```/)[1]);
  parsed.mechanic.enter[0].effects.push({ op: 'nuke' });   // 未知 op → Schema 拒绝
  bad.content = '```json\n' + JSON.stringify(parsed) + '\n```';
  const r = await runE2E(Object.assign(o, { candidate: bad, maxAttempts: 1 }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason.startsWith('max_attempts_exhausted'), true);
  assert.ok(r.events.some(e => e.kind === 'schema'), 'Schema 分类事件缺失');
  assert.ok(o.archiver.list().length >= 1, '拒绝也应留档');
  return '坏候选被 schema 闸门拦下（maxAttempts=1 即停）';
});
t('E4 预算闸门在闭环内生效：NO_PRICE 模型直接拒绝（不留真实调用档案）', async () => {
  const o = e2eOpts('e4');
  const guard = createBudgetGuard({ ledgerPath: path.join(tmpDir(), 'ledger.json'), capCNY: 22 });   // pricing.json 无 glm-5.3-flash? 有——用未绑定模型名
  const r = await runE2E(Object.assign(o, { candidate: CANDIDATE, model: 'unknown-model', budgetGuard: guard, maxAttempts: 2 }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason.startsWith('no_price_no_retry'), true);
  const lg = await guard.getLedger();
  assert.ok(lg.entries.some(e => e.type === 'NO_PRICE_REJECTED'), 'NO_PRICE 拒绝未入账');
  return 'NO_PRICE 拒绝入账，未发起调用';
});

/* ===== 汇总 ===== */
(async () => {
  const queue = testQueue.slice();
  for (const { name, fn } of queue) {
    try { const d = await fn(); results.push({ name, ok: true, detail: d }); }
    catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  const done = results.filter(r => r.ok).length, fail = results.length - done;
  console.log('=== G1 M3 端到端闭环测试（模拟模型段 + 全部真实闸门）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '  → ' + r.detail : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + done + ' / 失败 ' + fail + ' / 共 ' + results.length + ' ===');
  process.exit(fail ? 1 : 0);
})();
