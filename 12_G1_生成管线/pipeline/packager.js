'use strict';
/* G1 M2 · 纯数据组装器（曦指令：只做数据 JSON 的整理和封装，不进 Runtime 执行阶段）
   输入：通过全部闸门的候选信封 + 元数据
   输出：产品数据包（纯 JSON 文本 + 元数据清单），供 M3 在双闸门后使用。
   不含：iframe、引擎运行、GT-2a——全部留 M3。
*/
const { validate } = require('../validator/schema-validator');
const { secureParse } = require('../security/strict-json');

/* packageCandidate(candidate, meta)
   meta: { briefId, model, promptVersion, archiveRefs: [档案文件引用] }
   返回 { ok, product } 或 { ok:false, errors }
   product = {
     format: 'grid-puzzle-product/0.1',
     data: <信封（纯数据）>,
     dataJson: <纯 JSON 文本（无任何 JS 包装）>,
     meta: <来源可追溯信息>,
     integrity: { byteLength, roundTripOk }
   }
*/
function packageCandidate(candidate, meta) {
  // 组装前再校验一次（防上游漏检；闸门串联的最后一道）
  const v = validate(candidate.mechanic, candidate.levels);
  if (!v.ok) return { ok: false, errors: v.errors };

  // 纯数据核验：JSON 往返一致 + 无 JS 包装
  const dataJson = JSON.stringify(candidate);
  let roundTripOk = false;
  try {
    roundTripOk = JSON.parse(secureParse(dataJson) && dataJson) !== undefined &&
                  JSON.stringify(JSON.parse(dataJson)) === JSON.stringify(candidate);
  } catch (e) { roundTripOk = false; }
  if (!roundTripOk) return { ok: false, errors: [{ where: 'dataJson', code: 'ROUNDTRIP_FAILED' }] };

  return {
    ok: true,
    product: {
      format: 'grid-puzzle-product/0.1',
      data: candidate,
      dataJson,
      meta: {
        brief_id: meta.briefId,
        model: meta.model,
        prompt_version: meta.promptVersion,
        archive_refs: meta.archiveRefs || [],
        packaged_at: new Date().toISOString()
      },
      integrity: { byteLength: Buffer ? Buffer.byteLength(dataJson, 'utf8') : dataJson.length, roundTripOk }
    }
  };
}

module.exports = { packageCandidate };
