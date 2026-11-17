'use strict';
/* G1 M2 闭环测试 · 拦截-有限重试 + 金额硬闸门 v3 + 纯数据组装器
   T 组：重试闭环（错误四分类、sent 契约、鉴权不重试、每次尝试留档）
   B 组：金额硬闸门（reservationId 贯穿、重复核销/释放拒绝、hold 阻塞、NO_PRICE、并发不破限）
   X 组：跨进程预算竞争（独立 Node 子进程）
   PK 组：纯数据组装器（round-trip、再校验、不含可执行包装）
*/
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createArchiver } = require('./archive');
const { generateWithRetry } = require('./retry-loop');
const { packageCandidate } = require('./packager');
const { loadRuntime } = require('../validator/solver');
const { createBudgetGuard, loadPricing } = require('./budget');
const { estimateInputTokensUpperBound } = require('./model-adapter');
const { buildMessages } = require('./prompts/prompt-v1');

const results = [];
const testQueue = [];
async function t(name, fn) { testQueue.push({ name, fn }); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'g1-loop-')); }

// 加载真实运行时（可解性验证需要）
const SPIKE = path.join(__dirname, '..', '..', '11_Spike_网格解谜');
const runtime = loadRuntime(path.join(SPIKE, 'engine', 'dsl_runtime.js'));
const { DSLRules, errProbe } = runtime;

function validEnvelope(title) {
  return {
    dsl_version: 'grid-puzzle/0.1',
    mechanic: { dsl: 'grid-puzzle/0.1', title: title || '重试测试游戏', win: 'px()==1', status: '{px()}' },
    levels: [{ name: 'L1', map: ['###', '#.#', '###'], player: { x: 1, y: 1 }, dynamic: [] }]
  };
}

// 脚本化 mock 传输（sent 契约 v2）：默认 sent=true（已发出）；预置响应按次吐出并记录 payload
function scriptedHttp(responses) {
  const payloads = [];
  let i = 0;
  const fn = async (payload) => {
    payloads.push(payload);
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (r.throw) throw new Error(r.throw);
    return { status: r.status !== undefined ? r.status : 200, body: r.body !== undefined ? r.body : JSON.stringify({ choices: [{ message: { content: r.content } }], usage: r.usage || { prompt_tokens: 6000, completion_tokens: 2000, total_tokens: 8000 } }), sent: r.sent === undefined ? true : r.sent };
  };
  fn.payloads = payloads;
  return fn;
}
function wrap(content) { return JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 6000, completion_tokens: 2000, total_tokens: 8000 } }); }

