'use strict';
/* G1 M3 · 端到端闭环演示编排器
   流程（曦 M0+M2 双闸门口径）：
   Brief（模拟）→ execute（模型调用段——本轮用 mock transport 注入候选，真实联调时替换为智谱 API）
   → 安全解析 → 完整 Schema 校验 → GT-1 可解性 → 组装器 → 产品包 → 写入 e2e-products/（预览服务加载）
   硬规则：
   - 生成数据只作为 JSON 输入；模型段为模拟时必须在档案与返回值中如实标注 mocked-generation；
   - 每个闸门失败即停（分类留档），全过才产出产品包；
   - 预算闸门照常接入（mock 段不产生真实费用，但台账机制一致）。
*/
const fs = require('fs');
const path = require('path');
const { generateWithRetry } = require('./retry-loop');
const { createArchiver } = require('./archive');
const { packageCandidate } = require('./packager');
const { createBudgetGuard } = require('./budget');

/* runE2E({ brief, briefId, model, candidate, transport?, archiver?, DSLRules, errProbe,
            budgetGuard?, maxAttempts?, outDir? })
   candidate = { content } 模拟模型输出（含围栏），真实联调时由智谱 API 返回。
   返回 { ok, productPath?, attempts, spentCNY, gates:{...}, reason? } */
async function runE2E(opts) {
  const outDir = opts.outDir || path.join(__dirname, 'e2e-products');
  const archiver = opts.archiver || createArchiver({ dir: path.join(__dirname, 'e2e-archives'), briefId: opts.briefId });
  const events = [];

  // 模型段：mock transport 返回注入候选（如实标注 mocked-generation）
  const transport = opts.transport || (async () => ({
    status: 200, sent: true,
    body: JSON.stringify({ choices: [{ message: { content: opts.candidate.content } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })
  }));

  const rr = await generateWithRetry({
    brief: opts.brief, briefId: opts.briefId, model: opts.model,
    apiKey: opts.apiKey !== undefined ? opts.apiKey : 'mock-key',
    transport, archiver, DSLRules: opts.DSLRules, errProbe: opts.errProbe,
    budgetGuard: opts.budgetGuard, maxAttempts: opts.maxAttempts || 2
  });
  events.push(...rr.events);
  if (!rr.ok) {
    return { ok: false, stage: 'generation', attempts: rr.attempts, spentCNY: rr.spentCNY, events, reason: rr.reason };
  }

  // 组装器（最后一道闸门）→ 产品包
  const pk = packageCandidate(rr.candidate, {
    briefId: opts.briefId, model: opts.model, promptVersion: 'e2e-demo',
    archiveRefs: archiver.list().map(f => path.join(archiver.briefDir, f))
  });
  if (!pk.ok) {
    return { ok: false, stage: 'packaging', attempts: rr.attempts, spentCNY: rr.spentCNY, events, reason: '组装器拒绝: ' + JSON.stringify(pk.errors) };
  }

  // 产品包落盘（预览服务加载 e2e-products/）
  const productDir = path.join(outDir, opts.briefId);
  fs.mkdirSync(productDir, { recursive: true });
  const productPath = path.join(productDir, 'product.json');
  fs.writeFileSync(productPath, pk.product.dataJson, 'utf8');
  fs.writeFileSync(path.join(productDir, 'meta.json'), JSON.stringify(pk.product.meta, null, 2), 'utf8');

  return {
    ok: true, attempts: rr.attempts, candidate: rr.candidate,
    solvability: rr.events.filter(e => e.kind === 'solvability'),
    productPath, product: pk.product, spentCNY: rr.spentCNY, events,
    mockedGeneration: true   // 如实标注：模型段为模拟
  };
}

module.exports = { runE2E };

// CLI 入口：node e2e-demo.js → 运行默认演示（模拟生成段）并把产品包写入管线 e2e-products/
if (require.main === module) {
  (async () => {
    const candidateFile = path.join(__dirname, 'e2e', 'candidate-glm5-demo.json');
    const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
    const { loadRuntime } = require('../validator/solver');
    const SPIKE = path.join(__dirname, '..', '..', '11_Spike_网格解谜');
    const rt = loadRuntime(path.join(SPIKE, 'engine', 'dsl_runtime.js'));
    const r = await runE2E({
      brief: '设计一个按序踩灯机制的网格解谜游戏（三盏灯按序点亮后出口开启）',
      briefId: 'glm5-demo', model: 'glm-5.3-flash', candidate,
      DSLRules: rt.DSLRules, errProbe: rt.errProbe,
      outDir: path.join(__dirname, 'e2e-products')
    });
    console.log(JSON.stringify({ ok: r.ok, attempts: r.attempts, stage: r.stage || null,
                                 productPath: r.productPath || null, reason: r.reason || null,
                                 mockedGeneration: r.mockedGeneration === true }, null, 1));
    process.exit(r.ok ? 0 : 1);
  })();
}
