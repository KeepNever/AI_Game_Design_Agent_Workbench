'use strict';
/* M0 安全测试（两类判据，曦审阅口径）：
   A 非法数据拦截——结构非法/污染尝试/越限，一律拒绝；
   B 合法文本惰性展示——合法字段里的可疑字符串不拒绝，展示层转义惰性化；
   C 通信与隔离——双向消息白名单、来源校验、iframe sandbox、CSP、纯 JSON 数据通道。
   全部通过前，任何生成产物不得运行（曦硬前置）。
*/
const assert = require('assert');
const { SecurityError, secureParse } = require('./strict-json');
const { checkEnvelope } = require('./data-guard');
const { serializeData, buildGamePage, buildHostPage, escapeHtml, GAME_CSP, HOST_CSP } = require('./assemble');
const { validateMessage } = require('./postmessage-guard');
const { readJsonCapped, MAX_BYTES } = require('./json-fetch');
const { TextEncoder, TextDecoder } = require('util');

const results = [];
const testQueue = [];
async function t(name, fn) { testQueue.push({ name, fn }); }
function expectSecurity(fn, code) {
  try { fn(); } catch (e) {
    if (e instanceof SecurityError) { assert.strictEqual(e.code, code); return; }
    throw e;
  }
  throw new Error('预期 SecurityError(' + code + ') 未抛出');
}

function sample(text) {
  return {
    dsl_version: 'grid-puzzle/0.1',
    mechanic: { dsl: 'grid-puzzle/0.1', title: text, win: "px()==1", status: '{v(\'m\')}' },
    levels: [{ name: 'L1', map: ['###', '#.#', '###'], player: { x: 1, y: 1 }, dynamic: [] }]
  };
}

/* ===== A 非法数据拦截 ===== */
t('A1 非 JSON 文本拒绝（JS 代码串）', () => {
  expectSecurity(() => secureParse('alert(1); {"a":1}'), 'INVALID_JSON');
});
t('A2 __proto__ 键拒绝', () => {
  expectSecurity(() => secureParse('{"mechanic":{"__proto__":{"x":1}}}'), 'FORBIDDEN_KEY');
});
t('A3 constructor 键拒绝', () => {
  expectSecurity(() => secureParse('{"constructor":{"prototype":{}}}'), 'FORBIDDEN_KEY');
});
t('A4 超大 payload 拒绝', () => {
  expectSecurity(() => secureParse('{"a":"' + 'x'.repeat(300 * 1024) + '"}'), 'PAYLOAD_TOO_LARGE');
});
t('A5 数组根拒绝（信封必须为对象）', () => {
  expectSecurity(() => checkEnvelope(secureParse('[1,2,3]')), 'BAD_ENVELOPE');
});
t('A6 未知信封键拒绝', () => {
  expectSecurity(() => checkEnvelope(secureParse(JSON.stringify(Object.assign(sample('t'), { evil: 1 })))), 'UNKNOWN_ENVELOPE_KEY');
});
t('A7 DSL 版本不符拒绝', () => {
  const s = sample('t'); s.dsl_version = 'grid-puzzle/9.9';
  expectSecurity(() => checkEnvelope(secureParse(JSON.stringify(s))), 'BAD_DSL_VERSION');
});
t('A8 map 行非字符串拒绝', () => {
  const s = sample('t'); s.levels[0].map[1] = { evil: true };
  expectSecurity(() => checkEnvelope(secureParse(JSON.stringify(s))), 'BAD_MAP_ROW');
});
t('A9 嵌套深度超限拒绝', () => {
  const s = sample('t'); let d = s.levels[0]; d.deep = {};
  d = d.deep; for (let i = 0; i < 100; i++) { d.n = {}; d = d.n; }
  expectSecurity(() => checkEnvelope(secureParse(JSON.stringify(s))), 'DEPTH_TOO_DEEP');
});
t('A10 数据文件为纯 JSON（无 JS 包装语句，防脚本化）', () => {
  const text = serializeData(sample('t'));
  assert.ok(text.trimStart().startsWith('{'), '数据文件不应有 window.x = 等 JS 包装');
  assert.deepStrictEqual(JSON.parse(text), sample('t'), 'JSON 往返不一致');
});

