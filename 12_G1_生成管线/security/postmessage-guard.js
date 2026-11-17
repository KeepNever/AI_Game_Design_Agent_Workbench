'use strict';
/* M0 安全层 · iframe 消息通信校验（双方向）
   游戏帧为 opaque origin → origin 恒为 "null"，无法用 origin 白名单。
   替代防线：来源校验（ev.source）+ 形状白名单 + 类型/字段/长度校验。
   两个方向分开定义：
   - hostToGame：宿主 → 游戏帧（唯一类型：pipeline:data，data 必须是对象）
   - gameToHost：游戏帧 → 宿主（win/log/state/error）
   不合规消息：静默丢弃并返回原因；宿主与游戏帧均不得因恶意消息抛错或执行。
*/
const MESSAGE_DIRECTIONS = {
  hostToGame: {
    'pipeline:data': { fields: { data: 'object' } }
  },
  gameToHost: {
    'game:win':   { fields: {} },
    'game:log':   { fields: { msg: 'string' } },
    'game:state': { fields: { level: 'number', moves: 'number' } },
    'game:error': { fields: { code: 'string' } }
  }
};
const MAX_STR = 4 * 1024;

function validateMessage(direction, ev, expectedSource) {
  const specTable = MESSAGE_DIRECTIONS[direction];
  if (!specTable) return { ok: false, reason: 'BAD_DIRECTION' };
  if (expectedSource && ev.source !== expectedSource) return { ok: false, reason: 'SOURCE_MISMATCH' };
  const d = ev.data;
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return { ok: false, reason: 'BAD_SHAPE' };
  const spec = specTable[d.type];
  if (!spec) return { ok: false, reason: 'UNKNOWN_TYPE' };
  for (const k of Object.keys(d)) {
    if (k !== 'type' && !(k in spec.fields)) return { ok: false, reason: 'UNKNOWN_FIELD:' + k };
  }
  for (const [k, want] of Object.entries(spec.fields)) {
    const v = d[k];
    if (typeof v !== want) return { ok: false, reason: 'BAD_FIELD:' + k };
    if (typeof v === 'string' && v.length > MAX_STR) return { ok: false, reason: 'FIELD_TOO_LONG:' + k };
  }
  return { ok: true, type: d.type, data: d };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { validateMessage, MESSAGE_DIRECTIONS, MAX_STR };
else window.PMGuard = { validateMessage, MESSAGE_DIRECTIONS };