/* ===== T 重试闭环 ===== */
t('T1 JSON 解析失败 → 重试一次后成功（attempts=2，两次留档，分类 json_parse）', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 't1' });
  const http = scriptedHttp([{ content: '抱歉我说不明白' }, { content: JSON.stringify(validEnvelope()) }]);
  const r = await generateWithRetry({ brief: 'x', briefId: 't1', model: 'glm-5.3-flash', apiKey: 'k',
                                      transport: http, archiver, DSLRules, errProbe, maxAttempts: 3 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 2);
  assert.strictEqual(archiver.list().length, 2, '每次尝试必须留档');
  assert.ok(r.events.some(e => e.kind === 'json_parse'), '事件缺 json_parse 分类');
  assert.ok(r.events.some(e => e.kind === 'ok'));
  assert.strictEqual(http.payloads.length, 2);
  // 请求侧 Token 真约束证据：实际发送的请求体携带 max_tokens = maxOutputTokens（API 侧硬限输出）
  assert.strictEqual(http.payloads[0].max_tokens, 2000, '请求体未携带 max_tokens=2000（输出上限未接线）');
  assert.ok(http.payloads[0].messages, '请求体缺 messages（输入内容应在 maxInputTokens 预检范围内才被发出，见 T8）');
});
t('T2 Schema 错误 → 结构化错误清单回喂（回喂内容含错误码），修正后通过', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 't2' });
  const bad = validEnvelope(); bad.mechanic.enter = [{ when: 'true', effects: [{ op: 'nuke' }] }];
  const http = scriptedHttp([{ content: JSON.stringify(bad) }, { content: JSON.stringify(validEnvelope('修正版')) }]);
  const r = await generateWithRetry({ brief: 'x', briefId: 't2', model: 'm', apiKey: 'k',
                                      transport: http, archiver, DSLRules, errProbe, maxAttempts: 3 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 2);
  const secondPayload = JSON.stringify(http.payloads[1]);
  assert.ok(secondPayload.includes('UNKNOWN_OP'), '回喂未包含结构化错误码');
  assert.ok(secondPayload.includes('mechanic.enter'), '回喂未包含错误位置');
  assert.ok(r.events.some(e => e.kind === 'schema'), '事件缺 schema 分类');
});
t('T3 鉴权失败（HTTP 401，已发送但无 usage）→ 结果不确定：预留保留 + 停止（不重试）', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const archiver = createArchiver({ dir, briefId: 't3' });
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22 });
  const http = scriptedHttp([{ status: 401, body: 'unauthorized' }]);
  const r = await generateWithRetry({ brief: 'x', briefId: 't3', model: 'glm-5.3-flash', apiKey: 'k',
                                      transport: http, archiver, maxAttempts: 3, budgetGuard: guard });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.attempts, 1, '401 不重试');
  assert.strictEqual(http.payloads.length, 1);
  assert.ok(r.events.some(e => e.kind === 'auth'), '事件缺 auth 分类');
  assert.strictEqual(r.reason.startsWith('usage_unverified_halt'), true, '已发送但无 usage → 结果不确定 → hold 停止，理由: ' + r.reason);
  const lg = await guard.getLedger();
  assert.ok((lg.holds || []).some(h => !h.resolved), '预留应进入 hold 状态');
});
t('T4 网络异常（确定未发送：sent=false）→ release 预留 + 有限重试后成功', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const archiver = createArchiver({ dir, briefId: 't4' });
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22 });
  const http = scriptedHttp([{ status: 0, body: 'ECONNREFUSED', sent: false }, { content: JSON.stringify(validEnvelope()) }]);
  const r = await generateWithRetry({ brief: 'x', briefId: 't4', model: 'glm-5.3-flash', apiKey: 'k',
                                      transport: http, archiver, DSLRules, errProbe, maxAttempts: 3, budgetGuard: guard });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 2);
  assert.ok(r.events.some(e => e.kind === 'network'), '事件缺 network 分类');
  const lg = await guard.getLedger();
  assert.ok(lg.entries.some(e => e.type === 'RELEASE'), '确定未发送的预留应被释放');
});
t('T4b 请求已发送但结果不确定（sent=true 无响应）→ hold 保留预留 + 停止（不得 release）', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const archiver = createArchiver({ dir, briefId: 't4b' });
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22 });
  const http = scriptedHttp([{ status: 0, body: 'timeout after dispatch', sent: true }]);
  const r = await generateWithRetry({ brief: 'x', briefId: 't4b', model: 'glm-5.3-flash', apiKey: 'k',
                                      transport: http, archiver, DSLRules, errProbe, maxAttempts: 3, budgetGuard: guard });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason.startsWith('usage_unverified_halt'), true, '理由: ' + r.reason);
  const lg = await guard.getLedger();
  assert.ok((lg.holds || []).some(h => !h.resolved), '结果不确定必须保留预留进入 hold');
  assert.strictEqual(lg.entries.some(e => e.type === 'RELEASE'), false, '结果不确定不得释放预留');
});
t('T6 maxAttempts=1：首次失败即停（不再重试）', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 't6' });
  const http = scriptedHttp([{ content: '坏输出' }]);
  const r = await generateWithRetry({ brief: 'x', briefId: 't6', model: 'm', apiKey: 'k',
                                      transport: http, archiver, maxAttempts: 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.attempts, 1);
  assert.strictEqual(r.reason.startsWith('max_attempts_exhausted'), true);
});
t('T7 可解性失败 → 回喂可解性信息（UNSAT/UNKNOWN 都不算通过）', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 't7' });
  const bad = validEnvelope('围死出口');
  bad.mechanic.win = "tchar()=='E'";
  bad.mechanic.tiles = { E: { style: 'exit' } };
  bad.levels[0] = { name: 'L', map: ['#.#E#', '#.###', '#....'], player: { x: 1, y: 1 }, dynamic: [] };
  const http = scriptedHttp([
    { content: JSON.stringify(bad) },
    { content: JSON.stringify(validEnvelope('修正版')) }
  ]);
  const r = await generateWithRetry({ brief: 'x', briefId: 't7', model: 'm', apiKey: 'k',
                                      transport: http, archiver, DSLRules, errProbe, maxAttempts: 3 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.attempts, 2);
  const secondPayload = JSON.stringify(http.payloads[1]);
  assert.ok(secondPayload.includes('可解性验证'), '回喂未包含可解性信息');
  assert.ok(r.events.some(e => e.kind === 'solvability' && e.outcome === 'solve_failed'));
});
t('T8 输入估算预检（保守上界，非严格硬限制）：估算超 maxInputTokens → prompt_too_large，不发起调用', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 't8' });
  let netCalls = 0;
  const http = async () => { netCalls++; return { status: 200, body: wrap(JSON.stringify(validEnvelope())), sent: true }; };
  const r = await generateWithRetry({ brief: 'x'.repeat(60000), briefId: 't8', model: 'm', apiKey: 'k',
                                      transport: http, archiver, maxAttempts: 2, maxInputTokens: 100 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason.startsWith('input_limit_no_retry'), true);
  assert.strictEqual(netCalls, 0, '输入超限仍发起了调用');
  assert.ok(r.events.some(e => e.kind === 'input_limit'));
});
t('T9a 输入估算计数验证：中文/英文/数字/特殊符号/emoji/JSON 混合内容分类别上界', () => {
  // 分类系数：ASCII 1/字符、CJK 2/字符、其他非 ASCII（emoji 等）4/码点（保守上界）
  assert.strictEqual(estimateInputTokensUpperBound([{ role: 'user', content: '中'.repeat(100) }]), 200, 'CJK 应按 2 倍计');
  assert.strictEqual(estimateInputTokensUpperBound([{ role: 'user', content: 'abcdefghij' }]), 10, 'ASCII 应按 1/字符计');
  assert.strictEqual(estimateInputTokensUpperBound([{ role: 'user', content: '1234567890' }]), 10, '数字应按 ASCII 计');
  assert.strictEqual(estimateInputTokensUpperBound([{ role: 'user', content: '(){}:,,' }]), 7, 'JSON 结构符应按 ASCII 计');
  assert.strictEqual(estimateInputTokensUpperBound([{ role: 'user', content: '🎮'.repeat(10) }]), 40, 'emoji 应按 4/码点计');
  // 混合：中文 20 字（×2=40）+ 英文 10（×1=10）+ emoji 5（×4=20）→ 70
  const mixed = '中文中文中文中文中文中文中文中文中文中文' + 'abcdefghij' + '🎮🎮🎮🎮🎮';
  assert.strictEqual(estimateInputTokensUpperBound([{ role: 'user', content: mixed }]), 70, '混合内容计数不符');
  // JSON 混合样本：结构符逐字符计（ASCII）+ 中文字段值 2 倍
  const jsonSample = JSON.stringify({ title: '测试', n: 123 });
  const expected = [...jsonSample].reduce((a, ch) => a + (ch.codePointAt(0) < 128 ? 1 : 2), 0);
  assert.strictEqual(estimateInputTokensUpperBound([{ role: 'user', content: jsonSample }]), expected, 'JSON 混合样本计数不符');
  return '六类内容计数全部符合分字符类别上界';
});
t('T9b 临界值（ASCII 路径）：总估算恰 6000 → 放行发起调用；6001 → prompt_too_large 且 netCalls=0', async () => {
  // 注意：估算对象 = 完整 messages（含系统提示词，约 3.5K 估算）——Brief 用 ASCII 字符补齐到精确临界
  const est0 = estimateInputTokensUpperBound(buildMessages('x'));
  const pad = 6000 - est0;                       // 'x' 自身计 1，补齐后总估算恰 6000
  const dir1 = tmpDir();
  const http1 = scriptedHttp([{ content: JSON.stringify(validEnvelope()) }]);
  const r1 = await generateWithRetry({ brief: 'x' + 'a'.repeat(pad), briefId: 't9b-1', model: 'm', apiKey: 'k',
                                       transport: http1, archiver: createArchiver({ dir: dir1, briefId: 't9b-1' }),
                                       maxAttempts: 1, maxInputTokens: 6000, maxOutputTokens: 2000 });
  assert.strictEqual(http1.payloads.length, 1, '临界值 6000 应放行发起调用');
  // 6001 字符 → 总估算 6001 > 6000 → 拒绝，netCalls=0
  const dir2 = tmpDir();
  let netCalls = 0;
  const http2 = async () => { netCalls++; return { status: 200, body: wrap(JSON.stringify(validEnvelope())), sent: true }; };
  const r2 = await generateWithRetry({ brief: 'x' + 'a'.repeat(pad + 1), briefId: 't9b-2', model: 'm', apiKey: 'k',
                                       transport: http2, archiver: createArchiver({ dir: dir2, briefId: 't9b-2' }),
                                       maxAttempts: 2, maxInputTokens: 6000, maxOutputTokens: 2000 });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(netCalls, 0, '超限 1 个字符仍发起了调用');
  return 'ASCII 临界：总估算 6000 放行 / 6001 拒绝（netCalls=0）';
});
t('T9c 临界值（CJK 路径）：汉字补齐至总估算 6000 → 放行；超 2 → 拒绝', async () => {
  const est0 = estimateInputTokensUpperBound(buildMessages('中'));
  const perChar = 2;
  const deficit = 6000 - est0 + perChar;         // 含初始汉字自身；2k + j = deficit
  const k = Math.floor(deficit / perChar);
  const j = deficit - k * perChar;
  const briefPass = '中'.repeat(k) + 'a'.repeat(j);
  const dir = tmpDir();
  const http = scriptedHttp([{ content: JSON.stringify(validEnvelope()) }]);
  const r = await generateWithRetry({ brief: briefPass, briefId: 't9c-1', model: 'm', apiKey: 'k',
                                      transport: http, archiver: createArchiver({ dir, briefId: 't9c-1' }),
                                      maxAttempts: 1, maxInputTokens: 6000, maxOutputTokens: 2000 });
  assert.strictEqual(http.payloads.length, 1, 'CJK 临界值应放行');
  let netCalls = 0;
  const http2 = async () => { netCalls++; return { status: 200, body: wrap(JSON.stringify(validEnvelope())), sent: true }; };
  const r2 = await generateWithRetry({ brief: briefPass + 'a', briefId: 't9c-2', model: 'm', apiKey: 'k',
                                       transport: http2, archiver: createArchiver({ dir, briefId: 't9c-2' }),
                                       maxAttempts: 2, maxInputTokens: 6000, maxOutputTokens: 2000 });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(netCalls, 0, 'CJK 超限仍发起了调用');
  return 'CJK 临界：总估算 6000 放行 / 6001 拒绝（netCalls=0）';
});
t('T9d 校准钩子：档案同时记录 estimate_tokens 与 usage（真实联调后据此校准系数）', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 't9d' });
  // mock usage 取真实量级（小 Brief 实际输入约 2K tokens），不得硬编码超上界的假数据
  const http = async () => ({ status: 200, sent: true, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(validEnvelope()) } }], usage: { prompt_tokens: 2000, completion_tokens: 500, total_tokens: 2500 } }) });
  await generateWithRetry({ brief: '校准钩子样本', briefId: 't9d', model: 'glm-5.3-flash', apiKey: 'k',
                            transport: http, archiver, DSLRules, errProbe, maxAttempts: 1 });
  const rec = JSON.parse(fs.readFileSync(path.join(archiver.briefDir, archiver.list()[0]), 'utf8'));
  assert.ok(typeof rec.estimate_tokens === 'number' && rec.estimate_tokens > 0, '档案缺 estimate_tokens');
  assert.ok(rec.usage && rec.usage.prompt_tokens > 0, '档案缺 usage.prompt_tokens');
  assert.strictEqual(rec.usage.prompt_tokens <= rec.estimate_tokens, true,
                     '实测 usage 超过保守上界——上界假设被证伪，需校准系数: ' + rec.usage.prompt_tokens + ' vs ' + rec.estimate_tokens);
  return 'estimate_tokens ' + rec.estimate_tokens + ' ≥ usage.prompt_tokens ' + rec.usage.prompt_tokens + '（保守上界成立）';
});

