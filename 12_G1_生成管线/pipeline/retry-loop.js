'use strict';
/* G1 M2 · 拦截与有限重试闭环（reservationId 契约版）
   流程：execute（模型调用+安全解析）→ 完整 Schema 校验 → GT-1 可解性 → 全过即交付候选；
   失败则分类 → 结构化错误回喂 → 有限重试。
   硬规则（曦指令）：
   - 重试必须设次数与预算上限；每次尝试、失败、重试都留档（经 archiver）；
   - 区分四类错误：schema / json_parse / auth / network；
   - 鉴权失败与无密钥：绝不重试；
   - UNKNOWN 按原因分类（曦 2026-11-13 指令 1）：runtime_errors → 有限重试；
     state_exploded（超限/可能无限/能力不足）→ 停止并记录；不支持语义不得判 UNSAT。
   金额闸门三段式（reservationId 贯穿，曦 2026-11-13 20:48 指令）：
   1. reserve → reservationId；NO_PRICE / INSUFFICIENT_BUDGET / HOLD_UNRESOLVED 拒绝并留痕；
   2. settle（实际 usage 核销 + 释放该笔预留）；usage 缺失/非法 → 预留转 held + 停止后续调用；
   3. release 仅限「确定未发送」；请求已发送但结果不确定 → hold（保留预留，等待核对）。
*/
const { validate } = require('../validator/schema-validator');
const { solveLevel } = require('../validator/solver');
const { execute } = require('./model-adapter');

// 错误四分类（曦指令：区分 Schema 错误、JSON 解析错误、鉴权失败、网络异常）
function classify(outcome, httpStatus) {
  if (outcome === 'no_api_key') return { kind: 'auth', retryable: false, label: '鉴权失败（无密钥）' };
  if (outcome === 'http_error') {
    if (httpStatus === 401 || httpStatus === 403) return { kind: 'auth', retryable: false, label: '鉴权失败（HTTP ' + httpStatus + '）' };
    return { kind: 'network', retryable: true, label: '网络/服务异常（HTTP ' + httpStatus + '）' };
  }
  if (outcome === 'parse_failed') return { kind: 'json_parse', retryable: true, label: 'JSON 解析错误' };
  if (outcome === 'contract_failed') return { kind: 'schema', retryable: true, label: 'Schema 错误（安全级契约）' };
  return { kind: 'unknown', retryable: true, label: '未知结果' };
}

function buildSchemaFeedback(errors) {
  return '【上一次输出未通过 Schema 校验，错误清单如下】\n' +
    errors.map(e => '- [' + e.code + '] ' + e.where + (e.detail ? '：' + e.detail : '')).join('\n') +
    '\n请修正以上全部错误后，重新只输出完整 JSON 信封（结构要求见系统提示）。';
}

function buildSolveFeedback(solvability) {
  return '【上一次输出的关卡未通过可解性验证】\n' +
    solvability.map(s => '- 关卡 ' + s.index + '：' + s.verdict + (s.reason ? '（' + s.reason.slice(0, 80) + '）' : '')).join('\n') +
    '\n请调整关卡设计，保证每一关从玩家初始位置可达胜利条件，重新只输出完整 JSON 信封。';
}

/* generateWithRetry({ brief, briefId, model, apiKey, transport, archiver, DSLRules, errProbe,
                       maxAttempts?, budgetGuard?, temperature? }) */
