'use strict';
/* G1 M1 · 单元测试（全部 mock 传输，零网络、零密钥依赖）
   覆盖：Prompt 不变量（原语词汇 / 无玩法先例 / JSON-only 约束）、
   适配器成功与失败路径、档案完整性、密钥不入档、无密钥不发起调用。
*/
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROMPT_VERSION, SYSTEM_PROMPT, buildMessages } = require('./prompts/prompt-v1');
const { createArchiver } = require('./archive');
const { execute, extractJsonText } = require('./model-adapter');

const results = [];
const testQueue = [];
function t(name, fn) { testQueue.push({ name, fn }); }

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g1-m1-'));
}

function validEnvelope(title) {
  return {
    dsl_version: 'grid-puzzle/0.1',
    mechanic: { dsl: 'grid-puzzle/0.1', title: title || '测试游戏', win: 'px()==1', status: '{px()}' },
    levels: [{ name: 'L1', map: ['###', '#1#', '###'].map(r => r), player: { x: 1, y: 1 }, dynamic: [] }]
  };
}

function mockHttp(envelopeLike, usage) {
  const content = typeof envelopeLike === 'string' ? envelopeLike : '```json\n' + JSON.stringify(envelopeLike, null, 1) + '\n```';
  return async () => ({
    status: 200,
    body: JSON.stringify({ choices: [{ message: { content } }], usage: usage || { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } })
  });
}

/* ===== P Prompt 不变量 ===== */
t('P1 Prompt 含全部 9 种效果 op 词汇', () => {
  for (const op of ['var.add', 'var.sub', 'prop.set', 'prop.add', 'prop.sub', 'pit', 'fx', 'log', 'shake']) {
    assert.ok(SYSTEM_PROMPT.includes('"' + op + '"'), '缺 ' + op);
  }
});
t('P2 Prompt 含全部 12 个内建函数', () => {
  for (const fn of ['tile(x,y)', 'px()', 'py()', 'tx()', 'ty()', 'tchar()', 'prop(x,y,k)', 'v(k)', 'count_tile(c)', 'count_entity(t)', 'count_on(t,c)', 'count_prop(k,min)']) {
    assert.ok(SYSTEM_PROMPT.includes(fn), '缺 ' + fn);
  }
});
t('P3 Prompt 不含 A/B/C/D 玩法先例词（生成≠匹配红线）', () => {
  for (const w of ['推箱', '钥匙', '碎裂', '闸门', '箱子', '开关闸', '拾取开门']) {
    assert.ok(!SYSTEM_PROMPT.includes(w), '出现玩法先例词: ' + w);
  }
});
t('P4 Prompt 强制 JSON-only 输出（禁止围栏/解释/注释）', () => {
  assert.ok(SYSTEM_PROMPT.includes('只输出一个 JSON 信封'));
  assert.ok(SYSTEM_PROMPT.includes('禁止输出：markdown 代码围栏、解释文字、注释'));
});
t('P5 Prompt 输出骨架为纯结构（无玩法语义内容）', () => {
  const m = SYSTEM_PROMPT.match(/\{[\s\S]*"dsl_version"[\s\S]*\}/);
  assert.ok(m, '未找到结构骨架');
  assert.ok(m[0].includes('（游戏名）') || m[0].includes('（胜利条件表达式）'), '骨架应为占位符示意');
  assert.ok(!m[0].includes('推箱') && !m[0].includes('钥匙'), '骨架含玩法语义');
});
t('P6 buildMessages 结构正确且含用户 Brief', () => {
  const msgs = buildMessages('做一个小游戏');
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, 'system');
  assert.strictEqual(msgs[1].role, 'user');
  assert.ok(msgs[1].content.includes('做一个小游戏'));
  assert.strictEqual(PROMPT_VERSION, 'g1-prompt/0.1.0');
});