/* ===== T10 Tokenizer 辅助进程（精确计数 / 显式降级 / 完整 messages 计数 / 校准对比）===== */
t('T10a 精确计数接线：tokenizer 可用时预检用精确值（估算值 3510 vs 精确 7000 → 超限拒绝），档案标注 source=tokenizer', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 't10a' });
  let netCalls = 0;
  const http = async () => { netCalls++; return { status: 200, sent: true, body: wrap(JSON.stringify(validEnvelope())) }; };
  // mock 精确计数 7000（远超估算上界 3510 与上限 6000）——若误用估算将放行，若正确使用精确值将拒绝
  let receivedMessages = null;
  const tokenCounter = {
    countExact: async (messages) => {
      receivedMessages = messages;
      return { available: true, count: 7000, source: 'tokenizer', loader: 'mock-AutoTokenizer' };
    }
  };
  const r = await generateWithRetry({ brief: 'x', briefId: 't10a', model: 'm', apiKey: 'k',
                                      transport: http, archiver, DSLRules, errProbe, maxAttempts: 1, tokenCounter });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(netCalls, 0, '精确计数 7000 超限仍放行了调用');
  assert.strictEqual(r.reason.startsWith('input_limit_no_retry'), true);
  // 计数对象 = 完整 messages（含系统提示词 + 用户 Brief）——不是只统计 Brief 文本
  assert.ok(receivedMessages && Array.isArray(receivedMessages) && receivedMessages.length >= 2, '计数器收到的不是完整 messages');
  assert.ok(receivedMessages.some(m => m.role === 'system'), '计数对象缺系统提示词');
  const rec = JSON.parse(fs.readFileSync(path.join(archiver.briefDir, archiver.list()[0]), 'utf8'));
  assert.strictEqual(rec.input_tokens_source, 'tokenizer', '档案未如实标注精确计数来源');
  assert.strictEqual(rec.estimate_tokens, 7000);
  return '预检用精确值 7000 拒绝（netCalls=0），计数对象为完整 messages，档案 source=tokenizer';
});
t('T10b 显式降级：tokenizer 不可用 → 估算预检 + 档案如实标注 source=estimator（不伪装精确）', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 't10b' });
  const tokenCounter = { countExact: async () => ({ available: false, reason: 'PYTHON_ENV_MISSING：venv 未创建', source: 'estimator' }) };
  const http = scriptedHttp([{ content: JSON.stringify(validEnvelope()) }]);
  const r = await generateWithRetry({ brief: 'x', briefId: 't10b', model: 'm', apiKey: 'k',
                                      transport: http, archiver, DSLRules, errProbe, maxAttempts: 1, tokenCounter });
  assert.strictEqual(r.ok, true, '降级路径应继续工作');
  const rec = JSON.parse(fs.readFileSync(path.join(archiver.briefDir, archiver.list()[0]), 'utf8'));
  assert.strictEqual(rec.input_tokens_source, 'estimator', '降级未如实标注');
  assert.ok(rec.input_tokens_source !== 'tokenizer', '估算值伪装成精确计数');
  return '降级为估算且档案标注 source=estimator';
});
t('T10c 重试回喂后计数对象仍为完整 messages（含回喂内容）', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 't10c' });
  const bad = validEnvelope(); bad.mechanic.enter = [{ when: 'true', effects: [{ op: 'nuke' }] }];
  const received = [];
  const http = scriptedHttp([{ content: JSON.stringify(bad) }, { content: JSON.stringify(validEnvelope()) }]);
  const tokenCounter = {
    countExact: async (messages) => { received.push(JSON.parse(JSON.stringify(messages))); return { available: true, count: 100, source: 'tokenizer' }; }
  };
  const r = await generateWithRetry({ brief: 'x', briefId: 't10c', model: 'm', apiKey: 'k',
                                      transport: http, archiver, DSLRules, errProbe, maxAttempts: 2, tokenCounter });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(received.length, 2, '每次尝试都应计数');
  assert.ok(JSON.stringify(received[1]).includes('UNKNOWN_OP'), '第二次计数的 messages 缺回喂内容');
  return '两次计数均为完整 messages（第二次含诊断回喂）';
});
t('T10d 真实 sidecar 冒烟：配置绑定 / revision 锁定 / python 环境探测（环境未就绪则明确跳过）', async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'tokenizer', 'tokenizer-config.json'), 'utf8'));
  const facts = [];
  for (const [model, mc] of Object.entries(cfg.models)) {
    assert.ok(mc.repo && mc.revision && /^[0-9a-f]{40}$/.test(mc.revision), model + ' revision 未锁定或非法');
    facts.push(model + ' → ' + mc.repo + '@' + mc.revision.slice(0, 10) + ' (' + mc.loader + ')');
  }
  const py47 = cfg.pythonEnvs['glm-4.7'];
  const py53 = cfg.pythonEnvs['glm-5.3-flash'];
  const envReady = fs.existsSync(path.join(__dirname, '..', py47)) && fs.existsSync(path.join(__dirname, '..', py53));
  if (!envReady) {
    return 'SKIP（明确跳过）：双 venv 未创建——绑定已核验（' + facts.join('；') + '），真实冒烟待环境就绪';
  }
  const { createGlmTokenCounter } = require('./tokenizer/glm-tokenizer');
  const counter = createGlmTokenCounter({ model: 'glm-4.7' });
  const c = await counter.countExact([{ role: 'user', content: '你好，世界。' }]);
  assert.strictEqual(c.available, true, '真实计数失败: ' + (c.reason || ''));
  assert.ok(c.count > 0);
  return 'glm-4.7 真实计数 ' + c.count + ' tokens（' + c.loader + '）';
});

