'use strict';
/* G1 M3 · 可信 DSL Runtime 接入桥（曦 M3 第一步）
   职责：
   - 生成数据（mechanic/levels）只允许作为 JSON 输入进入 Runtime——进桥前强制纯数据断言
     （无函数/无可执行构造）+ Schema 校验闸门（M2）；
   - Runtime 本体为可信一方引擎（vm 沙箱加载，沿用 M2 求解器已验证的加载模式）；
   - 桥不执行任何模型生成代码——生成物只是喂给 DSLRules 工厂的纯 JSON。
*/
const { validate } = require('../validator/schema-validator');

// 纯数据断言：生成数据中不得出现任何函数（生成物只是 JSON 数据——曦 M3 硬规则）
function assertPureData(obj, where, failures) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'function') failures.push({ where: where + '.' + k, code: 'NOT_PURE_DATA' });
    else assertPureData(v, where + '.' + k, failures);
  }
}

/* prepareGame(runtimeApi, mechanic, levels)
   runtimeApi = { DSLRules, errProbe }（validator/solver.loadRuntime 产物）
   返回 { ok:true, DSLRules, errProbe } | { ok:false, gate, errors } */
function prepareGame(runtimeApi, mechanic, levels) {
  const failures = [];
  assertPureData({ mechanic, levels }, '$', failures);
  if (failures.length) return { ok: false, gate: 'pure-data', errors: failures };

  const v = validate(mechanic, levels);
  if (!v.ok) return { ok: false, gate: 'schema', errors: v.errors };

  // Runtime 只接收纯 JSON 数据（DSLRules 工厂消费 mechanic/levels 对象——无求值路径）
  return { ok: true, DSLRules: runtimeApi.DSLRules, errProbe: runtimeApi.errProbe };
}

module.exports = { prepareGame, assertPureData };
