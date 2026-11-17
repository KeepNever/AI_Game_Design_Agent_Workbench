'use strict';
/* M0 安全层 · 数据契约守卫（安全级，非完整 Schema——完整校验属 M2）
   只拒绝"结构性非法"：信封键/版本/类型/规模。
   不审查文本内容：合法字段里的可疑字符串不拒绝，由展示层惰性化。
   双端 UMD：Node（管线/测试，require strict-json）/ 浏览器（游戏帧复检，依赖 window.SecureJSON 先加载）。
*/
(function () {
  var SecurityError;
  if (typeof module !== 'undefined' && module.exports) {
    SecurityError = require('./strict-json').SecurityError;
  } else {
    SecurityError = window.SecureJSON.SecurityError;   // 浏览器端：strict-json.js 必须先加载
  }

  var ENVELOPE_KEYS = { dsl_version: 1, mechanic: 1, levels: 1 };
  var DSL_VERSION = 'grid-puzzle/0.1';
  var STRING_CAP = 64 * 1024;
  var ARRAY_CAP = 4096 + 16;

  function checkEnvelope(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new SecurityError('BAD_ENVELOPE');
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (!ENVELOPE_KEYS[k]) throw new SecurityError('UNKNOWN_ENVELOPE_KEY', k);
    }
    if (obj.dsl_version !== DSL_VERSION) throw new SecurityError('BAD_DSL_VERSION', String(obj.dsl_version));
    if (obj.mechanic === null || typeof obj.mechanic !== 'object' || Array.isArray(obj.mechanic)) throw new SecurityError('BAD_MECHANIC');
    if (!Array.isArray(obj.levels) || obj.levels.length === 0) throw new SecurityError('BAD_LEVELS');
    obj.levels.forEach(checkLevelShape);
    sizeCap(obj, '$', 0);
    return true;
  }

  function checkLevelShape(lv, i) {
    var p = 'levels[' + i + ']';
    if (lv === null || typeof lv !== 'object' || Array.isArray(lv)) throw new SecurityError('BAD_LEVEL', p);
    if (typeof lv.name !== 'string' || lv.name.length === 0) throw new SecurityError('BAD_LEVEL_NAME', p);
    if (!Array.isArray(lv.map) || lv.map.length === 0) throw new SecurityError('BAD_MAP', p);
    lv.map.forEach(function (row, r) {
      if (typeof row !== 'string') throw new SecurityError('BAD_MAP_ROW', p + '.map[' + r + ']');
      if (row.length > ARRAY_CAP) throw new SecurityError('ROW_TOO_LONG', p + '.map[' + r + ']');
    });
  }

  function sizeCap(node, path, depth) {
    if (depth > 64) throw new SecurityError('DEPTH_TOO_DEEP', path);
    if (typeof node === 'string') {
      if (node.length > STRING_CAP) throw new SecurityError('STRING_TOO_LONG', path);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.length > ARRAY_CAP) throw new SecurityError('ARRAY_TOO_LONG', path);
      node.forEach(function (v, i) { sizeCap(v, path + '[' + i + ']', depth + 1); });
      return;
    }
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      sizeCap(node[k], path + '.' + k, depth + 1);
    }
  }

  var api = { SecurityError: SecurityError, checkEnvelope: checkEnvelope, DSL_VERSION: DSL_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DataGuard = api;
})();