/* ===== B 合法文本惰性展示 ===== */
t('B1 合法字段含 <script> 文本：不拒绝（数据层放行）', () => {
  assert.strictEqual(checkEnvelope(sample('<script>alert(1)</script>')), true);
});
t('B2 敌意标题经 JSON 往返后原样保留（数据完整性），展示由 textContent 惰性化', () => {
  const s = sample('<script>alert(1)</script>');
  const back = JSON.parse(serializeData(s));
  assert.strictEqual(back.mechanic.title, '<script>alert(1)</script>');
});
t('B3 HTML 文本经 escapeHtml 后惰性展示', () => {
  const out = escapeHtml('<img src=x onerror=alert(1)>');
  assert.ok(out.includes('&lt;img') && !out.includes('<img'));
});
t('B4 emoji/unicode 正常通过', () => {
  const s = sample('🎮 闯关 ✨');
  assert.strictEqual(checkEnvelope(s), true);
  assert.ok(JSON.parse(serializeData(s)).mechanic.title.includes('🎮'));
});
t('B5 U+2028 经 JSON 往返保留（fetch+res.json() 不经 JS 求值，无注入面）', () => {
  const back = JSON.parse(serializeData(sample('a\u2028b')));
  assert.strictEqual(back.mechanic.title, 'a\u2028b');
});

