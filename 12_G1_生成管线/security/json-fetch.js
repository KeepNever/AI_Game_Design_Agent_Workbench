'use strict';
/* M0 安全层 · 受限 JSON 拉取（大小限制先于解析）
   三道顺序（曦审阅口径：限制必须发生在 res.json() 解析之前）：
   1. Content-Length 头先行检查——超限直接拒绝，body 一个字节都不读；
   2. 流式读取（reader.read() 循环）逐块累计字节——超限立即 cancel，绝不完整读取；
   3. 以上全过，才 JSON.parse。
   双端 UMD：Node（单测，用假 Response）/ 浏览器（host-bootstrap 实际数据通道）。
*/
var MAX_BYTES = 256 * 1024;   // 与 strict-json 的产物总字节上限对齐

function limitError(detail) {
  var e = new Error('PAYLOAD_TOO_LARGE' + (detail ? ' (' + detail + ')' : ''));
  e.code = 'PAYLOAD_TOO_LARGE';
  return e;
}

function concatBytes(chunks, total) {
  var all = new Uint8Array(total), off = 0;
  chunks.forEach(function (c) {
    var u = ArrayBuffer.isView(c) ? new Uint8Array(c.buffer, c.byteOffset, c.byteLength) : new Uint8Array(c);
    all.set(u, off); off += u.byteLength;
  });
  return all;
}

async function readJsonCapped(response, maxBytes) {
  maxBytes = maxBytes || MAX_BYTES;

  // 1. 头部快筛：超限不读 body
  var cl = response.headers && response.headers.get ? response.headers.get('content-length') : null;
  if (cl !== null && +cl > maxBytes) throw limitError('content-length ' + cl + ' > ' + maxBytes);

  // 2. 流式读取：逐块计数，超限即 cancel
  if (response.body && response.body.getReader) {
    var reader = response.body.getReader();
    var chunks = [], total = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      total += r.value.byteLength;
      if (total > maxBytes) {
        try { reader.cancel(); } catch (e) { /* 已取消即为目的 */ }
        throw limitError('stream @ ' + total + ' bytes（解析前中止，未完整读取）');
      }
      chunks.push(r.value);
    }
    // 3. 读取完且未超限，才解析
    return JSON.parse(new TextDecoder().decode(concatBytes(chunks, total)));
  }

  // 兼容无流式能力的环境：全读文本 → 先查长度 → 再解析（限制仍先于解析）
  var text = await response.text();
  if (text.length > maxBytes) throw limitError('text length ' + text.length);
  return JSON.parse(text);
}

var api = { readJsonCapped: readJsonCapped, MAX_BYTES: MAX_BYTES };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else window.JsonFetch = api;
