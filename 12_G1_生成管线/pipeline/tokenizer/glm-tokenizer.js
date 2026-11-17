'use strict';
/* GLM Tokenizer 辅助进程 Node 包装（曦 2026-11-16 指令）
   职责：spawn 对应模型的 Python venv 解释器运行 glm-tokenizer.py，
   对完整 messages 精确计数；失败分类上报，绝不把字符估算伪装成精确计数。
   降级契约：countExact(messages) →
     { available: true,  count, source: 'tokenizer' }                    —— 精确计数
     { available: false, reason, source: 'estimator' }                   —— 显式降级
   预检消费方（model-adapter）按 source 如实标注档案，估算值永不标注为精确计数。
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'tokenizer-config.json'), 'utf8'));
}

function resolvePython(cfg, model) {
  const rel = (cfg.pythonEnvs || {})[model];
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.join(__dirname, '..', '..', rel);
  return fs.existsSync(abs) ? abs : null;
}

/* createGlmTokenCounter({ runner? }) —— runner 可注入（测试用 mock），默认 spawn 真实 sidecar */
function createGlmTokenCounter(opts) {
  const runner = opts && opts.runner;
  const lockTimeoutMs = (opts && opts.timeoutMs) || 30000;

  async function realRunner(model, messages) {
    const cfg = loadConfig();
    const mc = cfg.models[model];
    if (!mc) return { ok: false, error: 'MODEL_NOT_BOUND：模型 ' + model + ' 未绑定 tokenizer 仓库' };
    const py = resolvePython(cfg, model);
    if (!py) return { ok: false, error: 'PYTHON_ENV_MISSING：' + model + ' 的 venv 未创建（见 tokenizer-config.json pythonEnvs）' };
    const pyScript = path.join(__dirname, 'glm-tokenizer.py');
    return new Promise(resolve => {
      const child = spawn(py, [pyScript], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let out = '', errbuf = '';
      const timer = setTimeout(() => { try { child.kill(); } catch (e) {} }, lockTimeoutMs);
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { errbuf += d; });
      child.on('error', e => { clearTimeout(timer); resolve({ ok: false, error: 'PYTHON_SPAWN_FAILED：' + e.message }); });
      child.on('exit', () => {
        clearTimeout(timer);
        const line = out.trim().split('\n').pop();
        try { resolve(JSON.parse(line)); }
        catch (e) { resolve({ ok: false, error: 'SIDECAR_OUTPUT_INVALID：' + (out.slice(0, 120) || errbuf.slice(0, 120)) }); }
      });
      child.stdin.write(JSON.stringify({ model, messages }));
      child.stdin.end();
    });
  }

  async function countExact(messages) {
    const model = (opts && opts.model) || null;
    let result;
    if (runner) {
      result = await runner(model, messages);          // 注入式 runner（测试 / 外部精确计数源）
    } else {
      if (!model) return { available: false, reason: 'NO_MODEL_BOUND', source: 'estimator' };
      result = await realRunner(model, messages);
    }
    if (result && result.ok) {
      return { available: true, count: result.count, loader: result.loader || null,
               revision: result.revision || null, source: 'tokenizer' };
    }
    return { available: false, reason: (result && result.error) || 'SIDECAR_FAILED', source: 'estimator' };
  }

  return { countExact };
}

module.exports = { createGlmTokenCounter };