async function generateWithRetry(opts) {
  const maxAttempts = Math.max(1, opts.maxAttempts || 3);
  const guard = opts.budgetGuard || null;             // 金额级硬闸门（reservationId 契约）
  let spentTokens = 0;
  let spentCNY = 0;
  const events = [];
  let feedback = null;
  let reservationId = null;                           // 活跃预留（一笔一 ID，一次性操作）

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // ── 请求前：金额预留（reservationId 贯穿三段式）──
    if (guard) {
      const res = await guard.reserve(opts.model, { brief_id: opts.briefId, attempt });
      if (!res.ok) {
        const lgNow = await guard.getLedger();
        events.push({ attempt, kind: 'budget', label: res.reason, outcome: res.event.outcome });
        const prefix = res.event.outcome === 'no_price_rejected' ? 'no_price_no_retry：'
                     : res.event.outcome === 'hold_unresolved' ? 'hold_unresolved：'
                     : 'budget_exhausted：';
        return { ok: false, attempts: attempt - 1, candidate: null, spentTokens,
                 spentCNY: lgNow.totalSpentCNY, events, reason: prefix + res.reason };
      }
      reservationId = res.reservationId;
    }

    const r = await execute({
      brief: opts.brief, briefId: opts.briefId, model: opts.model,
      apiKey: opts.apiKey, transport: opts.transport, archiver: opts.archiver,
      temperature: opts.temperature, feedback,
      tokenCounter: opts.tokenCounter,
      maxInputTokens: guard ? guard.maxInputTokens : (opts.maxInputTokens || 6000),
      maxOutputTokens: guard ? guard.maxOutputTokens : (opts.maxOutputTokens || 2000)
    });
    const full = (r.archive && r.archive.full) || {};
    const usage = full.usage || null;
    const sent = full.sent === undefined ? true : !!full.sent;   // 保守默认：按已发送处理
    const httpStatus = full.http_status;
    spentTokens += (usage && usage.total_tokens) || 0;

    // ── 金额三段式：核销 / hold / release ──
    if (guard && reservationId) {
      if (r.outcome === 'no_api_key') {
        // 确定未发送（无密钥拒绝发生在调用前）→ release
        await guard.release({ reservationId, meta: { brief_id: opts.briefId, attempt } });
        reservationId = null;
      } else if (r.outcome === 'prompt_too_large') {
        // 确定未发送（请求前预检拒绝）→ release
        await guard.release({ reservationId, meta: { brief_id: opts.briefId, attempt } });
        reservationId = null;
      } else if (usage) {
        // 有合法 usage：按实际用量核销并释放该笔预留
        const s = await guard.settle({ reservationId, usage, meta: { brief_id: opts.briefId, attempt } });
        reservationId = null;
        if (!s.settled) {
          events.push({ attempt, kind: 'budget', label: s.reason, outcome: 'usage_hold' });
          return { ok: false, attempts: attempt, candidate: null, spentTokens, spentCNY, events,
                   reason: 'usage_unverified_halt：' + s.reason };
        }
        spentCNY = s.totalSpentCNY;
        if (s.overrun) {
          // 核销时实际 usage 超预留依据 → 预算超限事件（真实费用已记录）
          events.push({ attempt, kind: 'budget', label: '预算超限事件：实际 usage 超出 Token 上限（真实费用已核销）', outcome: 'usage_overrun', overrun: s.overrun });
        }
        if (s.exceeded) {
          return { ok: false, attempts: attempt, candidate: null, spentTokens, spentCNY, events,
                   reason: 'budget_exhausted：本次核销后已达总预算上限 22 元' };
        }
      } else if (!sent) {
        // 确定未发送（连接期失败）：release 全额释放，然后有限重试
        await guard.release({ reservationId, meta: { brief_id: opts.briefId, attempt } });
        reservationId = null;
      } else {
        // 已发送但结果不确定（超时/响应丢失/无 usage）：hold 保留预留，停止后续调用
        await guard.hold({ reservationId, reason: 'REQUEST_SENT_OUTCOME_UNCERTAIN：' + (r.error || '响应缺失'), meta: { brief_id: opts.briefId, attempt } });
        reservationId = null;
        if (httpStatus === 401 || httpStatus === 403) {
          events.push({ attempt, kind: 'auth', label: '鉴权失败（HTTP ' + httpStatus + '，已发送）', outcome: r.outcome });
        }
        events.push({ attempt, kind: 'budget', label: '请求结果不确定：预留保留进入 hold，停止后续调用', outcome: 'usage_hold' });
        return { ok: false, attempts: attempt, candidate: null, spentTokens, spentCNY, events,
                 reason: 'usage_unverified_halt：请求结果不确定，预留保留等待核对' };
      }
    }

    if (r.outcome === 'no_api_key') {
      events.push({ attempt, kind: 'auth', label: '鉴权失败（无密钥）', outcome: r.outcome });
      return { ok: false, attempts: attempt, candidate: null, spentTokens, spentCNY, events,
               reason: 'auth_no_retry：' + r.error };       // 鉴权类绝不重试
    }
    if (r.outcome === 'prompt_too_large') {
      events.push({ attempt, kind: 'input_limit', label: '输入 Token 超限（估算 ' + r.estimateTokens + '）', outcome: r.outcome });
      return { ok: false, attempts: attempt, candidate: null, spentTokens, spentCNY, events,
               reason: 'input_limit_no_retry：' + r.error };  // Brief/上下文过大——不重试，需人工处理
    }
    if (r.outcome === 'http_error') {
      const status = full.http_status;
      const cls = classify('http_error', status);
      events.push({ attempt, kind: cls.kind, label: cls.label, outcome: r.outcome, sent });
      if (!cls.retryable) return { ok: false, attempts: attempt, candidate: null, spentTokens, spentCNY, events,
                                   reason: 'auth_no_retry：' + cls.label };
      feedback = '上一次模型调用失败（' + cls.label + '），请重新输出。';
      continue;                                              // 网络类：有限重试
    }
    if (r.outcome === 'parse_failed') {
      const cls = classify('parse_failed');
      events.push({ attempt, kind: cls.kind, label: cls.label, outcome: r.outcome });
      feedback = '【上一次输出无法通过 JSON 解析】错误：' + (r.error || 'INVALID_JSON') +
                 '\n请只输出一个 JSON 信封（以 { 开头、} 结束），不要任何围栏、解释或多余文本。';
      continue;
    }
    if (r.outcome === 'contract_failed') {
      const cls = classify('contract_failed');
      events.push({ attempt, kind: cls.kind, label: cls.label, outcome: r.outcome });
      feedback = '【上一次输出未通过安全级契约检查】' + (r.error || '') + '\n请修正后重新只输出完整 JSON 信封。';
      continue;
    }

    // outcome === 'parsed'：安全级候选 → 完整 Schema 校验
    const candidate = r.candidate;
    const v = validate(candidate.mechanic, candidate.levels);
    if (!v.ok) {
      events.push({ attempt, kind: 'schema', label: 'Schema 错误', outcome: 'schema_failed', errorCount: v.errors.length });
      feedback = buildSchemaFeedback(v.errors);
      continue;
    }

    // GT-1 可解性（注入 DSLRules 才启用；UNKNOWN 不算通过）
    if (opts.DSLRules && opts.errProbe) {
      const solvability = [];
      for (let i = 0; i < candidate.levels.length; i++) {
        const sr = solveLevel(opts.DSLRules, candidate.mechanic, candidate.levels[i], { errProbe: opts.errProbe });
        solvability.push({ index: i + 1, verdict: sr.solvable === true ? 'PASS' : sr.solvable === false ? 'UNSAT' : 'UNKNOWN',
                           unknownKind: sr.unknownKind || null, reason: sr.reason, steps: sr.steps || null });
      }
      const bad = solvability.filter(s => s.verdict !== 'PASS');
      if (bad.length) {
        // UNKNOWN 按原因分类（曦指令 1）：可修复运行时错误 → 有限重试；
        // 状态空间超限/可能无限/求解器能力不足 → 停止重试并记录；不支持语义不得判 UNSAT（探针保证）。
        const exploded = bad.some(s => s.verdict === 'UNKNOWN' && s.unknownKind === 'state_exploded');
        events.push({ attempt, kind: 'solvability', label: '可解性验证失败', outcome: 'solve_failed',
                      detail: bad.map(b => '关' + b.index + ':' + b.verdict + (b.unknownKind ? '(' + b.unknownKind + ')' : '')).join(', '),
                      unknownKinds: bad.map(b => b.unknownKind).filter(Boolean) });
        if (exploded) {
          return { ok: false, attempts: attempt, candidate: null, spentTokens, spentCNY, events, solvability,
                   reason: 'solvability_stop：状态空间超限/可能无限/求解器能力不足——停止重试并记录（不支持语义不判 UNSAT）' };
        }
        feedback = buildSolveFeedback(bad);
        continue;
      }
      events.push({ attempt, kind: 'solvability', label: '可解性验证通过', outcome: 'solve_pass' });
    }

    events.push({ attempt, kind: 'ok', label: '全部闸门通过', outcome: 'parsed' });
    return { ok: true, attempts: attempt, candidate, spentTokens, spentCNY, events, validation: v };
  }

  return { ok: false, attempts: maxAttempts, candidate: null, spentTokens, spentCNY, events,
           reason: 'max_attempts_exhausted：' + maxAttempts + ' 次尝试均未通过' };
}

module.exports = { generateWithRetry, classify, buildSchemaFeedback, buildSolveFeedback };
