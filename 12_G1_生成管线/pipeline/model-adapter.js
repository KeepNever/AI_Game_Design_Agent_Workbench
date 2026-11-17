'use strict';
/* G1 M1 · 模型适配层（GLM · 智谱官方 API）
   职责：Brief → 模型调用 → 原始输出 → 严格解析 → 安全级契约守卫 → 候选 JSON 信封。
   约束（曦八条要求第 3/6 条）：
   - 智谱官方 API（open.bigmodel.cn）；密钥只从环境变量/受保护配置读取，绝不入档
   - 每一次调用及失败、重试都自动留档（含 HTTP 错误与解析失败）
   - 本层只产出候选 JSON 数据；绝不执行生成产物（执行属 M3，且须 M0+M2 双闸门）
   传输可注入（transport）——单测用 mock，不触网络。
*/
const { secureParse, SecurityError } = require('../security/strict-json');
const { checkEnvelope } = require('../security/data-guard');
const { buildMessages, PROMPT_VERSION } = require('./prompts/prompt-v1');

const ZHIPU_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

function defaultTransport(payload, apiKey) {
  // Node 22 全局 fetch；密钥只在此处使用，不出本函数作用域。
  // sent 标志（transport 契约 v2）：true = 请求已发出（响应可能丢失/超时——结果不确定）；
  // false = 确定未送达（连接期失败）。无法判断时保守按 true 处理。
  return fetch(ZHIPU_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(payload)
  }).then(async res => ({ status: res.status, body: await res.text(), sent: true }))
    .catch(e => {
      const code = (e.cause && e.cause.code) || e.code || '';
      const definitelyNotSent = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code);
      return { status: 0, body: String(e.message), sent: definitelyNotSent ? false : true, transportError: true };
    });
}

// 从模型输出提取 JSON 文本：剥离 ``` 围栏（若有），其余原样交给严格解析
function extractJsonText(raw) {
  let text = String(raw || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) text = fence[1].trim();
  return text;
}

function resolveApiKey(provided) {
  const key = provided !== undefined ? provided : process.env.ZHIPU_API_KEY;
  return key ? String(key) : null;
}

/* 输入 Token 保守上界估算（分字符类别，曦 2026-11-16 指令 2）
   构造性保守假设（各系数均 ≥ 公开 BPE 分词特性最坏情况）：
   - ASCII（英文/数字/JSON 结构符/特殊符号）≤ 1 token/字符——标点常为独立 token，取最坏上界；
   - CJK（中日韩表意区）≤ 2 tokens/字符——实际 GLM ≈1 token/汉字，取 2 倍富余；
   - 其他非 ASCII（emoji/符号扩展/ZWJ 序列）≤ 4 tokens/码点——ZWJ 合成序列最坏情况富余。
   性质：这是保守上界（估算 ≥ 真实 token 数），不是 tokenizer 精确计数；
   校准钩子：档案同时记录 estimate_tokens 与 usage.prompt_tokens，真实联调后据此校准系数。 */
function estimateInputTokensUpperBound(messages) {
  const text = messages.map(m => m.content).join('\n');
  let ascii = 0, cjk = 0, other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 128) ascii++;
    else if ((cp >= 0x2E80 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
             (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFF00 && cp <= 0xFFEF)) cjk++;
    else other++;
  }
  return ascii + cjk * 2 + other * 4;
}

