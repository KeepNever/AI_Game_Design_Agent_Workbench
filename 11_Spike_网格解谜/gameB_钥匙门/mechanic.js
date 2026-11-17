/* 规则描述（DSL）· 游戏 B 收集钥匙开启出口 —— AI 生成的玩法语义，全部在本数据中
   本文件不含任何可执行逻辑：机制由 engine/dsl_runtime.js 的通用执行器解释。
   与规则模块 A/C 无任何共享机制数据。 */
const MECHANIC = {
  "dsl": "grid-puzzle/0.1",
  "title": "收集钥匙开启出口",
  "tiles": { "D": { "style": "door" }, "E": { "style": "exit", "glyph": "出" } },
  "entities": {
    "key": {
      "style": "key",
      "pickup": [
        { "op": "var.add", "name": "keys", "value": 1 },
        { "op": "fx", "kind": "sparkle" },
        { "op": "log", "text": "拾取了钥匙（库存 {v('keys')}）" }
      ]
    }
  },
  "vars": { "keys": 0 },
  "deny": [
    { "when": "tchar()=='D' && v('keys') < prop(tx(),ty(),'door_need')", "message": "门锁着：还差 {prop(tx(),ty(),'door_need') - v('keys')} 把钥匙" },
    { "when": "tchar()=='E' && v('keys') < v('total_keys')", "message": "出口未解锁：还差 {v('total_keys') - v('keys')} 把钥匙" }
  ],
  "enter": [],
  "turn": [],
  "win": "tchar()=='E' && v('keys') == v('total_keys')",
  "status": "钥匙 {v('keys')}/{v('total_keys')} ｜ 集齐后从『出』离开",
  "overlays": {},
  "playerArt": { "eyes": true }
};
