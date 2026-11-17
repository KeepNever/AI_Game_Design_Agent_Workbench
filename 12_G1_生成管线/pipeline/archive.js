'use strict';
/* G1 M1 · 生成档案（曦指令 4 / 八条要求第 6 条）
   每一次模型调用——无论成功、失败、重试——都自动留档。
   档案内容：brief_id、时间戳、模型、Prompt 版本、请求 messages、原始输出、
   Token 用量、时延、结果分类（parsed / contract_failed / parse_failed / http_error）、
   失败原因。密钥绝不入档（测试断言保证）。
   存储：archives/<briefId>/<时间戳>-<序号>.json
*/
const fs = require('fs');
const path = require('path');

function createArchiver(opts) {
  const dir = opts.dir;                       // archives 根目录
  const briefId = String(opts.briefId || 'brief');
  const briefDir = path.join(dir, briefId.replace(/[^\w-]/g, '_'));
  let seq = 0;

  // 洗脱密钥：任何写入前的字段过滤（防御性——调用方根本拿不到 key，这里再兜一层）
  function sanitize(entry) {
    const clone = JSON.parse(JSON.stringify(entry));
    delete clone.apiKey;
    if (clone.request) delete clone.request.apiKey;
    return clone;
  }

  function record(entry) {
    fs.mkdirSync(briefDir, { recursive: true });
    seq += 1;
    const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + String(seq).padStart(3, '0') + '.json';
    const file = path.join(briefDir, name);
    const full = Object.assign({ archived_at: new Date().toISOString(), brief_id: briefId }, sanitize(entry));
    fs.writeFileSync(file, JSON.stringify(full, null, 2), 'utf8');
    return { file, id: name.replace(/\.json$/, ''), full };
  }

  function list() {
    if (!fs.existsSync(briefDir)) return [];
    return fs.readdirSync(briefDir).filter(f => f.endsWith('.json')).sort();
  }

  // 诊断事件（区别于调用档案）：配置类问题（如无密钥）写入独立诊断区，不含任何密钥材料
  function diagnose(entry) {
    const dDir = path.join(dir, '_diagnostics');
    fs.mkdirSync(dDir, { recursive: true });
    const name = new Date().toISOString().replace(/[:.]/g, '-') + '-diag.json';
    const file = path.join(dDir, name);
    fs.writeFileSync(file, JSON.stringify(Object.assign({ diagnostic: true, archived_at: new Date().toISOString() }, entry), null, 2), 'utf8');
    return file;
  }

  return { record, list, diagnose, briefDir };
}

module.exports = { createArchiver };