/* execute({ brief, briefId, model, apiKey?, transport?, archiver, temperature?, feedback?,
             maxInputTokens?, maxOutputTokens? })
   返回 { outcome, candidate|null, raw, archive, error?, estimateTokens? }
   outcome: 'parsed' | 'contract_failed' | 'parse_failed' | 'http_error' | 'no_api_key' | 'prompt_too_large'
   输入 Token 预检性质（曦 2026-11-16 指令，重要口径）：
   - GLM 无官方公开 JS tokenizer，无法请求前精确计数——当前为【保守上界估算预检】，
     **不宣称严格 6000 Token 硬限制**；
   - 估算采用分字符类别上界（estimateInputTokensUpperBound，见下方说明），系数均不低于
     公开 BPE 特性最坏情况，并留 usage 实测校准钩子（档案同时记录 estimate_tokens 与
     usage.prompt_tokens，真实联调后据此校准；如获官方 tokenizer 再替换为精确计数）；
   - 输出仍为 API 侧硬限：payload.max_tokens = maxOutputTokens（严格约束）；
   - 档案携带 sent 标志（请求是否确实发出）供金额闸门区分 release / hold。
*/
async function execute(opts) {
  const transport = opts.transport || defaultTransport;
  const apiKey = resolveApiKey(opts.apiKey);
  const messages = buildMessages(opts.brief);
  // 诊断重试回喂：上一轮的校验错误清单作为追加用户消息进入上下文
  if (opts.feedback) messages.push({ role: 'user', content: String(opts.feedback) });
  const started = Date.now();
  const maxIn = opts.maxInputTokens || 6000;
  const maxOut = opts.maxOutputTokens || 2000;

  // 无密钥一律拒绝：无论传输通道为何，未配置密钥 = 不发起任何调用、不留调用档案；
  // 但留一份不含密钥的诊断事件，方便排查配置问题（曦 2026-11-13 建议）
  if (!apiKey) {
    const diagnostic = opts.archiver
      ? opts.archiver.diagnose({ event: 'no_api_key', model: opts.model, brief_id: opts.briefId,
                                 hint: '未配置智谱 API 密钥（环境变量 ZHIPU_API_KEY），调用未发生' })
      : null;
    return { outcome: 'no_api_key', candidate: null, raw: null, archive: { diagnostic },
             error: '未配置智谱 API 密钥（环境变量 ZHIPU_API_KEY）——本次调用未发生，不留调用档案' };
  }

  // 输入 Token 预检：优先精确计数（tokenizer 辅助进程，曦 2026-11-16 指令），不可用时显式降级为
  // 字符类别估算——档案按 input_tokens_source 如实标注，估算值永不标注为精确计数
  let estimateTokens;
  let inputTokensSource = 'estimator';
  if (opts.tokenCounter) {
    const c = await opts.tokenCounter.countExact(messages);
    if (c.available) {
      estimateTokens = c.count;                     // 精确计数（完整 messages 应用 chat template 后）
      inputTokensSource = 'tokenizer';
    } else {
      estimateTokens = estimateInputTokensUpperBound(messages);   // 显式降级：保守上界估算
    }
  } else {
    estimateTokens = estimateInputTokensUpperBound(messages);
  }

  const payload = {
    model: opts.model,
    messages,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.7,
    max_tokens: maxOut,                                  // API 侧硬限输出 Token
    stream: false
  };

  const base = { brief: String(opts.brief), brief_id: opts.briefId, model: opts.model,
                 prompt_version: PROMPT_VERSION, estimate_tokens: estimateTokens,
                 input_tokens_source: inputTokensSource,
                 request: { messages, temperature: payload.temperature, max_tokens: maxOut } };

  if (estimateTokens > maxIn) {
    const rec = opts.archiver.record(Object.assign({}, base, {
      outcome: 'prompt_too_large', error: '估算输入 ' + estimateTokens + ' tokens 超过上限 ' + maxIn,
      estimate_tokens: estimateTokens, latency_ms: Date.now() - started, raw_output: null, usage: null, sent: false
    }));
    return { outcome: 'prompt_too_large', candidate: null, raw: null, archive: rec, estimateTokens,
             error: '估算输入 ' + estimateTokens + ' tokens 超过上限 ' + maxIn + '——不发起调用' };
  }

  let http;
  try {
    http = await transport(payload, apiKey);
  } catch (e) {
    const rec = opts.archiver.record(Object.assign({}, base, {
      outcome: 'http_error', error: String(e.message), latency_ms: Date.now() - started, raw_output: null, usage: null,
      sent: true   // 传输层抛错无法确定发送与否——保守按已发送处理（结果不确定 → hold）
    }));
    return { outcome: 'http_error', candidate: null, raw: null, archive: rec, error: String(e.message) };
  }

  const raw = http.body;
  const usage = (() => { try { const j = JSON.parse(raw); return j.usage || null; } catch (e) { return null; } })();
  const shared = { latency_ms: Date.now() - started, http_status: http.status, raw_output: raw, usage,
                   sent: http.sent === undefined ? true : !!http.sent };

  if (http.status !== 200) {
    const rec = opts.archiver.record(Object.assign({}, base, shared, { outcome: 'http_error', error: 'HTTP ' + http.status }));
    return { outcome: 'http_error', candidate: null, raw, archive: rec, error: 'HTTP ' + http.status };
  }

  // 内容抽取：取 choices[0].message.content（缺失则把 body 整体视作输出）
  let content = raw;
  try {
    const j = JSON.parse(raw);
    if (j.choices && j.choices[0] && j.choices[0].message && typeof j.choices[0].message.content === 'string') {
      content = j.choices[0].message.content;
    }
  } catch (e) { /* 保留原始文本进入解析 */ }

  let candidate = null, outcome = 'parsed', error = null;
  try {
    const text = extractJsonText(content);
    const parsed = secureParse(text);            // 严格 JSON + 原型污染防护
    checkEnvelope(parsed);                       // 安全级契约守卫（完整 Schema 属 M2）
    candidate = parsed;
  } catch (e) {
    outcome = (e instanceof SecurityError && e.code === 'INVALID_JSON') ? 'parse_failed' : 'contract_failed';
    error = e.code ? ('SECURITY:' + e.code) : String(e.message).slice(0, 120);
  }

  const rec = opts.archiver.record(Object.assign({}, base, shared, { outcome, error, candidate }));
  return { outcome, candidate, raw: content, archive: rec, error };
}

module.exports = { execute, extractJsonText, estimateInputTokensUpperBound, ZHIPU_ENDPOINT };
