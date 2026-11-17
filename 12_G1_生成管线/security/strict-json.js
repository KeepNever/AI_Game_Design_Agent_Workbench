'use strict';
/* M0 安全层 · 严格 JSON 解析与原型污染防护
   原则：生成产物只允许是数据（JSON）——G1 管线只生成 JSON，不生成可执行代码。
   - 非 JSON 文本一律拒绝（不宽容解析、不求值）
   - __proto__ / constructor / prototype 键一律拒绝（纵深防御）
   - 总量与深度上限（安全级取值，比前置 2 LIMITS 更严）
*/
class SecurityError extends Error {
  constructor(code, detail) {
    super('SECURITY:' + code + (detail ? ' @' + detail : ''));
    this.name = 'SecurityError';
    this.code = code;
  }
}

const LIMITS = { maxBytes: 256 * 1024, maxDepth: 64 };
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function secureParse(text) {
  if (typeof text !== 'string') throw new SecurityError('NOT_TEXT');
  if (typeof Buffer !== 'undefined' && Buffer.byteLength(text, 'utf8') > LIMITS.maxBytes) {
    throw new SecurityError('PAYLOAD_TOO_LARGE');
  }
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new SecurityError('INVALID_JSON'); }
  walk(obj, '$', 0);
  return obj;
}

function walk(node, path, depth) {
  if (depth > LIMITS.maxDepth) throw new SecurityError('DEPTH_TOO_DEEP', path);
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, path + '[' + i + ']', depth + 1));
    return;
  }
  for (const k of Object.keys(node)) {
    if (FORBIDDEN_KEYS.has(k)) throw new SecurityError('FORBIDDEN_KEY', path + '.' + k);
    walk(node[k], path + '.' + k, depth + 1);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { SecurityError, secureParse, LIMITS };
else window.SecureJSON = { SecurityError, secureParse, LIMITS };
