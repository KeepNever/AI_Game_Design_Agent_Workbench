/* 规则描述（DSL）· 游戏 A 推箱到目标点 —— AI 生成的玩法语义，全部在本数据中
   本文件不含任何可执行逻辑：机制由 engine/dsl_runtime.js 的通用执行器解释。
   与规则模块 B/C 无任何共享机制数据。 */
const MECHANIC = {
  "dsl": "grid-puzzle/0.1",
  "title": "推箱到目标点",
  "tiles": { "o": { "style": "target" } },
  "entities": { "box": { "style": "crate", "pushable": true } },
  "vars": {},
  "deny": [],
  "enter": [],
  "turn": [],
  "win": "count_on('box','o') == count_tile('o')",
  "status": "箱子就位 {count_on('box','o')}/{count_tile('o')} ｜ 把箱子推到红框里",
  "overlays": {},
  "playerArt": { "eyes": true }
};
