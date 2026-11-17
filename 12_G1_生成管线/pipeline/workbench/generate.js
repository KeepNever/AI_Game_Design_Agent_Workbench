'use strict';
/* G1 工作台 · 生成编排器（曦 A 方案 MVP，2026-11-17）
   复用 runE2E 全闸门链（安全解析 → Schema → GT-1 → 组装器 → 产品落盘），
   模型段 = Mock 传输层（mock-transport.js，注入候选如实标注）。
   Mock 与真实严格分离（曦执行约束）：
   - 档案：archives/workbench-mock/<briefId>/（真实档案体系零触碰）；
   - 台账：budget-ledger-sim.json（模拟台账，机制与真实 22 元台账完全一致——
     同一 createBudgetGuard 代码路径，闸门照常生效，不绕过）；
     真实台账 archives/budget-ledger.json 仅读取展示、Mock 通道绝不写入；
   - 产品包：pipeline/workbench/products/<id>/（预览服务注册为 wb-*）。
*/
const fs = require('fs');
const path = require('path');
const { runE2E } = require('../e2e-demo');
const { createArchiver } = require('../archive');
const { createBudgetGuard } = require('../budget');
const { createMockTransport } = require('./mock-transport');

const MOCK_ARCHIVES = path.join(__dirname, '..', '..', 'archives', 'workbench-mock');
const PRODUCTS_DIR = path.join(__dirname, 'products');
const REAL_LEDGER_PATH = path.join(__dirname, '..', '..', 'archives', 'budget-ledger.json');
const SIM_LEDGER_PATH = path.join(MOCK_ARCHIVES, 'budget-ledger-sim.json');

let runtimeCache = null;
function getRuntime() {
  if (!runtimeCache) {
    const { loadRuntime } = require('../../validator/solver');
    const SPIKE = path.join(__dirname, '..', '..', '..', '11_Spike_网格解谜');
    runtimeCache = loadRuntime(path.join(SPIKE, 'engine', 'dsl_runtime.js'));
  }
  return runtimeCache;
}

// 闸门节点视图（从事件流派生——展示当前节点/失败原因/重试次数/拦截原因）
// pkView：rr.ok → {ok:true}；packaging 失败 → 从 reason 提取；上游失败 → null（未到达）
function buildStages(rr) {
  const ev = rr.events || [];
  const pkView = rr.ok ? { ok: true }
    : (rr.stage === 'packaging' ? { ok: false, errors: [{ detail: String(rr.reason || '').replace('组装器拒绝: ', '') }] } : null);
  const stages = [];
  const budgetEvents = ev.filter(e => e.kind === 'budget');
  const budgetBlock = budgetEvents.find(e => ['no_price_rejected', 'insufficient_budget', 'hold_unresolved'].includes(e.outcome));
  stages.push({ node: '预算预留（模拟台账）', ok: !budgetBlock, detail: budgetBlock ? budgetBlock.label : '预留成功' });

  const auth = ev.find(e => e.kind === 'auth');
  const inputLimit = ev.find(e => e.kind === 'input_limit');
  stages.push({ node: '模型调用（Mock 注入候选）', ok: !auth && !inputLimit,
                detail: auth ? auth.label : inputLimit ? inputLimit.label : ('Mock 调用 ' + (rr.attempts || 0) + ' 次（usage 为模拟计数）') });

  const schemaEvents = ev.filter(e => e.kind === 'schema');
  stages.push({ node: '安全解析 + Schema 校验', ok: !schemaEvents.length || rr.ok,
                detail: schemaEvents.length
                  ? schemaEvents.map(e => '第' + e.attempt + '回合拦截 ' + e.errorCount + ' 项错误').join('；') + '（回喂修正后重试）'
                  : '通过' });

  const solveEvents = ev.filter(e => e.kind === 'solvability');
  const solveLast = solveEvents[solveEvents.length - 1];
  stages.push({ node: 'GT-1 可解性验证', ok: !solveEvents.length || (solveLast && solveLast.outcome === 'solve_pass'),
                detail: solveEvents.length
                  ? solveEvents.map(e => '第' + e.attempt + '回合 ' + (e.outcome === 'solve_pass' ? 'PASS' : e.detail)).join('；')
                  : '通过' });

  stages.push({ node: '组装器（最后一道闸门）', ok: !pkView || pkView.ok,
                detail: pkView && !pkView.ok ? '拒绝: ' + JSON.stringify(pkView.errors).slice(0, 120)
                       : pkView ? '纯数据核验通过' : '未到达（上游闸门拦截）' });
  stages.push({ node: '产品落盘', ok: !!rr.ok, detail: rr.ok ? 'product.json + meta.json' : '未落盘（闸门未全过）' });
  return stages;
}