/* ===== B 金额硬闸门（reservationId 贯穿 + 重复操作拒绝）===== */
t('B5 reservation 状态机：重复核销拒绝（DUPLICATE_SETTLE），核销只计一次', async () => {
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 100, output: 100 } } };   // 单次 = 6K/1M×100 + 2K/1M×100 = 0.8 元
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing });
  const res = await guard.reserve('m', { brief_id: 'b5' });
  assert.strictEqual(res.ok, true);
  const s1 = await guard.settle({ reservationId: res.reservationId, usage: { prompt_tokens: 6000, completion_tokens: 2000 } });
  assert.strictEqual(s1.settled, true);
  assert.strictEqual(s1.costCNY, 0.8);
  const s2 = await guard.settle({ reservationId: res.reservationId, usage: { prompt_tokens: 6000, completion_tokens: 2000 } });
  assert.strictEqual(s2.settled, false);
  assert.strictEqual(s2.rejected, true);
  assert.ok(s2.reason.includes('DUPLICATE_SETTLE'), '理由: ' + s2.reason);
  const lg = await guard.getLedger();
  assert.strictEqual(lg.totalSpentCNY, 0.8, '重复核销重复计费');
  assert.strictEqual(lg.reservations[res.reservationId].status, 'settled');
});
t('B6 reservation 状态机：重复释放拒绝（DUPLICATE_RELEASE），预留只减一次', async () => {
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 100, output: 100 } } };
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing });
  const res = await guard.reserve('m', { brief_id: 'b6' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual((await guard.getLedger()).reservedCNY, 0.8);
  const r1 = await guard.release({ reservationId: res.reservationId });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual((await guard.getLedger()).reservedCNY, 0);
  const r2 = await guard.release({ reservationId: res.reservationId });
  assert.strictEqual(r2.ok, false);
  assert.ok(r2.reason.includes('DUPLICATE_RELEASE'), '理由: ' + r2.reason);
  assert.strictEqual((await guard.getLedger()).reservedCNY, 0, '重复释放重复扣减预留');
});
t('B7 未解决 hold 阻止新请求；人工账务处置（released）后恢复', () => {
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22 });
  return (async () => {
    const res = await guard.reserve('glm-5.3-flash', { brief_id: 'b7' });
    assert.strictEqual(res.ok, true);
    await guard.hold({ reservationId: res.reservationId, reason: 'REQUEST_SENT_OUTCOME_UNCERTAIN（人工标记测试）' });
    const blocked = await guard.reserve('glm-5.3-flash', { brief_id: 'b7-2' });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.reason.startsWith('HOLD_UNRESOLVED'), true, '理由: ' + blocked.reason);
    const bad = await guard.resolveHold({ reservationId: res.reservationId, resolvedBy: 'manual-曦' });   // 缺 resolution → 拒绝
    assert.strictEqual(bad.ok, false, '缺账务处置的解除必须被拒绝');
    const ok = await guard.resolveHold({ reservationId: res.reservationId, resolution: 'released', resolvedBy: 'manual-曦' });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.costCNY, 0, 'released 处置不计费');
    const after = await guard.reserve('glm-5.3-flash', { brief_id: 'b7-3' });
    assert.strictEqual(after.ok, true, '账务处置后仍被阻塞');
    return 'hold 阻塞 → 账务处置（released）→ 恢复';
  })();
});
t('B7b hold 解除闭环（settled）：人工核对出实际 usage → 按真实费用核销', async () => {
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 100, output: 100 } } };
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing });
  const res = await guard.reserve('m', { brief_id: 'b7b' });        // 预留 0.8 元
  await guard.hold({ reservationId: res.reservationId, reason: '测试：请求结果不确定' });
  // 人工核对出实际 usage（如从智谱后台）→ 按 settled 处置核销
  const r = await guard.resolveHold({ reservationId: res.reservationId, resolution: 'settled',
                                      usage: { prompt_tokens: 6000, completion_tokens: 2000 }, resolvedBy: 'manual-曦' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.costCNY, 0.8, '应按实际 usage 核销');
  assert.strictEqual(r.totalSpentCNY, 0.8);
  assert.strictEqual(r.unresolvedRemaining, 0);
  const lg = await guard.getLedger();
  assert.strictEqual(lg.reservations[res.reservationId].status, 'settled');
  assert.strictEqual(lg.reservedCNY, 0, '核销后预留应清零');
  assert.strictEqual(lg.entries.some(e => e.type === 'HOLD_RESOLVED_SETTLED'), true, '账务闭环条目缺失');
});
t('B7c hold 解除闭环（settled + 超限）：人工核对的 usage 超上限也入 overruns', async () => {
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 100, output: 100 } } };
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing });
  const res = await guard.reserve('m', { brief_id: 'b7c' });
  await guard.hold({ reservationId: res.reservationId, reason: '测试' });
  const r = await guard.resolveHold({ reservationId: res.reservationId, resolution: 'settled',
                                      usage: { prompt_tokens: 999999, completion_tokens: 2000 }, resolvedBy: 'manual-曦' });
  assert.strictEqual(r.ok, true);
  const lg = await guard.getLedger();
  assert.strictEqual(lg.overruns.length, 1, '人工核对的超限 usage 未入 overruns');
  assert.strictEqual(lg.overruns[0].via, 'hold-resolution');
});
t('B7d resolveHold 无效处置拒绝 / 重复处置拒绝', async () => {
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22 });
  const res = await guard.reserve('glm-5.3-flash', { brief_id: 'b7d' });
  await guard.hold({ reservationId: res.reservationId, reason: '测试' });
  const bad = await guard.resolveHold({ reservationId: res.reservationId, resolution: '不知道' });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.reason.includes('INVALID_RESOLUTION'));
  const ok = await guard.resolveHold({ reservationId: res.reservationId, resolution: 'released', resolvedBy: 'manual-曦' });
  assert.strictEqual(ok.ok, true);
  const dup = await guard.resolveHold({ reservationId: res.reservationId, resolution: 'released', resolvedBy: 'manual-曦' });
  assert.strictEqual(dup.ok, false);
  assert.ok(dup.reason.includes('HOLD_NOT_FOUND'), '重复处置未拒绝: ' + dup.reason);
});
t('B8 超出 Token 上限核销：记录真实费用 + 预算超限事件（overruns）', async () => {
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 100, output: 100 } } };
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing });
  const res = await guard.reserve('m', { brief_id: 'b8' });
  assert.strictEqual(res.ok, true);
  // 实际 usage 超预留依据：prompt 999999 > maxInputTokens 6000
  const s = await guard.settle({ reservationId: res.reservationId, usage: { prompt_tokens: 999999, completion_tokens: 2000 } });
  assert.strictEqual(s.settled, true, '真实费用必须核销');
  assert.ok(s.costCNY > 0.8, '超限费用应高于预估: ' + s.costCNY);
  assert.ok(s.overrun, '应携带超限事件');
  const lg = await guard.getLedger();
  assert.strictEqual(lg.overruns.length, 1, 'overruns 未入账');
  assert.strictEqual(lg.overruns[0].usage.prompt_tokens, 999999);
  return '真实费用 ' + s.costCNY + ' 元已核销，超限事件已入账';
});
t('B9 NO_PRICE：未配置单价模型禁止发起真实请求 + 拒绝事件入账', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22 });   // pricing.json 无 'unknown-model'
  let netCalls = 0;
  const http = async () => { netCalls++; return { status: 200, body: wrap(JSON.stringify(validEnvelope())), sent: true }; };
  const r = await generateWithRetry({ brief: 'x', briefId: 'b9', model: 'unknown-model', apiKey: 'k',
                                      transport: http, archiver: createArchiver({ dir, briefId: 'b9' }),
                                      maxAttempts: 3, budgetGuard: guard });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(netCalls, 0, 'NO_PRICE 仍发起了网络调用');
  assert.strictEqual(r.reason.startsWith('no_price_no_retry'), true);
  const lg = await guard.getLedger();
  assert.ok(lg.entries.some(e => e.type === 'NO_PRICE_REJECTED'), 'NO_PRICE 拒绝事件未入账');
});
t('B10 并发请求不能共同突破 22 元上限（预留串行化 + 单写入者）', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 2000, output: 2000 } } };  // 预估 = 12+4 = 16 元 > 11 元（22/2）
  const mk = (id) => {
    const archiver = createArchiver({ dir: tmpDir(), briefId: id });
    let netCalls = 0;
    const http = async () => { netCalls++; return { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(validEnvelope()) } }], usage: { prompt_tokens: 6000, completion_tokens: 2000, total_tokens: 8000 } }), sent: true }; };
    return { archiver, http, netCallsInfo: () => netCalls };
  };
  const a = mk('b10a'), b = mk('b10b');
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing });
  const [ra, rb] = await Promise.all([
    generateWithRetry({ brief: 'x', briefId: 'b10a', model: 'm', apiKey: 'k', transport: a.http, archiver: a.archiver, DSLRules, errProbe, maxAttempts: 2, budgetGuard: guard }),
    generateWithRetry({ brief: 'y', briefId: 'b10b', model: 'm', apiKey: 'k', transport: b.http, archiver: b.archiver, DSLRules, errProbe, maxAttempts: 2, budgetGuard: guard })
  ]);
  const totalCalls = a.netCallsInfo() + b.netCallsInfo();
  const lg = await guard.getLedger();
  assert.ok(lg.totalSpentCNY <= 22, '并发突破总预算：' + lg.totalSpentCNY + ' 元');
  assert.strictEqual(totalCalls, 1, '预留串行化失败：两个并发请求都发起了调用（共 ' + totalCalls + ' 次）');
  const okCount = [ra, rb].filter(x => x.ok).length;
  assert.strictEqual(okCount, 1, '应有恰好一个请求成功');
  return '总核销 ' + lg.totalSpentCNY + ' 元，成功调用 1 次，另一次被预算预留拒绝';
});

