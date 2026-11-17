'use strict';
/* G1 工作台 · Mock 模型传输层（曦 A 方案 MVP，2026-11-17）
   性质声明（Mock 与真实严格区分——曦执行约束）：
   - 本层模拟智谱 API 的传输行为：返回注入候选（全部来自已过闸门的既有产物）、
     模拟 usage 计数、支持首回合失败注入（演示重试链路）；
   - 【mock】标记贯穿返回值；档案目录与台账均与真实通道物理分离；
   - 本层永不伪装成真实模型输出：自由 Brief 无匹配时走 fallback（tune-e 候选）
     并由调用方如实标注 mockFallback。
*/
const fs = require('fs');
const path = require('path');

function loadBriefs() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'tuning-briefs.json'), 'utf8'));
}

function loadCandidate(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'mock-candidates', file), 'utf8'));
}

function wrapResponse(content, usage) {
  return JSON.stringify({
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.prompt_tokens + usage.completion_tokens
    }
  });
}

/* createMockTransport({ briefText, injectFirstFailure, usage })
   返回 { transport, matched: briefConfig|null, fallback: boolean }
   - briefText 精确/包含匹配 7 个示例 Brief；无匹配 → fallback（tune-e 候选，如实上报）；
   - injectFirstFailure=true 时首次调用返回「信封合法但 win 含未知函数」的输出
     （安全解析与契约检查均放行、由 Schema 闸门 UNKNOWN_FUNCTION 拦截 → 演示重试）。
*/
function createMockTransport(opts) {
  const cfg = loadBriefs();
  const usage = (opts.usage) || cfg.mockUsage;
  const text = String(opts.briefText || '').trim();
  let matched = cfg.briefs.find(b => b.text === text) || null;
  if (!matched) matched = cfg.briefs.find(b => text.includes(b.text) || b.text.includes(text)) || null;
  const fallback = !matched;
  const effective = matched || cfg.briefs.find(b => b.id === 'tune-e');
  const inject = !fallback && !!effective.injectFirstFailure && opts.injectFirstFailure !== false;

  let calls = 0;
  const transport = async () => {
    calls++;
    if (inject && calls === 1) {
      const bad = loadCandidate('tune-f-attempt1.json');
      return { status: 200, sent: true, mock: true, body: wrapResponse(bad.content, usage) };
    }
    const good = loadCandidate(effective.mockCandidate);
    return { status: 200, sent: true, mock: true, body: wrapResponse(good.content, usage) };
  };
  return { transport, matched, fallback, effective };
}

module.exports = { createMockTransport, loadBriefs, loadCandidate };
