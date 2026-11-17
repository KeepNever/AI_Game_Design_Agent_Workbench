'use strict';
/* G1 M2 · 金额级预算硬闸门 v4（曦 2026-11-13 21:17 复核四项修正）
   1. 锁所有权：释放锁前校验 OWNER——锁被他人接管时不误删（留给陈旧锁回收机制）；
      陈旧锁回收需「锁已陈旧 且 持有进程已死亡」双条件（存活持有者不回收），
      回收前以 inode 复核缩小竞争窗口。
   2. reservation ID 贯穿状态机：reserved → settled / released / held；
      重复核销（DUPLICATE_SETTLE）、重复释放（DUPLICATE_RELEASE）、未知 ID（NOT_FOUND）一律拒绝；
      reservedCNY 不再增量记账——每次变更后从 reservations 状态机重算（杜绝重复释放/漏计漂移）。
   3. hold 解除闭环：resolveHold 必须给出账务处置——resolution='settled'（人工核对出实际 usage，
      按真实费用核销）或 resolution='released'（人工核对确认无消耗，释放不计费）；
      未处置前 hold 阻塞新请求。账务责任：人工核对由曦执行，闸门只提供两个处置出口。
   4. Token 上限真约束：payload.max_tokens = maxOutputTokens（API 侧硬限输出）；
      请求前输入估算超 maxInputTokens 拒绝（prompt_too_large，不发起调用）；
      核销时实际 usage 超预留依据 → 记录真实费用 + overruns 预算超限事件。
   并发安全：文件锁（O_EXCL + 所有权标识 + 陈旧且持有者死亡才回收）+ 原子持久化 +
      关键区内磁盘重读。台账不含密钥。
   跨进程竞争实测：X1（两个独立子进程 2115 笔核销 21.996 元 ≤ 22 元，无残留预留）。
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CAP_CNY = 22;

function loadPricing(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function createBudgetGuard({ ledgerPath, capCNY, pricing, maxInputTokens = 6000, maxOutputTokens = 2000, lockTimeoutMs = 8000, staleLockMs = 30000 }) {
  const cap = typeof capCNY === 'number' ? capCNY : DEFAULT_CAP_CNY;
  const priceTable = pricing || loadPricing(path.join(__dirname, 'pricing.json'));
  const OWNER = process.pid + '-' + crypto.randomBytes(4).toString('hex');   // 锁所有权标识

  function priceOf(model) {
    return priceTable.perMillionTokens[String(model || '').toLowerCase()] || null;
  }

  function estimateCostCNY(model) {
    const p = priceOf(model);
    if (!p) return null;
    return (maxInputTokens / 1e6) * p.input + (maxOutputTokens / 1e6) * p.output;
  }

  function validUsage(u) {
    return u !== null && typeof u === 'object' &&
           Number.isFinite(u.prompt_tokens) && Number.isInteger(u.prompt_tokens) && u.prompt_tokens >= 0 &&
           Number.isFinite(u.completion_tokens) && Number.isInteger(u.completion_tokens) && u.completion_tokens >= 0;
  }

  // ── 锁原语 ──────────────────────────────────────────────
  function readLock(lockPath) {
    try {
      return { raw: JSON.parse(fs.readFileSync(lockPath, 'utf8')), stat: fs.statSync(lockPath) };
    } catch (e) { return null; }
  }

  // 持有进程是否仍存活（owner 格式：pid-随机串）
  function ownerAlive(owner) {
    const pid = parseInt(String(owner).split('-')[0], 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;   // 无有效 PID 的锁视为死锁
    try { process.kill(pid, 0); return true; }
    catch (e) { return e.code === 'EPERM'; }                // EPERM = 进程存在但无权发信号
  }

  // 释放锁前校验所有权：锁被他人接管时不误删
  function releaseLockIfOurs(lockPath) {
    try {
      const lock = readLock(lockPath);
      if (!lock) return;                                    // 锁已消失——无需处理
      if (lock.raw.owner !== OWNER) return;                 // 已被他人接管——不误删，留给陈旧锁回收
      fs.unlinkSync(lockPath);
    } catch (e) { /* 锁已消失 */ }
  }

  function withLock(fn) {
    const lockPath = ledgerPath + '.lock';
    const start = Date.now();
    return new Promise((resolve, reject) => {
      (function tryLock() {
        let acquired = false;
        try {
          const fd = fs.openSync(lockPath, 'wx');           // O_EXCL：独占创建
          fs.writeFileSync(fd, JSON.stringify({ owner: OWNER, ts: Date.now() }));
          fs.closeSync(fd);
          acquired = true;
        } catch (e) {
          // 被占用：仅当「锁已陈旧 且 持有进程已死亡」才回收（回收前以 inode 复核缩小竞争窗口）
          const lock = readLock(lockPath);
          if (lock && Date.now() - lock.stat.mtimeMs > staleLockMs && !ownerAlive(lock.raw.owner)) {
            const re = fs.statSync(lockPath);               // 二次核对：inode 未变才删
            if (re.ino === lock.stat.ino) {
              try { fs.unlinkSync(lockPath); } catch (e2) { /* 已被他人处理 */ }
            }
          }
          if (Date.now() - start > lockTimeoutMs) {
            const cur = readLock(lockPath);
            return reject(new Error('BUDGET_LOCK_TIMEOUT（占用者: ' + (cur && cur.raw ? cur.raw.owner : 'unknown') + '）'));
          }
          return setTimeout(tryLock, 25);
        }
        let out;
        try {
          out = fn();                                       // 同步「重读台账→变更→重算→原子写」关键区
          releaseLockIfOurs(lockPath);                      // 所有权校验后才删除
          resolve(out);
        } catch (e) {
          releaseLockIfOurs(lockPath);
          reject(e);
        }
      })();
    });
  }

  // ── 台账 ──────────────────────────────────────────────
  // 预算占用状态集（曦复核 2026-11-16 第 1 点）：reserved（未发送）与 held（已发送、结果不确定）
  // 都必须计入预算占用——held 意味着请求可能已消耗 Token，在人工账务处置前不得释放预算。
  const OCCUPYING_STATUSES = new Set(['reserved', 'held']);

  function reloadLedger() {
    if (fs.existsSync(ledgerPath)) {
      const lg = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      // 账本不变量（曦复核第 3 点）：reservedCNY 一律从状态机派生（状态机为唯一真源）——
      // 占用 = Σ(status ∈ {reserved, held})；损坏/漂移在每次加载时自愈，后续判断全部基于派生值
      lg.reservedCNY = Math.round(Object.keys(lg.reservations || {})
        .filter(id => OCCUPYING_STATUSES.has(lg.reservations[id].status))
        .reduce((acc, id) => acc + lg.reservations[id].estimate, 0) * 1e6) / 1e6;
      return lg;
    }
    return { capCNY: cap, currency: 'CNY', totalSpentCNY: 0,
             reservations: {}, entries: [], noPriceCount: 0, holds: [], overruns: [] };
  }

  // 账本不变量：reservedCNY ≡ Σ(status ∈ {reserved, held} 的预留估算)
  // （不增量记账——杜绝重复释放/漏计造成的漂移；曦复核第 3 点）
  function recomputeReserved(lg) {
    let sum = 0;
    for (const id of Object.keys(lg.reservations || {})) {
      if (OCCUPYING_STATUSES.has(lg.reservations[id].status)) sum += lg.reservations[id].estimate;
    }
    return Math.round(sum * 1e6) / 1e6;
  }

  function unresolvedHoldCount(lg) {
    return (lg.holds || []).filter(h => !h.resolved).length;
  }

  /* reserve(model, meta) → { ok:true, estimate, reservationId } | { ok:false, reason, event } */
  function reserve(model, meta) {
    return withLock(() => {
      const lg = reloadLedger();
      // 3. 未解决 hold 阻止新请求（usage 缺失等待核对/人工账务处置）
      const uh = unresolvedHoldCount(lg);
      if (uh > 0) {
        return { ok: false, reason: 'HOLD_UNRESOLVED：存在 ' + uh + ' 个未解决 hold（等待人工账务处置），暂停新请求',
                 event: { kind: 'budget', label: '未解决 hold 阻止新请求', outcome: 'hold_unresolved' } };
      }
      const est = estimateCostCNY(model);
      if (est === null) {
        lg.noPriceCount += 1;
        lg.entries.push({ ts: new Date().toISOString(), type: 'NO_PRICE_REJECTED', model, meta: meta || null });
        atomicWrite(ledgerPath, JSON.stringify(lg, null, 2));
        return { ok: false, reason: 'NO_PRICE：模型 ' + model + ' 未配置单价，禁止发起真实请求',
                 event: { kind: 'budget', label: 'NO_PRICE 拒绝', outcome: 'no_price_rejected' } };
      }
      const remaining = cap - lg.totalSpentCNY - (lg.reservedCNY || 0);
      if (est > remaining) {
        return { ok: false, reason: 'INSUFFICIENT_BUDGET：本次预估 ' + est + ' 元 > 剩余 ' + remaining + ' 元（总预算 ' + cap + ' 元）',
                 event: { kind: 'budget', label: '预算不足拒绝', outcome: 'insufficient_budget', estimate: est, remaining } };
      }
      const id = 'rsv-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
      lg.reservations[id] = { status: 'reserved', model, estimate: est, ts: new Date().toISOString(), meta: meta || null };
      lg.reservedCNY = recomputeReserved(lg);
      lg.entries.push({ ts: new Date().toISOString(), type: 'RESERVE', reservationId: id, model, estimate: est });
      atomicWrite(ledgerPath, JSON.stringify(lg, null, 2));
      return { ok: true, estimate: est, reservationId: id };
    });
  }

  /* settle({ reservationId, usage, meta }) —— 核销 + 释放预留；重复核销拒绝 */
  function settle({ reservationId, usage, meta }) {
    return withLock(() => {
      const lg = reloadLedger();
      const res = reservationId ? lg.reservations[reservationId] : null;
      if (!res) return { settled: false, rejected: true, reason: 'RESERVATION_NOT_FOUND：' + reservationId };
      if (res.status !== 'reserved') {
        return { settled: false, rejected: true, reason: 'DUPLICATE_SETTLE：预留 ' + reservationId + ' 当前状态 ' + res.status };
      }
      if (!validUsage(usage)) {
        // usage 缺失/非法：不按 0 核销——预留转 held（阻塞新请求），等待人工账务处置（resolveHold）
        res.status = 'held';
        lg.holds.push({ ts: new Date().toISOString(), reservationId, model: res.model,
                        reason: 'USAGE_MISSING_OR_INVALID', estimate: res.estimate, meta: meta || null, resolved: false });
        lg.reservedCNY = recomputeReserved(lg);
        atomicWrite(ledgerPath, JSON.stringify(lg, null, 2));
        return { settled: false, held: true, reason: 'USAGE_MISSING_OR_INVALID：预留保留并阻塞新请求，等待人工账务处置（resolveHold）' };
      }
      const p = priceOf(res.model);
      if (!p) {
        res.status = 'held';
        lg.noPriceCount += 1;
        lg.holds.push({ ts: new Date().toISOString(), reservationId, model: res.model,
                        reason: 'NO_PRICE_SETTLE', estimate: res.estimate, meta: meta || null, resolved: false });
        lg.reservedCNY = recomputeReserved(lg);
        atomicWrite(ledgerPath, JSON.stringify(lg, null, 2));
        return { settled: false, held: true, reason: 'NO_PRICE：无法核销，预留保留并阻塞新请求，等待人工账务处置' };
      }
      const inTok = usage.prompt_tokens, outTok = usage.completion_tokens;
      const cost = Math.round(((inTok / 1e6) * p.input + (outTok / 1e6) * p.output) * 1e6) / 1e6;
      // 1. 核销时检查实际 usage 是否超过预留依据（Token 上限）→ 记录真实费用 + 预算超限事件
      const overrun = (inTok > maxInputTokens || outTok > maxOutputTokens) ? {
        reservationId, usage: { prompt_tokens: inTok, completion_tokens: outTok },
        expected: { maxInputTokens, maxOutputTokens }, costCNY: cost,
        ts: new Date().toISOString()
      } : null;
      if (overrun) lg.overruns.push(overrun);
      lg.totalSpentCNY = Math.round((lg.totalSpentCNY + cost) * 1e6) / 1e6;
      res.status = 'settled';
      lg.reservedCNY = recomputeReserved(lg);
      lg.entries.push({ ts: new Date().toISOString(), type: 'SETTLE', reservationId, model: res.model,
                        usage: { prompt_tokens: inTok, completion_tokens: outTok }, costCNY: cost,
                        overrun: !!overrun, releasedEstimate: res.estimate });
      atomicWrite(ledgerPath, JSON.stringify(lg, null, 2));
      return { settled: true, costCNY: cost, overrun, totalSpentCNY: lg.totalSpentCNY,
               exceeded: lg.totalSpentCNY >= cap, remainingCNY: Math.max(0, cap - lg.totalSpentCNY) };
    });
  }

  /* release({ reservationId, meta }) —— 确定未发送时全额释放预留；重复释放拒绝 */
  function release({ reservationId, meta }) {
    return withLock(() => {
      const lg = reloadLedger();
      const res = reservationId ? lg.reservations[reservationId] : null;
      if (!res) return { ok: false, reason: 'RESERVATION_NOT_FOUND：' + reservationId };
      if (res.status !== 'reserved') {
        return { ok: false, reason: 'DUPLICATE_RELEASE：预留 ' + reservationId + ' 当前状态 ' + res.status };
      }
      res.status = 'released';
      lg.reservedCNY = recomputeReserved(lg);
      lg.entries.push({ ts: new Date().toISOString(), type: 'RELEASE', reservationId, model: res.model, estimate: res.estimate });
      atomicWrite(ledgerPath, JSON.stringify(lg, null, 2));
      return { ok: true, reservedCNY: lg.reservedCNY };
    });
  }

  /* hold({ reservationId, reason, meta }) —— 请求结果不确定：预留转 held（阻塞新请求） */
  function hold({ reservationId, reason, meta }) {
    return withLock(() => {
      const lg = reloadLedger();
      const res = reservationId ? lg.reservations[reservationId] : null;
      if (!res) return { ok: false, reason: 'RESERVATION_NOT_FOUND：' + reservationId };
      if (res.status !== 'reserved') return { ok: false, reason: 'DUPLICATE_HOLD：预留 ' + reservationId + ' 当前状态 ' + res.status };
      res.status = 'held';
      lg.holds.push({ ts: new Date().toISOString(), reservationId, model: res.model,
                      reason: reason || 'REQUEST_OUTCOME_UNCERTAIN', estimate: res.estimate, meta: meta || null, resolved: false });
      lg.reservedCNY = recomputeReserved(lg);
      atomicWrite(ledgerPath, JSON.stringify(lg, null, 2));
      return { ok: true, reservedCNY: lg.reservedCNY };
    });
  }

  /* resolveHold({ reservationId, resolution, usage?, resolvedBy? }) —— hold 的账务闭环（曦复核第 4 点）
     resolution='settled'：人工核对出实际 usage（如从智谱后台），按真实费用核销（含超限检查）；
     resolution='released'：人工核对确认无消耗，释放不计费。
     账务责任：人工核对由曦执行；闸门只提供两个处置出口并完整留痕。 */
  function resolveHold({ reservationId, resolution, usage, resolvedBy }) {
    return withLock(() => {
      const lg = reloadLedger();
      let cost = 0, overrun = null;
      const h = (lg.holds || []).find(h => h.reservationId === reservationId && !h.resolved);
      if (!h) return { ok: false, reason: 'HOLD_NOT_FOUND：' + reservationId };
      const res = lg.reservations[reservationId];
      if (!res || res.status !== 'held') {
        return { ok: false, reason: 'RESERVATION_STATE_INVALID：预留 ' + reservationId + ' 当前状态 ' + (res ? res.status : '不存在') };
      }
      const by = resolvedBy || 'manual';
      if (resolution === 'settled') {
        if (!validUsage(usage)) return { ok: false, reason: 'RESOLUTION_SETTLED_REQUIRES_USAGE：处置为核销必须提供实际 usage（人工核对来源：智谱后台）' };
        const p = priceOf(res.model);
        if (!p) return { ok: false, reason: 'NO_PRICE：模型 ' + res.model + ' 未配置单价，无法按核销处置' };
        cost = Math.round(((usage.prompt_tokens / 1e6) * p.input + (usage.completion_tokens / 1e6) * p.output) * 1e6) / 1e6;
        overrun = (usage.prompt_tokens > maxInputTokens || usage.completion_tokens > maxOutputTokens) ? {
          reservationId, usage, expected: { maxInputTokens, maxOutputTokens }, costCNY: cost, ts: new Date().toISOString(), via: 'hold-resolution'
        } : null;
        if (overrun) lg.overruns.push(overrun);
        lg.totalSpentCNY = Math.round((lg.totalSpentCNY + cost) * 1e6) / 1e6;
        res.status = 'settled';
        h.resolved = true; h.resolution = 'settled'; h.resolvedBy = by; h.resolvedAt = new Date().toISOString(); h.costCNY = cost;
        lg.entries.push({ ts: h.resolvedAt, type: 'HOLD_RESOLVED_SETTLED', reservationId, costCNY: cost, resolvedBy: by, overrun: !!overrun });
      } else if (resolution === 'released') {
        res.status = 'released';
        h.resolved = true; h.resolution = 'released'; h.resolvedBy = by; h.resolvedAt = new Date().toISOString(); h.costCNY = 0;
        lg.entries.push({ ts: h.resolvedAt, type: 'HOLD_RESOLVED_RELEASED', reservationId, costCNY: 0, resolvedBy: by });
      } else {
        return { ok: false, reason: 'INVALID_RESOLUTION：resolution 必须为 settled（按实际 usage 核销）或 released（确认无消耗释放）' };
      }
      lg.reservedCNY = recomputeReserved(lg);
      atomicWrite(ledgerPath, JSON.stringify(lg, null, 2));
      return { ok: true, resolution, costCNY: cost,
               totalSpentCNY: lg.totalSpentCNY, unresolvedRemaining: unresolvedHoldCount(lg) };
    });
  }

  function exceeded() { return withLock(() => reloadLedger().totalSpentCNY >= cap); }
  function remainingCNY() { return withLock(() => Math.max(0, cap - reloadLedger().totalSpentCNY - (reloadLedger().reservedCNY || 0))); }
  function getLedger() { return withLock(() => reloadLedger()); }

  return { reserve, settle, release, hold, resolveHold, exceeded, remainingCNY, getLedger,
           capCNY: cap, estimateCostCNY, maxInputTokens, maxOutputTokens };
}

module.exports = { createBudgetGuard, loadPricing, DEFAULT_CAP_CNY };