/* ===== B11-B16 复核测试（曦 2026-11-13 21:17）===== */
t('B11 锁所有权：外部进程的锁不被本实例误删（超时且锁完好）', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(dir, 'ledger.json');
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, lockTimeoutMs: 300 });
  const foreignLock = path.join(ledgerPath + '.lock');
  // 模拟外部进程持有锁（存活 PID + 新鲜时间戳——不满足回收条件）
  const fd = fs.openSync(foreignLock, 'wx');
  fs.writeFileSync(fd, JSON.stringify({ owner: process.pid + '-foreign-owner', ts: Date.now() }));
  fs.closeSync(fd);
  let err = null;
  try { await guard.getLedger(); } catch (e) { err = e; }
  assert.ok(err && String(err.message).includes('BUDGET_LOCK_TIMEOUT'), '外部锁未被尊重: ' + (err && err.message));
  const still = fs.readFileSync(foreignLock, 'utf8');
  assert.ok(still.includes('foreign-owner'), '外部锁被本实例误删');
  fs.unlinkSync(foreignLock);   // 测试清理
  return '外部锁完好保留，本实例按超时退出';
});
t('B12 陈旧锁回收：持有进程已死亡才回收；存活持有者不回收', async () => {
  const dir = tmpDir();
  // 12a 死亡持有者：用已退出的子进程 PID 构造陈旧锁 → 应被回收
  const { execSync } = require('child_process');
  const dead = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  // 等子进程退出（PID 变为死进程）
  await new Promise(r => { dead.on('exit', r); });
  const ledgerPath = path.join(dir, 'ledger.json');
  const deadLock = path.join(ledgerPath + '.lock');
  const fd = fs.openSync(deadLock, 'wx');
  fs.writeFileSync(fd, JSON.stringify({ owner: dead.pid + '-dead-holder', ts: Date.now() }));
  fs.closeSync(fd);
  fs.utimesSync(deadLock, Date.now() / 1000 - 60000, Date.now() / 1000 - 60000);   // 陈旧化
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, staleLockMs: 1000 });
  const lg = await guard.getLedger();   // 应回收死亡持有者的锁并正常执行
  assert.strictEqual(lg.entries.length, 0);
  assert.strictEqual(fs.existsSync(deadLock), false, '死亡持有者的陈旧锁未被回收');
  // 12b 存活持有者：本进程 PID + 陈旧时间戳 → 不回收（持有者还活着）
  const aliveLock = path.join(ledgerPath + '.lock');
  const fd2 = fs.openSync(aliveLock, 'wx');
  fs.writeFileSync(fd2, JSON.stringify({ owner: process.pid + '-alive-holder', ts: Date.now() }));
  fs.closeSync(fd2);
  fs.utimesSync(aliveLock, Date.now() / 1000 - 60000, Date.now() / 1000 - 60000);
  let err = null;
  try { await guard.getLedger(); } catch (e) { err = e; }
  assert.ok(err && String(err.message).includes('BUDGET_LOCK_TIMEOUT'), '存活持有者的锁被误回收');
  assert.strictEqual(fs.existsSync(aliveLock), true, '存活持有者的锁被误删');
  fs.unlinkSync(aliveLock);   // 测试清理
  return '死亡持有者回收 / 存活持有者保留';
});
t('B13/B14 hold 解除闭环（settled/released 两出口）', async () => {
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 100, output: 100 } } };
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing });
  // settled 出口：人工核对出实际 usage → 真实费用核销
  const r1 = await guard.reserve('m', { brief_id: 'b13' });
  await guard.hold({ reservationId: r1.reservationId, reason: '测试' });
  const s = await guard.resolveHold({ reservationId: r1.reservationId, resolution: 'settled',
                                      usage: { prompt_tokens: 6000, completion_tokens: 2000 }, resolvedBy: 'manual-曦' });
  assert.strictEqual(s.ok && s.costCNY === 0.8 && s.totalSpentCNY === 0.8, true, 'settled 处置失败: ' + JSON.stringify(s));
  // released 出口：人工核对确认无消耗 → 释放不计费
  const r2 = await guard.reserve('m', { brief_id: 'b14' });
  await guard.hold({ reservationId: r2.reservationId, reason: '测试' });
  const rel = await guard.resolveHold({ reservationId: r2.reservationId, resolution: 'released', resolvedBy: 'manual-曦' });
  assert.strictEqual(rel.ok && rel.costCNY === 0, true, 'released 处置失败');
  const lg = await guard.getLedger();
  assert.strictEqual(lg.totalSpentCNY, 0.8);
  assert.strictEqual(lg.reservedCNY, 0);
  assert.strictEqual(lg.reservations[r1.reservationId].status, 'settled');
  assert.strictEqual(lg.reservations[r2.reservationId].status, 'released');
  return '两个处置出口闭环完整，账务清晰';
});
t('B15 账本不变量：reservedCNY 恒等于 Σ(reserved 预留)；损坏台账被下一次操作自愈', async () => {
  const ledgerPath = path.join(tmpDir(), 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 100, output: 100 } } };
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing });
  const r1 = await guard.reserve('m', { brief_id: 'b15-1' });
  const r2 = await guard.reserve('m', { brief_id: 'b15-2' });
  await guard.release({ reservationId: r1.reservationId });
  let lg = await guard.getLedger();
  const sum = Object.keys(lg.reservations).filter(id => lg.reservations[id].status === 'reserved')
    .reduce((acc, id) => acc + lg.reservations[id].estimate, 0);
  assert.strictEqual(lg.reservedCNY, Math.round(sum * 1e6) / 1e6, '不变量被破坏');
  // 手写损坏台账（reservedCNY 漂移）→ 下一次操作按状态机重算自愈
  lg.reservedCNY = 999.99;
  fs.writeFileSync(ledgerPath, JSON.stringify(lg, null, 2));
  const r3 = await guard.reserve('m', { brief_id: 'b15-3' });
  assert.strictEqual(r3.ok, true);
  lg = await guard.getLedger();
  const sum2 = Object.keys(lg.reservations).filter(id => lg.reservations[id].status === 'reserved')
    .reduce((acc, id) => acc + lg.reservations[id].estimate, 0);
  assert.strictEqual(lg.reservedCNY, Math.round(sum2 * 1e6) / 1e6, '漂移未被重算修复');
  return '不变量成立，漂移自愈（重算制）';
});
t('B16 异常并发压力：8 路混合随机操作后账本不变量与预算上限全部成立', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(dir, 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 100, output: 100 } } };   // 单次核销 0.8 元
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing });
  async function worker(id) {
    let settled = 0, released = 0, rejected = 0, held = 0;
    for (let i = 0; i < 10; i++) {
      const res = await guard.reserve('m', { worker: id, iter: i });
      if (!res.ok) { rejected++; continue; }
      const op = Math.random();
      if (op < 0.6) {
        const s = await guard.settle({ reservationId: res.reservationId, usage: { prompt_tokens: 6000, completion_tokens: 2000 } });
        if (s.settled) settled++; else if (s.held) held++;
      } else if (op < 0.8) {
        const rr = await guard.release({ reservationId: res.reservationId });
        if (rr.ok) released++; else rejected++;
      } else {
        const h = await guard.hold({ reservationId: res.reservationId, reason: '压力测试' });
        if (h.ok) held++;
        await guard.resolveHold({ reservationId: res.reservationId, resolution: 'released', resolvedBy: 'stress' });
      }
    }
    return { settled, released, rejected, held };
  }
  const out = await Promise.all(Array.from({ length: 8 }, (_, i) => worker('w' + i)));
  const lg = await guard.getLedger();
  // 不变量 1：总核销 ≤ 预算上限
  assert.ok(lg.totalSpentCNY <= 22 + 1e-9, '突破总预算: ' + lg.totalSpentCNY);
  // 不变量 2：reservedCNY = Σ(reserved 状态预留)
  const sum = Object.keys(lg.reservations).filter(id => lg.reservations[id].status === 'reserved')
    .reduce((acc, id) => acc + lg.reservations[id].estimate, 0);
  assert.strictEqual(lg.reservedCNY, Math.round(sum * 1e6) / 1e6, '不变量破坏: ' + lg.reservedCNY + ' ≠ ' + sum);
  // 不变量 3：无负值
  assert.ok(lg.reservedCNY >= 0 && lg.totalSpentCNY >= 0, '出现负值');
  const stat = out.reduce((acc, w) => ({ s: acc.s + w.settled, r: acc.r + w.released, rej: acc.rej + w.rejected, h: acc.h + w.held }),
                           { s: 0, r: 0, rej: 0, h: 0 });
  return '8 路并发 ' + (stat.s + stat.r + stat.rej + stat.h) + ' 次操作（settled ' + stat.s + ' / released ' + stat.r +
         ' / rejected ' + stat.rej + ' / held ' + stat.h + '），账本一致性成立';
});