/* ===== C 通信与隔离 ===== */
t('C1 gameToHost 未知类型丢弃', () => {
  assert.deepStrictEqual(validateMessage('gameToHost', { data: { type: 'evil:exec' } }, null), { ok: false, reason: 'UNKNOWN_TYPE' });
});
t('C2 未知字段丢弃', () => {
  const r = validateMessage('gameToHost', { data: { type: 'game:log', msg: 'hi', exec: 'payload' } }, null);
  assert.ok(!r.ok && r.reason === 'UNKNOWN_FIELD:exec');
});
t('C3 字段类型错误丢弃', () => {
  const r = validateMessage('gameToHost', { data: { type: 'game:state', level: '1', moves: 2 } }, null);
  assert.ok(!r.ok && r.reason === 'BAD_FIELD:level');
});
t('C4 非对象消息丢弃', () => {
  assert.ok(!validateMessage('gameToHost', { data: 'win()' }, null).ok);
  assert.ok(!validateMessage('gameToHost', { data: null }, null).ok);
  assert.ok(!validateMessage('gameToHost', { data: [1] }, null).ok);
});
t('C5 来源不匹配丢弃', () => {
  const r = validateMessage('gameToHost', { data: { type: 'game:win' }, source: { fake: 1 } }, { real: 2 });
  assert.ok(!r.ok && r.reason === 'SOURCE_MISMATCH');
});
t('C6 gameToHost 合法消息通过', () => {
  const r = validateMessage('gameToHost', { data: { type: 'game:log', msg: '拿到钥匙' } }, null);
  assert.ok(r.ok && r.type === 'game:log');
});
t('C7 hostToGame pipeline:data 合法通过', () => {
  const r = validateMessage('hostToGame', { data: { type: 'pipeline:data', data: sample('t') } }, null);
  assert.ok(r.ok && r.type === 'pipeline:data');
});
t('C8 pipeline:data 的 data 字段非对象拒绝', () => {
  expectSecurity.never; // 占位无操作
  const r1 = validateMessage('hostToGame', { data: { type: 'pipeline:data', data: 'alert(1)' } }, null);
  const r2 = validateMessage('hostToGame', { data: { type: 'pipeline:data' } }, null);
  assert.ok(!r1.ok && r1.reason === 'BAD_FIELD:data');
  assert.ok(!r2.ok && r2.reason === 'BAD_FIELD:data');
});
t('C9 方向错配拒绝（游戏帧脚本不收 game:log 方向）', () => {
  const r = validateMessage('hostToGame', { data: { type: 'game:log', msg: 'x' } }, null);
  assert.ok(!r.ok && r.reason === 'UNKNOWN_TYPE');
});
t('C10 宿主页 iframe：sandbox=allow-scripts 且无 allow-same-origin', () => {
  const host = buildHostPage('/play/g1', ['/engine/postmessage-guard.js', '/engine/json-fetch.js', '/engine/host-bootstrap.js']);
  assert.ok(host.includes('sandbox="allow-scripts"'));
  assert.ok(!host.includes('allow-same-origin'));
  assert.ok(host.includes('postmessage-guard.js') && host.includes('json-fetch.js'), '宿主必须加载消息守卫与受限拉取');
});
t('C11 游戏页：脚本全部为 src 引用，无内联脚本、无生成数据脚本', () => {
  const page = buildGamePage(['/engine/strict-json.js', '/engine/data-guard.js', '/engine/postmessage-guard.js', '/engine/game-bootstrap.js'], []);
  const tags = page.match(/<script[^>]*>/g) || [];
  assert.ok(tags.length > 0, '应有固定脚本');
  tags.forEach(tag => assert.ok(/src="/.test(tag), '存在内联脚本块：' + tag));
  assert.ok(!page.includes('alert'), '游戏页模板含可疑内容');
  assert.ok(!page.includes('__GAME_DATA'), '不得再以脚本形式注入生成数据');
});
t('C12 游戏页 CSP：script-src self 且 connect-src none（禁外联），无 unsafe-eval/inline', () => {
  assert.ok(GAME_CSP.includes("script-src 'self'"));
  assert.ok(GAME_CSP.includes("connect-src 'none'"));
  assert.ok(!GAME_CSP.includes('unsafe-eval') && !GAME_CSP.includes("script-src 'unsafe-inline'"));
});
t('C13 宿主 CSP：connect-src self（仅本地 fetch），script-src self', () => {
  assert.ok(HOST_CSP.includes("connect-src 'self'"));
  assert.ok(HOST_CSP.includes("script-src 'self'"));
  assert.ok(!HOST_CSP.includes('unsafe-eval'));
});

/* ===== D 受限 JSON 拉取（大小限制先于解析，曦审阅口径 2）===== */
function fakeResponse(chunks, headers) {
  const enc = new TextEncoder();
  let i = 0, reads = 0, cancelled = false;
  const body = {
    getReader() {
      return {
        read() {
          reads++;
          return i < chunks.length
            ? Promise.resolve({ done: false, value: enc.encode(chunks[i++]) })
            : Promise.resolve({ done: true });
        },
        cancel() { cancelled = true; }
      };
    }
  };
  return { body, headers: { get: k => (headers && headers[k.toLowerCase()]) || null }, _state: { get reads() { return reads; }, get cancelled() { return cancelled; } } };
}

t('D1 正常小 JSON 经受限拉取正确解析', async () => {
  const res = fakeResponse([JSON.stringify(sample('正常'))], {});
  const out = await readJsonCapped(res, MAX_BYTES);
  assert.strictEqual(out.mechanic.title, '正常');
  assert.strictEqual(res._state.cancelled, false);
});
t('D2 超限流在解析前中止（错误为 PAYLOAD_TOO_LARGE 而非 INVALID_JSON——证明限制先于解析）', async () => {
  // 300KB 且故意不闭合的 JSON：若限制失效、先解析，会得到 INVALID_JSON 而非 PAYLOAD_TOO_LARGE
  const res = fakeResponse(['{"a":"', 'x'.repeat(150 * 1024), 'x'.repeat(150 * 1024)], {});
  let err;
  try { await readJsonCapped(res, MAX_BYTES); } catch (e) { err = e; }
  assert.ok(err && err.code === 'PAYLOAD_TOO_LARGE', '实际: ' + (err && err.message));
  assert.strictEqual(res._state.cancelled, true, '流未被取消');
});
t('D3 Content-Length 头超限：不读 body 直接拒绝', async () => {
  const res = fakeResponse(['{"a":1}'], { 'content-length': String(300 * 1024) });
  let err;
  try { await readJsonCapped(res, MAX_BYTES); } catch (e) { err = e; }
  assert.ok(err && err.code === 'PAYLOAD_TOO_LARGE');
  assert.strictEqual(res._state.reads, 0, 'body 被读取了 ' + res._state.reads + ' 次');
});

/* ===== 汇总 ===== */
(async () => {
  const queue = testQueue.slice();          // t() 在定义期注册，runner 在此统一执行
  for (const { name, fn } of queue) {
    try { const detail = await fn(); results.push({ name, ok: true, detail }); }
    catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  const done = results.filter(r => r.ok).length, fail = results.length - done;
  console.log('=== M0 安全测试（Node 单元层）===');
  results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : '  ← ' + r.err)));
  console.log('=== 结果：通过 ' + done + ' / 失败 ' + fail + ' / 共 ' + results.length + ' ===');
  process.exit(fail ? 1 : 0);
})();
