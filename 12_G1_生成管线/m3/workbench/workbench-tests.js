'use strict';
/* G1 工作台 · MVP 测试（曦 A 方案验收项）
   覆盖：完整链路 / 示例匹配 / fallback 标注 / 首回合失败注入→重试演示 /
         模拟台账扣减与真实台账零触碰 / 预算闸门不绕过 / 产品可过接入桥。
   性质：编排层单元测试（不触网）；浏览器链路由 workbench-smoke.js 另测。
*/
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { generateViaWorkbench, listBriefs, listBudget, PRODUCTS_DIR } = require('../../pipeline/workbench/generate');
const { prepareGame } = require('../runtime-bridge');
const { loadRuntime } = require('../../validator/solver');

const REAL_LEDGER = path.join(__dirname, '..', '..', '..', 'archives', 'budget-ledger.json');
const runtime = loadRuntime(path.join(__dirname, '..', '..', '..', '11_Spike_网格解谜', 'engine', 'dsl_runtime.js'));

const results = [];
const testQueue = [];
function t(name, fn) { testQueue.push({ name, fn }); }
async function runAll() {
  for (const { name, fn } of testQueue) {
    try { const d = await fn(); results.push({ name, ok: true, detail: d }); }
    catch (e) { results.push({ name, ok: false, err: String(e.message).slice(0, 200) }); }
  }
  const pass = results.filter(r => r.ok).length;
  console.log('=== G1 工作台 MVP 测试（编排层）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '  → ' + r.detail : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + pass + ' / 失败 ' + (results.length - pass) + ' / 共 ' + results.length + ' ===');
  process.exit(results.length - pass ? 1 : 0);
}

t('W0 Brief 清单：7 个调优样本，来源标注齐全，tune-f 含重试演示标记', () => {
  const bs = listBriefs();
  assert.strictEqual(bs.length, 7, '应为 7 个调优样本');
  bs.forEach(b => { assert.ok(b.id && b.text && b.source, 'id/text/source 齐全: ' + b.id); });
  const f = bs.find(b => b.id === 'tune-f');
  assert.strictEqual(f.injectFirstFailure, true, 'tune-f 应标记重试演示');
  return '7 个样本（A–D 原文 + e2e + 2 变体）';
});

t('W1 示例 Brief 全链路：tune-e 过五道闸门 → 产品落盘 → 接入桥放行', async () => {
  const briefs = listBriefs();
  const brief = briefs.find(b => b.id === 'tune-e');
  const r = await generateViaWorkbench({ briefText: brief.text });
  assert.strictEqual(r.ok, true, '应成功: ' + (r.reason || ''));
  assert.strictEqual(r.mocked, true, 'mocked 标注');
  assert.strictEqual(r.mockFallback, false, '不应 fallback');
  assert.strictEqual(r.attempts, 1);
  const pf = path.join(PRODUCTS_DIR, r.productId, 'product.json');
  assert.ok(fs.existsSync(pf), '产品落盘');
  const prod = JSON.parse(fs.readFileSync(pf, 'utf8'));
  const p = prepareGame(runtime, prod.mechanic, prod.levels);
  assert.ok(p.ok, '接入桥放行: ' + JSON.stringify(p.errors || []));
  assert.ok(r.productUrl.startsWith('/preview/wb-'), '预览链接: ' + r.productUrl);
  return r.productId + '（' + r.productTitle + '）';
});

t('W2 自由 Brief fallback：无匹配 → fallback 候选如实标注，仍走完整闸门', async () => {
  const r = await generateViaWorkbench({ briefText: '完全自创的一个 Brief：帮我在月亮上盖一座城堡（无匹配示例）' });
  assert.strictEqual(r.ok, true, 'fallback 应生成成功: ' + (r.reason || ''));
  assert.strictEqual(r.mockFallback, true, 'mockFallback 标注');
  assert.strictEqual(r.matchedBrief, null);
  assert.ok(r.stages.length === 6 && r.stages.every(s => s.ok), '六节点全过');
  return 'fallback 标注 + 闸门全过';
});

t('W3 重试演示（tune-f）：第 1 回合 Schema 闸门拦截 UNKNOWN_FUNCTION，第 2 回合通过', async () => {
  const brief = listBriefs().find(b => b.id === 'tune-f');
  const r = await generateViaWorkbench({ briefText: brief.text });
  assert.strictEqual(r.ok, true, '重试后应成功: ' + (r.reason || ''));
  assert.strictEqual(r.attempts, 2, '应恰好 2 回合');
  const schemaFail = r.events.find(e => e.kind === 'schema' && e.outcome === 'schema_failed');
  assert.ok(schemaFail, '应含 Schema 拦截事件');
  assert.ok(r.stages.find(s => s.node.includes('Schema')).detail.includes('拦截'), '闸门节点应展示拦截原因');
  const archDir = path.join(__dirname, '..', '..', r.archivesDir);
  const recs = fs.readdirSync(archDir).filter(f => f.endsWith('.json'));
  assert.strictEqual(recs.length, 2, '每次尝试都留档（' + recs.length + '）');
  return '2 回合（拦截→回喂→通过），留档 2 份';
});

t('W4 预算隔离与扣减：模拟台账有 RESERVE/SETTLE 核销记录；真实台账零写入', async () => {
  const before = fs.existsSync(REAL_LEDGER) ? fs.readFileSync(REAL_LEDGER, 'utf8') : null;
  const brief = listBriefs().find(b => b.id === 'tune-a');
  const r = await generateViaWorkbench({ briefText: brief.text });
  assert.strictEqual(r.ok, true);
  assert.ok(r.budget.sim.totalSpentCNY > 0, '模拟台账应有核销: ' + r.budget.sim.totalSpentCNY);
  const types = r.budget.sim.entries.map(e => e.type);
  assert.ok(types.includes('RESERVE') && types.includes('SETTLE'), '三段式条目: ' + types.join(','));
  assert.strictEqual(r.budget.sim.capCNY, 22);
  const after = fs.existsSync(REAL_LEDGER) ? fs.readFileSync(REAL_LEDGER, 'utf8') : null;
  assert.strictEqual(before, after, '真实台账被 Mock 通道改动！');
  assert.strictEqual(r.budget.real.exists, before ? undefined : false, '真实台账状态如实上报');
  return '模拟核销 ' + r.budget.sim.totalSpentCNY + ' 元；真实台账字节级未变';
});

t('W5 预算闸门不绕过：capCNY=0.004（不足一笔预估）→ reserve 拒绝，零调用零落盘', async () => {
  const brief = listBriefs().find(b => b.id === 'tune-b');
  const archivesBefore = fs.readdirSync(path.join(__dirname, '..', '..', 'archives', 'workbench-mock')).length;
  const r = await generateViaWorkbench({ briefText: brief.text, capCNY: 0.004 });
  assert.strictEqual(r.ok, false, '应被预算闸门拒绝');
  assert.ok(r.reason.startsWith('budget_exhausted'), 'reason: ' + r.reason);
  assert.ok(r.stages[0].ok === false && r.stages[0].node.includes('预算'), '预算节点标红');
  const archivesAfter = fs.readdirSync(path.join(__dirname, '..', '..', 'archives', 'workbench-mock')).length;
  // 预算拒绝发生在模型调用之前 → 无调用即无调用档案（与无密钥语义一致）；拒绝本身入台账条目
  assert.strictEqual(archivesAfter, archivesBefore, '预算拒绝不应产生调用档案目录');
  assert.strictEqual(fs.existsSync(path.join(PRODUCTS_DIR, r.productId || 'x')), false, '无产品落盘');
  return 'INSUFFICIENT_BUDGET 拒绝，闸门生效';
});

t('W6 预算展示接口：listBudget 双台账结构 + 真实台账隔离标注', () => {
  const b = listBudget();
  assert.ok(b.sim.ledger.includes('模拟'), '模拟台账标注');
  assert.ok(b.real.ledger.includes('真实'), '真实台账标注');
  assert.ok(typeof b.sim.totalSpentCNY === 'number' && typeof b.real.totalSpentCNY === 'number');
  return 'sim=' + b.sim.totalSpentCNY + ' 元 / real=' + b.real.totalSpentCNY + ' 元';
});

t('W7 重复生成同 Brief：各得独立产品目录，互不覆盖', async () => {
  const brief = listBriefs().find(b => b.id === 'tune-e');
  const r1 = await generateViaWorkbench({ briefText: brief.text });
  const r2 = await generateViaWorkbench({ briefText: brief.text });
  assert.ok(r1.ok && r2.ok);
  assert.notStrictEqual(r1.productId, r2.productId, '产品 ID 应唯一');
  assert.ok(fs.existsSync(path.join(PRODUCTS_DIR, r1.productId, 'product.json')));
  assert.ok(fs.existsSync(path.join(PRODUCTS_DIR, r2.productId, 'product.json')));
  return r1.productId + ' / ' + r2.productId;
});

runAll();