/* ===== A 适配器与档案 ===== */
t('A1 mock 成功路径：围栏 JSON 被剥离解析，candidate 结构合法', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 'b1' });
  const r = await execute({ brief: '做个游戏', briefId: 'b1', model: 'glm-5.3-flash', apiKey: 'test-key',
                            transport: mockHttp(validEnvelope()), archiver });
  assert.strictEqual(r.outcome, 'parsed');
  assert.ok(r.candidate && r.candidate.dsl_version === 'grid-puzzle/0.1');
  assert.ok(r.archive.full.raw_output.includes('choices'), '原始 HTTP 响应须入档');
  assert.strictEqual(r.archive.full.usage.total_tokens, 300, 'Token 用量须入档');
});
t('A2 纯 JSON（无围栏）输出同样解析', async () => {
  const dir = tmpDir();
  const r = await execute({ brief: 'x', briefId: 'b2', model: 'm', apiKey: 'k',
                            transport: mockHttp(JSON.stringify(validEnvelope('纯JSON'))), archiver: createArchiver({ dir, briefId: 'b2' }) });
  assert.strictEqual(r.outcome, 'parsed');
  assert.strictEqual(r.candidate.mechanic.title, '纯JSON');
});
t('A3 非 JSON 输出：parse_failed，档案留痕，candidate 为空', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 'b3' });
  const r = await execute({ brief: 'x', briefId: 'b3', model: 'm', apiKey: 'k', transport: mockHttp('抱歉，我无法输出 JSON。'), archiver });
  assert.strictEqual(r.outcome, 'parse_failed');
  assert.strictEqual(r.candidate, null);
  assert.strictEqual(archiver.list().length, 1, '失败调用也必须留档');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(archiver.briefDir, archiver.list()[0]), 'utf8')).outcome, 'parse_failed');
});
t('A4 结构非法输出：contract_failed 并留痕', async () => {
  const dir = tmpDir();
  const bad = validEnvelope(); bad.levels = 'not-an-array';
  const r = await execute({ brief: 'x', briefId: 'b4', model: 'm', apiKey: 'k',
                            transport: mockHttp(bad), archiver: createArchiver({ dir, briefId: 'b4' }) });
  assert.strictEqual(r.outcome, 'contract_failed');
});
t('A5 HTTP 非 200：http_error 留痕', async () => {
  const dir = tmpDir();
  const r = await execute({ brief: 'x', briefId: 'b5', model: 'm', apiKey: 'k',
                            transport: async () => ({ status: 500, body: 'server error' }),
                            archiver: createArchiver({ dir, briefId: 'b5' }) });
  assert.strictEqual(r.outcome, 'http_error');
  assert.strictEqual(r.archive.full.http_status, 500);
});
t('A6 传输异常（网络层）：留痕', async () => {
  const dir = tmpDir();
  const r = await execute({ brief: 'x', briefId: 'b6', model: 'm', apiKey: 'k',
                            transport: async () => { throw new Error('ECONNREFUSED'); },
                            archiver: createArchiver({ dir, briefId: 'b6' }) });
  assert.strictEqual(r.outcome, 'http_error');
  assert.ok(r.error.includes('ECONNREFUSED'));
});
t('A7 无密钥：不发起调用、不留调用档案、留 no_api_key 诊断事件', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 'b7' });
  delete process.env.ZHIPU_API_KEY;
  let netCalls = 0;
  const r = await execute({ brief: 'x', briefId: 'b7', model: 'm',
                            transport: async () => { netCalls++; return { status: 200, body: '{}' }; },
                            archiver });
  assert.strictEqual(r.outcome, 'no_api_key');
  assert.strictEqual(netCalls, 0, '无密钥却发起了网络调用');
  assert.strictEqual(archiver.list().length, 0, '调用未发生，不应有调用档案');
  const diagFile = r.archive.diagnostic;
  assert.ok(diagFile && fs.existsSync(diagFile), '应留下 no_api_key 诊断事件');
  const diag = JSON.parse(fs.readFileSync(diagFile, 'utf8'));
  assert.strictEqual(diag.event, 'no_api_key');
  assert.strictEqual(JSON.stringify(diag).includes('test-key'), false, '诊断事件不得含密钥材料');
});
t('A12 诊断事件独立于调用档案目录（archives/_diagnostics/）', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 'b12' });
  delete process.env.ZHIPU_API_KEY;
  await execute({ brief: 'x', briefId: 'b12', model: 'm', archiver });
  assert.ok(fs.existsSync(path.join(dir, '_diagnostics')), '诊断区不存在');
  assert.strictEqual(archiver.list().length, 0);
});
t('A8 两次调用产生两份档案（档案计数）', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 'b8' });
  await execute({ brief: 'x', briefId: 'b8', model: 'm', apiKey: 'k', transport: mockHttp(validEnvelope()), archiver });
  await execute({ brief: 'x', briefId: 'b8', model: 'm', apiKey: 'k', transport: mockHttp(validEnvelope()), archiver });
  assert.strictEqual(archiver.list().length, 2);
});
t('A9 密钥绝不入档（全档案扫描）', async () => {
  const dir = tmpDir();
  const archiver = createArchiver({ dir, briefId: 'b9' });
  const SECRET = 'super-secret-key-do-not-leak';
  await execute({ brief: 'x', briefId: 'b9', model: 'm', apiKey: SECRET, transport: mockHttp(validEnvelope()), archiver });
  for (const f of archiver.list()) {
    const text = fs.readFileSync(path.join(archiver.briefDir, f), 'utf8');
    assert.ok(!text.includes(SECRET), '密钥泄漏进档案: ' + f);
  }
});
t('A10 档案字段完整性（brief/model/prompt_version/raw/usage/outcome）', async () => {
  const dir = tmpDir();
  const r = await execute({ brief: '我的Brief', briefId: 'b10', model: 'glm-4.7', apiKey: 'k',
                            transport: mockHttp(validEnvelope()), archiver: createArchiver({ dir, briefId: 'b10' }) });
  const e = r.archive.full;
  for (const k of ['brief', 'brief_id', 'model', 'prompt_version', 'request', 'raw_output', 'usage', 'outcome', 'latency_ms', 'archived_at']) {
    assert.ok(k in e, '档案缺字段: ' + k);
  }
  assert.strictEqual(e.prompt_version, 'g1-prompt/0.1.0');
  assert.strictEqual(e.model, 'glm-4.7');
});
t('A11 extractJsonText：围栏剥离与原样直通', () => {
  assert.strictEqual(extractJsonText('```json\n{"a":1}\n```'), '{"a":1}');
  assert.strictEqual(extractJsonText('{"a":2}'), '{"a":2}');
});

/* ===== 汇总 ===== */
(async () => {
  const queue = testQueue.slice();
  for (const { name, fn } of queue) {
    try { const d = await fn(); results.push({ name, ok: true, detail: d }); }
    catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  const done = results.filter(r => r.ok).length, fail = results.length - done;
  console.log('=== G1 M1 单元测试（mock 传输，零网络）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + done + ' / 失败 ' + fail + ' / 共 ' + results.length + ' ===');
  process.exit(fail ? 1 : 0);
})();
