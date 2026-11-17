/* 规则描述（DSL）· 游戏 D 开关闸门（Brief D · 受控一次性生成测试）
   —— AI 按 Brief 生成的玩法语义，全部在本数据中。

   Brief：「地上有两种踏板：开门踏板与关门踏板。踩到开门踏板，同组的闸门会打开
          并保持打开；踩到关门踏板，同组的闸门会关闭并保持关闭。关着的闸门不能
          通过。合理规划踩踏板的顺序与路线，抵达出口获胜。」

   本文件不含任何可执行逻辑：机制由 engine/dsl_runtime.js 的通用执行器解释。
   规则细节的歧义决定与逐次尝试记录见 生成档案_BriefD_一次性生成.md。
   与规则模块 A/B/C 无任何共享机制数据：本机制不使用实体（pickup/pushable）、
   不使用倒计时，只组合 enter 规则 + 全局变量 + deny——与 A（推动位移）、
   B（拾取库存）、C（倒计时地形）在 DSL 词汇的使用区域上互不重叠。 */
const MECHANIC = {
  "dsl": "grid-puzzle/0.1",
  "title": "开关闸门",
  "tiles": { "G": { "style": "door" }, "H": { "style": "door" }, "E": { "style": "exit", "glyph": "出" } },
  "entities": {},
  "vars": { "ga": 0, "gb": 0 },
  "deny": [
    { "when": "tchar()=='G' && v('ga')==0", "message": "A组闸门关着——踩『开门踏板 a』才能通过" },
    { "when": "tchar()=='H' && v('gb')==0", "message": "B组闸门关着——踩『开门踏板 b』才能通过" }
  ],
  "enter": [
    { "when": "tchar()=='a' && v('ga')==0",
      "effects": [ { "op": "var.add", "name": "ga", "value": 1 }, { "op": "fx", "kind": "sparkle" }, { "op": "log", "text": "A组闸门开启" } ] },
    { "when": "tchar()=='x' && v('ga')==1",
      "effects": [ { "op": "var.sub", "name": "ga", "value": 1 }, { "op": "shake" }, { "op": "log", "text": "A组闸门关闭" } ] },
    { "when": "tchar()=='b' && v('gb')==0",
      "effects": [ { "op": "var.add", "name": "gb", "value": 1 }, { "op": "fx", "kind": "sparkle" }, { "op": "log", "text": "B组闸门开启" } ] },
    { "when": "tchar()=='y' && v('gb')==1",
      "effects": [ { "op": "var.sub", "name": "gb", "value": 1 }, { "op": "shake" }, { "op": "log", "text": "B组闸门关闭" } ] }
  ],
  "win": "tchar()=='E'",
  "status": "A组闸门 {v('ga')} ｜ B组闸门 {v('gb')}（1=开 0=关）｜ 踏板：a/b=开  x/y=关",
  "playerArt": { "eyes": true }
};
