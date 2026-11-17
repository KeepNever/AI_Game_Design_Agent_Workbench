/* 规则描述（DSL）· 游戏 C 碎裂地板（MU-10 新机制）—— AI 按 Brief 生成的玩法语义，全部在本数据中
   Brief：「玩家踩过某个格子后，该格子开始倒计时，两回合后会碎裂并变成不可通行区域。
          玩家需要合理规划路线，在不被封死的情况下到达出口。」
   本文件不含任何可执行逻辑：机制由 engine/dsl_runtime.js 的通用执行器解释。
   规则细节的歧义处理（待确认项）见 Spike 报告 §七·五。
   与规则模块 A/B 无任何共享机制数据。 */
const MECHANIC = {
  "dsl": "grid-puzzle/0.1",
  "title": "碎裂地板",
  "tiles": { "S": { "style": "stone" }, "E": { "style": "exit", "glyph": "出" } },
  "entities": {},
  "vars": {},
  "deny": [
    { "when": "prop(tx(),ty(),'hole')==1", "message": "塌掉的洞，过不去" }
  ],
  "enter": [
    { "when": "tchar()=='.' && prop(tx(),ty(),'crack')==0 && prop(tx(),ty(),'hole')==0",
      "effects": [ { "op": "prop.set", "prop": "crack", "value": 2 } ] }
  ],
  "turn": [
    { "forEachCell": true, "when": "prop(tx(),ty(),'crack')>1 && !(tx()==px() && ty()==py())",
      "effects": [ { "op": "prop.set", "prop": "crack", "value": 1 } ] },
    { "forEachCell": true, "when": "prop(tx(),ty(),'crack')==1 && !(tx()==px() && ty()==py())",
      "effects": [
        { "op": "prop.set", "prop": "crack", "value": 0 },
        { "op": "pit" },
        { "op": "fx", "kind": "debris" },
        { "op": "shake" },
        { "op": "log", "text": "地板碎裂了！" }
      ] }
  ],
  "win": "tchar()=='E'",
  "status": "开裂 {count_prop('crack',1)} 格 ｜ 已碎 {count_prop('hole',1)} 格 ｜ 走到『出』",
  "overlays": { "crack": { "kind": "fracture" }, "hole": { "kind": "pit" } },
  "playerArt": { "eyes": true }
};