function readLedgerSafe(file) {
  try {
    if (!fs.existsSync(file)) return { exists: false, totalSpentCNY: 0, reservedCNY: 0, entries: [] };
    const lg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { exists: true, totalSpentCNY: lg.totalSpentCNY, reservedCNY: lg.reservedCNY,
             holds: (lg.holds || []).length, entries: (lg.entries || []).slice(-8) };
  } catch (e) {
    return { exists: false, error: e.message, totalSpentCNY: 0, reservedCNY: 0, entries: [] };
  }
}

/* generateViaWorkbench({ briefText, capCNY? })
   返回 { ok, attempts, stages, events, budget:{sim,real}, productUrl?, mocked, fallback, matched, reason? } */
async function generateViaWorkbench(opts) {
  const briefText = String(opts.briefText || '').trim();
  if (!briefText) return { ok: false, mocked: true, reason: 'brief_empty：Brief 为空', stages: [], events: [] };

  const mt = createMockTransport({ briefText });
  const base = mt.matched ? mt.matched.id : 'free';
  const briefId = 'wb-' + base + '-' + Date.now().toString(36);

  // 注意：createArchiver 自带 briefId 子目录（briefDir = dir/briefId），dir 传 Mock 档案根即可
  const archiver = createArchiver({ dir: MOCK_ARCHIVES, briefId });
  const guard = createBudgetGuard({
    ledgerPath: SIM_LEDGER_PATH,
    capCNY: typeof opts.capCNY === 'number' ? opts.capCNY : 22     // capCNY 覆盖仅供测试注入
  });

  const rt = getRuntime();
  const rr = await runE2E({
    brief: briefText, briefId, model: 'glm-5.3-flash',
    transport: mt.transport,                       // Mock 通道（【mock】标注贯穿）
    archiver, DSLRules: rt.DSLRules, errProbe: rt.errProbe,
    budgetGuard: guard, maxAttempts: 3,
    outDir: PRODUCTS_DIR
  });

  const simLedger = await guard.getLedger();
  const productId = 'wb-' + briefId.replace(/^wb-/, '');
  const budget = {
    sim: { totalSpentCNY: simLedger.totalSpentCNY, reservedCNY: simLedger.reservedCNY,
           capCNY: simLedger.capCNY, entries: simLedger.entries.slice(-8), ledger: 'budget-ledger-sim.json（模拟台账）' },
    real: Object.assign({ ledger: 'archives/budget-ledger.json（真实台账——Mock 通道绝不写入）' }, readLedgerSafe(REAL_LEDGER_PATH))
  };

  return {
    ok: !!rr.ok,
    stage: rr.stage || null,
    attempts: rr.attempts || 0,
    spentTokens: rr.spentTokens || 0,
    spentCNY: rr.spentCNY || 0,                    // 模拟台账核销额（非真实费用）
    events: rr.events || [],
    stages: buildStages(rr),
    budget,
    productId: rr.ok ? productId : null,
    productUrl: rr.ok ? '/preview/' + encodeURIComponent(productId) : null,
    productTitle: rr.ok && rr.product && rr.product.data && rr.product.data.mechanic ? rr.product.data.mechanic.title : null,
    mocked: true,                                   // 如实标注：本通道恒为模拟生成
    mockFallback: mt.fallback,                      // 自由 Brief 无匹配 → fallback 候选，如实上报
    matchedBrief: mt.matched ? { id: mt.matched.id, title: mt.matched.title, source: mt.matched.source } : null,
    archivesDir: path.join('archives', 'workbench-mock', briefId),
    reason: rr.reason || null
  };
}

function listBriefs() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'tuning-briefs.json'), 'utf8'));
  return cfg.briefs.map(b => ({ id: b.id, title: b.title, text: b.text, source: b.source, injectFirstFailure: !!b.injectFirstFailure }));
}

function listBudget() {
  return {
    sim: Object.assign({ ledger: 'budget-ledger-sim.json（模拟台账，Mock 专用）' }, readLedgerSafe(SIM_LEDGER_PATH)),
    real: Object.assign({ ledger: 'archives/budget-ledger.json（真实台账，22 元总预算）' }, readLedgerSafe(REAL_LEDGER_PATH))
  };
}

module.exports = { generateViaWorkbench, listBriefs, listBudget, PRODUCTS_DIR };