/* ===== X 跨进程预算竞争（独立 Node 子进程）===== */
t('X1 跨进程预算竞争：两个独立 Node 子进程共享台账，总核销不破 22 元', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(dir, 'ledger.json');
  const budgetPath = path.join(__dirname, 'budget.js');
  const pricingPath = path.join(__dirname, 'pricing.json');
  // 子进程循环：reserve → settle（usage 与上限一致，单次 0.0104 元）→ 直到预算耗尽或被拒
  const workerCode = `
    const { createBudgetGuard } = require(${JSON.stringify(budgetPath)});
    const guard = createBudgetGuard({
      ledgerPath: ${JSON.stringify(ledgerPath)},
      capCNY: 22,
      pricing: { perMillionTokens: { 'glm-5.3-flash': { input: 0.8, output: 2.8 } } }
    });
    let settled = 0, rejected = 0, lastReason = null;
    (async () => {
      for (;;) {
        const r = await guard.reserve('glm-5.3-flash', { worker: process.pid });
        if (!r.ok) { rejected++; lastReason = r.reason.slice(0, 60); break; }
        const s = await guard.settle({ reservationId: r.reservationId, usage: { prompt_tokens: 6000, completion_tokens: 2000 } });
        if (!s.settled) { lastReason = s.reason.slice(0, 60); break; }
        settled++;
        if (settled > 5000) break;   // 保险丝
      }
      process.stdout.write(JSON.stringify({ pid: process.pid, settled, rejected, lastReason }));
    })().catch(e => { process.stdout.write(JSON.stringify({ pid: process.pid, fatal: e.message })); });
  `;
  const runWorker = () => new Promise(resolve => {
    const p = spawn(process.execPath, ['-e', workerCode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += '\n[stderr] ' + d; });
    p.on('exit', () => {
      try { resolve(JSON.parse(out.trim().split('\n').pop())); }
      catch (e) { resolve({ fatal: 'parse failed: ' + out.slice(0, 200) }); }
    });
  });
  const [w1, w2] = await Promise.all([runWorker(), runWorker()]);
  const guard = createBudgetGuard({ ledgerPath, capCNY: 22, pricing: loadPricing(path.join(__dirname, 'pricing.json')) });
  const lg = await guard.getLedger();
  const totalSettled = w1.settled + w2.settled;
  if (w1.fatal || w2.fatal) throw new Error('子进程异常: ' + (w1.fatal || '') + (w2.fatal || ''));
  assert.strictEqual(lg.reservedCNY, 0, '结束后应无残留预留');
  assert.strictEqual((lg.holds || []).length, 0, '不应有 hold');
  assert.ok(lg.totalSpentCNY <= 22 + 1e-9, '跨进程突破总预算：' + lg.totalSpentCNY + ' 元');
  assert.ok(totalSettled >= 1, '两进程合计核销 ' + totalSettled + ' 次');
  // 台账一致性：SETTLE 条目数 = 核销次数
  const settleEntries = lg.entries.filter(e => e.type === 'SETTLE').length;
  assert.strictEqual(settleEntries, totalSettled, 'SETTLE 条目数与核销次数不一致');
  // 无重复预留：reservation ID 全局唯一，RESERVE 条目数 = 预留次数 = 台账状态机条目数
  const reserveEntries = lg.entries.filter(e => e.type === 'RESERVE');
  const ids = reserveEntries.map(e => e.reservationId);
  assert.strictEqual(new Set(ids).size, ids.length, '存在重复 reservationId（重复预留）');
  assert.strictEqual(Object.keys(lg.reservations).length, ids.length, '状态机条目数与 RESERVE 条目数不一致');
  // 全部预留都有终态（settled/released），无卡在 reserved/held 的残留
  for (const id of Object.keys(lg.reservations)) {
    assert.ok(['settled', 'released'].includes(lg.reservations[id].status), '残留非终态预留 ' + id + ': ' + lg.reservations[id].status);
  }
  return '两进程合计核销 ' + totalSettled + ' 笔 / ' + lg.totalSpentCNY + ' 元（上限 22 元），无重复预留、无残留预留';
});
t('X2 跨进程：陈旧锁回收不误删其他存活进程持有的锁（stale 但持有者存活 → 不回收）', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(dir, 'ledger.json');
  // 锁：owner = 父进程（存活）+ 陈旧 mtime——子进程走回收路径时必须因「持有者存活」而放弃回收
  const lockPath = ledgerPath + '.lock';
  const fd = fs.openSync(lockPath, 'wx');
  fs.writeFileSync(fd, JSON.stringify({ owner: process.pid + '-parent-still-alive', ts: Date.now() }));
  fs.closeSync(fd);
  fs.utimesSync(lockPath, Date.now() / 1000 - 60000, Date.now() / 1000 - 60000);   // 陈旧化
  // 子进程尝试获取（lockTimeoutMs 500 → 因持有者存活不回收 → 超时退出）
  const childCode = `
    const { createBudgetGuard } = require(${JSON.stringify(path.join(__dirname, 'budget.js'))});
    const guard = createBudgetGuard({ ledgerPath: ${JSON.stringify(ledgerPath)}, capCNY: 22, lockTimeoutMs: 500 });
    (async () => {
      try { await guard.getLedger(); process.stdout.write(JSON.stringify({ timeout: false })); }
      catch (e) { process.stdout.write(JSON.stringify({ timeout: String(e.message).includes('BUDGET_LOCK_TIMEOUT'), owner: (String(e.message).match(/占用者: ([^）]+)/) || [])[1] || null })); }
    })();
  `;
  const childOut = await new Promise(resolve => {
    const p = spawn(process.execPath, ['-e', childCode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('exit', () => resolve(out.trim()));
  });
  const child = JSON.parse(childOut);
  assert.strictEqual(child.timeout, true, '子进程未按超时退出: ' + childOut);
  // 关键断言：子进程超时后，父进程的锁仍完好（未被误删）
  assert.strictEqual(fs.existsSync(lockPath), true, '存活进程的锁被子进程误删');
  const still = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.strictEqual(still.owner, process.pid + '-parent-still-alive', '锁所有权被篡改');
  fs.unlinkSync(lockPath);   // 测试清理
  return '陈旧锁回收未误删存活进程的锁（owner: ' + still.owner + '）';
});
t('B17 held 金额计入预算占用：hold 后占用不释放，账务处置后才转移', async () => {
  const dir = tmpDir();
  const ledgerPath = path.join(dir, 'ledger.json');
  const pricing = { perMillionTokens: { m: { input: 100, output: 100 } } };   // 单次预留 0.8 元
  const guard = createBudgetGuard({ ledgerPath, capCNY: 1.5, pricing });      // cap 1.5：hold 后剩余 0.7 < 0.8
  const res = await guard.reserve('m', { brief_id: 'b17' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual((await guard.getLedger()).reservedCNY, 0.8);
  await guard.hold({ reservationId: res.reservationId, reason: '测试：请求结果不确定' });
  // 核心断言：hold 后 held 金额仍计入预算占用（reservedCNY 不因转 held 而释放）
  const during = await guard.getLedger();
  assert.strictEqual(during.reservedCNY, 0.8, 'held 金额掉出预算占用（0.0104 元事故的回归测试）');
  // 占用中：新请求被未解决 hold 阻塞（曦指令 3 语义优先于预算计算；B1 已单独覆盖 INSUFFICIENT_BUDGET 路径）
  const blocked = await guard.reserve('m', { brief_id: 'b17-2' });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason.startsWith('HOLD_UNRESOLVED'), true, '未解决 hold 未阻塞新请求: ' + blocked.reason);
  // 人工账务处置 settled：占用转为已核销
  const r = await guard.resolveHold({ reservationId: res.reservationId, resolution: 'settled',
                                      usage: { prompt_tokens: 6000, completion_tokens: 2000 }, resolvedBy: 'manual-曦' });
  assert.strictEqual(r.ok && r.costCNY === 0.8, true);
  const lg = await guard.getLedger();
  assert.strictEqual(lg.totalSpentCNY, 0.8, '处置后未转入已核销');
  assert.strictEqual(lg.reservedCNY, 0, '处置后占用未清零');
  return 'hold 占用 0.8 元保持 → settled 处置后转为已核销（总 0.8 元），期间新预留被拒';
});

/* ===== PK 纯数据组装器 ===== */
t('PK1 合法候选 → 产品数据包：纯 JSON 文本、round-trip 一致、元数据可追溯', async () => {
  const cand = validEnvelope('组装测试');
  const r = packageCandidate(cand, { briefId: 'b1', model: 'glm-5.3-flash', promptVersion: 'g1-prompt/0.1.0', archiveRefs: ['archives/b1/001.json'] });
  assert.strictEqual(r.ok, true);
  const p = r.product;
  assert.strictEqual(p.format, 'grid-puzzle-product/0.1');
  assert.ok(p.dataJson.trimStart().startsWith('{'), 'dataJson 必须是纯 JSON（无 JS 包装）');
  assert.deepStrictEqual(JSON.parse(p.dataJson), cand, 'JSON 往返不一致');
  assert.strictEqual(p.integrity.roundTripOk, true);
  assert.strictEqual(p.meta.brief_id, 'b1');
  assert.strictEqual(p.meta.prompt_version, 'g1-prompt/0.1.0');
});
t('PK2 组装器是最后一道闸门：未过 Schema 的候选拒绝封装', async () => {
  const bad = validEnvelope(); bad.mechanic.enter = [{ when: 'true', effects: [{ op: 'nuke' }] }];
  const r = packageCandidate(bad, { briefId: 'x' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'UNKNOWN_OP'));
});
t('PK3 产品包不含可执行包装（无 window.x = / 无 function 关键字包裹数据）', () => {
  const r = packageCandidate(validEnvelope(), { briefId: 'x' });
  const s = r.product.dataJson;
  assert.ok(!s.includes('window.'), 'dataJson 含 window 包装');
  assert.ok(!/^function/.test(s.trimStart()), 'dataJson 以 function 开头');
});

/* ===== 汇总 ===== */
(async () => {
  const queue = testQueue.slice();
  for (const { name, fn } of queue) {
    try { const d = await fn(); results.push({ name, ok: true, detail: d }); }
    catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  const done = results.filter(r => r.ok).length, fail = results.length - done;
  console.log('=== G1 M2 闭环测试（拦截-有限重试 + 金额硬闸门 v3 + 纯数据组装器）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? (r.detail ? '  → ' + r.detail : '') : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + done + ' / 失败 ' + fail + ' / 共 ' + results.length + ' ===');
  process.exit(fail ? 1 : 0);
})();
