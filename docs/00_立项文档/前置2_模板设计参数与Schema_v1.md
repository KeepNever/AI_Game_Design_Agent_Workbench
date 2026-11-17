# S4 前置 2 · 模板设计参数清单与 Schema v1（网格解谜品类 grid-puzzle）

> 建立：2026-11-12　|　v1.1：同日静态核对首跑后修正必填性与功能字符定义（见 §八）　|　v1.2：2026-11-12 曦审阅意见九条修订（Effect 9 op / 内建 12 函数 / 保留字符补 `.` / `p` 三层口径 / dynamic 可省略 / 模板-Runtime 边界 / 统计口径 / presentation 职责 / 初始态待验证项，见文末修订记录）　|　**v1.2.1：同日曦验收通过后的轻量修订（MU-10/Brief D 证据表述限定 / 格式清理 / 验收结论记录）并正式收口**　|　依据：曦前置 2 工作指令（八条）+ v1.2 审阅意见（九条）+ v1.2.1 验收意见
> 工作方式：先盘点现有字段与运行时契约 → 抽象分层 Schema → 建立映射 → 只读静态兼容性核对（脚本见 `11_Spike_网格解谜/tools_schema_check.py`，核对输出见 §九）
> 边界：本文只做文档与设计，不启动 G1，不修改运行时代码、DSL、RulePack、原型与冻结数据。**提交审阅，不自行宣布通过。**

---

## 一、现状盘点（事实底座）

### 1.1 引擎 rules 契约（grid_engine.js 消费面，8 方法）

| 方法 | 签名 | 必需性 | 职责 |
|---|---|---|---|
| init | (level, index) → state | 必需 | 初始化状态 |
| tryMove | (state, dir, level) → {moved, state, events} | 必需 | 回合推进（唯一玩法语义入口） |
| isWin | (state, level) → bool | 必需 | 胜利判定 |
| status | (state, level) → string | 必需 | HUD 状态行 |
| drawStaticChar | (ctx, ch, px, py, T) | 可选 | 静态格绘制 |
| drawDynamic | (ctx, state, T, now, dt, level) | 可选 | 逐帧动态绘制 |
| onWin | (state, level) | 可选 | 通关特效 |
| getShake | (now) → [dx,dy] \| null | 可选 | 震屏 |

### 1.2 DSL Runtime 消费的 MECHANIC 字段（12 个，全部被消费）

`dsl` `title` `tiles` `entities` `vars` `enter` `deny` `turn` `win` `status` `overlays` `playerArt`

### 1.3 Level 数据字段（6 个）

`name` `map` `player` `dynamic` `vars`(可选) `cell_props`(可选)

### 1.4 四机制实例使用矩阵（静态盘点实测，脚本输出）

| 维度 | A 推箱 | B 钥匙门 | C 碎裂地板 | D 开关闸门 |
|---|---|---|---|---|
| tiles 字符 | o | D, E | E, S | E, G, H（H 声明未用，合法） |
| entities | box（pushable） | key（pickup） | 无 | 无 |
| mechanic.vars | 无 | keys | 无 | ga, gb |
| level.vars | 无 | total_keys | 无 | 无 |
| enter 规则 | 无 | 无 | 1 条 | 4 条 |
| turn 规则 | 无 | 无 | 2 条（forEachCell） | 无 |
| deny 规则 | 无 | 2 条 | 1 条 | 2 条 |
| effects 算子 | 无 | var.add, fx, log | prop.set, pit, fx, log, shake | var.add, var.sub, fx, log, shake |
| overlays | 无 | 无 | crack→fracture, hole→pit | 无 |
| win 表达式 | count_on 计数 | tchar + var | tchar | tchar |
| 关卡数 | 2 | 2 | 2 | 2 |
| 地图字符集 | #.o | #.DE | #.ESp | #.EGapx |

**盘点发现的三处口径细节**（Schema 必须明确）：
1. **`p` 字符三层口径（v1.2 修正：区分 Runtime 事实 / 设计约定 / 待验证，不得把待决规则写成已冻结约束）**：仅 C 的地图使用了 `p` 字符。
   - **Runtime 实际行为**：`init` 只读 `level.player`（`player: { ...level.player }`），map 中 `p` 完全不被 runtime 读取，引擎与 runtime 均无一致性校验——这是实测事实；
   - **当前设计约定**：`p` 为可选视觉标记，约定与 `player` 坐标一致；静态核对在两者不一致时输出**提示级**警告（不判失败）；
   - **待验证**：是否在 G1 校验器中升格为强制校验（**V-2.1**）——G1 决定之前，本文只将其表述为约定，不写成强制约束。
2. **tiles 声明未用**：D 声明了 H 但关卡未使用——合法状态，Schema 定为允许（声明集 ⊇ 使用集），不报错。
3. **vars 双层声明**：B 的 `total_keys` 只在 level.vars 声明、`keys` 在 mechanic.vars 声明，runtime 合并语义为 `Object.assign(mechanic.vars, level.vars)`（**level 覆盖 mechanic**）——Schema 定为两层均可声明，level 优先。

## 二、模板设计参数清单（品类模板的可配置维度）

参数分三类来源。**来源定义**：`引擎原语` = 预置能力（任何游戏都用，不可被 Brief 改变语义）；`Brief 参数` = 从用户 Brief 映射的设计决策；`AI 生成` = 策划/规则 Agent 按 Brief 组合产出。

### 2.1 品类固定参数（引擎原语——不进 Schema 可变区，只登记）

| 参数 | 固定值 | 说明 |
|---|---|---|
| 移动方式 | 四方向、回合制、逐格 | grid_engine 决定 |
| 玩家数 | 单人 | — |
| 视角 | 单屏俯视网格 | — |
| 交互 | 键盘方向键/WASD、Z 撤销、R 重开、autoplay 重放 | — |
| 基础地形 | `#` 墙（不可通行）、`.` 缺省地板 | 字符约定 |
| 运行环境 | 浏览器（HTML/JS 单文件族） | — |

### 2.2 每游戏可变参数（Brief → AI 生成的决策空间）

| 参数 | 类型 | 来源 | 说明 |
|---|---|---|---|
| 玩法机制（核心规则） | 结构化机制描述 | Brief 参数 → AI 生成 | 落为 mechanic 的 rules 三类 |
| 实体系统 | 实体类型集 | Brief 参数 → AI 生成 | 推动类 / 拾取类 / 无 |
| 状态变量集 | 变量名与初值 | AI 生成 | 全局状态 |
| 胜利条件 | 条件表达式 | Brief 参数 → AI 生成 | 每游戏一条 |
| 失败/阻挡规则 | deny 规则集 | AI 生成 | 闸门、洞、条件出口等 |
| 地形语义 | tiles 字符与样式 | AI 生成 | 石板、门、出口等 |
| 关卡布局 | map / 实体摆放 / 逐关变量 | Brief 参数 → AI 生成（可解性验证把关） | levels |
| 表现选项 | playerArt、粒子、glyph | AI 生成（可在 Brief 风格约束下） | 不影响判定 |

### 2.3 已验证实例 = 归纳样本，不是封闭枚举（曦指令 5）

上表的可变参数维度是从 A/B/C/D **归纳**的。四机制的差异证明了这些维度的组合空间（推动位移 / 拾取库存 / 倒计时地形 / 可逆闩锁分属不同组合），但 Schema **不把四种组合注册为枚举**——新机制 = 在同一组原语词汇上的新组合。判定标准写死：**新 Brief 生成物只要通过本 Schema 校验 + 运行时执行 + 可解性验证，即为合法新玩法，无论它是否像 A/B/C/D 中的任何一个**。

**证据边界（v1.2.1 限定，曦验收意见 1）**：「MU-10 已验证一次成文可行」指 **Spike 阶段的受控一次性生成验证**（人工受控流程、单样本）；它证明的是技术可行性，**不代表产品内 Brief → 模型调用 → DSL 生成的自动管线已经建成**——后者属 G1 生成链路建设与验证范围（对应三层口径中的第三层）。

## 三、通用游戏设计参数 Schema（品类模板层）

```json
GridPuzzleTemplate {
  "category": "grid-puzzle",            // 品类 ID（必填，常量）
  "dsl_version": "grid-puzzle/0.1",     // 机制 DSL 版本（必填）
  "engine_contract": "grid-engine/rules-v1",  // 引擎契约版本（必填）
  "fixed_params": {                     // 品类固定参数（§2.1，只读登记）
    "movement": "4-dir turn-based",
    "players": 1,
    "view": "single-screen top-down grid",
    "base_tiles": { "#": "wall", ".": "floor-default" },
    "runtime": "browser"
  },
  "variable_params": {                  // 每游戏可变维度（§2.2，由 AI 填充）
    "mechanic":  "MechanicDSL",         // → §五（Runtime 消费对象：DSLRules(dsl, levels) 第一参数）
    "levels":    "LevelData[]",         // → §四（Runtime 消费对象：DSLRules 第二参数）
    "presentation": { "tile_size": 48 } // 页面装配层配置，非 MechanicDSL 字段：由 index.html 实例化时传入 grid_engine 的 cfg.tile（grid_engine.js L23 `const T = cfg.tile || 44`，引擎缺省 44；gameA 实配 48）。
                                        // ⚠ v1.2 修正：player_eyes 从 presentation 移除——玩家眼睛由 MechanicDSL.playerArt.eyes 承载（runtime 消费 dsl.playerArt.eyes，dsl_runtime.js L414），presentation 不与 playerArt 职责重叠。
                                        //   职责划分：presentation = 页面装配/渲染配置（引擎消费）| playerArt = 机制数据内的玩家外观（runtime 消费）
  }
}
```

约束：`variable_params` 的填充必须通过 §五 MechanicDSL 与 §四 LevelData 的校验；**Schema 不约束机制的内容语义**（那是 Brief 的事），只约束结构与词汇合法性。

**模板封装对象与 Runtime 消费对象的边界（v1.2 补充，曦审阅意见 6）**：
- **GridPuzzleTemplate** = 策划 Agent 的**封装/交付/校验闸门对象**（含 category / dsl_version / engine_contract / fixed_params / variable_params 外壳字段）；
- **Runtime 消费对象** = 解包后的 `MechanicDSL`（`DSLRules(dsl, levels)` 第一参数，版本断言在函数首行、针对 `mechanic.dsl`）与 `LevelData[]`（第二参数）；
- 外壳字段 **runtime 不读取**：`dsl_version` 必须与 `mechanic.dsl` **同值**（`"grid-puzzle/0.1"`，模板层同值校验职责）；`engine_contract` 指向页面装配层选用的引擎契约；`presentation.tile_size` 经页面实例化传入 `cfg.tile`，不进 MechanicDSL；
- 字段映射见 §六「模板封装边界」行。

## 四、关卡数据 Schema（LevelData）

| 字段 | 类型 | 必填 | 默认 | 合法范围 / 约束 | 来源 |
|---|---|---|---|---|---|
| `name` | string | ✅ | — | 非空；展示用 | Brief 参数 / AI 生成 |
| `map` | string[] | ✅ | — | 非空；**矩形**（所有行等长）；每字符 ∈ `{'#'}` ∪ `tiles` 键集 ∪ `{'.'}` ∪ 可选 `p` ∪ **规则引用的功能字符**（如 D 的踏板 a/x——可免 tiles 样式声明，视觉走缺省地板，静态核对降为提示级；推荐声明以获得视觉语义）；行数 × 行长 ≤ 4096 | AI 生成，BFS 可解性验证把关 |
| `player` | {x:int, y:int} | ✅ | — | 界内且 `map[y][x] != '#'`（runtime 唯一读取的初始位置来源：`init` 直接取 `level.player`，不读 map 中 `p`——Runtime 事实）。"与 map 中 `p`（若存在）位置一致" = **设计约定**（静态核对提示级），是否升格强制校验 = 待验证项 V-2.1，非已冻结约束 | AI 生成 |
| `dynamic` | {type, x, y}[] | ❌ 可省略 | `[]` | **Runtime 实际缺省处理 `(level.dynamic \|\| [])`——可省略、缺省空数组**（v1.2 按实装修正：不是"必填但允许空数组"）。`type` ∈ mechanic.entities 键集、坐标界内且非墙 = 静态校验层约束（runtime 对未声明 type 走空实体定义：不可推、不可拾取的阻挡物）；初始态重叠/冲突等未明确约束只登记不补造（V-2.6 / V-2.7） | AI 生成 |
| `vars` | {string: number} | ❌ | `{}` | 键为变量名；**覆盖 mechanic.vars 同名初值**（runtime 合并语义：level 优先） | AI 生成（逐关参数） |
| `cell_props` | {"x,y": {prop: value}} | ❌ | `{}` | 键格式 `x,y`；坐标界内；值类型与 mechanic 中该 prop 的用法一致（如 door_need 为正整数）——**用法一致性由规则表达式隐式约定，静态校验只查格式（待验证项 V-2.2）** | AI 生成 |

## 五、机制 DSL Schema（MechanicDSL，grid-puzzle/0.1）

### 5.1 顶层字段（12 个，全部被 runtime 消费）

| 字段 | 类型 | 必填性 | 缺省 | 约束 | 来源 |
|---|---|---|---|---|---|
| `dsl` | string | **核心必填** | — | == `"grid-puzzle/0.1"` | 品类常量 |
| `title` | string | **核心必填** | — | 非空 | Brief 参数 |
| `win` | expr | **核心必填** | — | 表达式，focus = 玩家格；true 即胜 | Brief 参数 → AI 生成 |
| `status` | 模板字符串 | **核心必填** | — | `{expr}` 占位符 | AI 生成 |
| `tiles` | {char: TileDef} | 可省略 | `{}` | 键 = 单个非保留字符；**保留字符 `#` / `.` / `p` 均不得作为自定义 tiles 键**（v1.2 补 `.`：引擎对 `#`/`.` 特判绘制——恒画墙 / 恒画缺省地板，不调用 drawStaticChar，样式声明不会被消费；且 `.` 若声明 solid 仍会进入推动阻挡判定，属易误导的半消费状态。`p` 为玩家位置标记保留字符，见 §一·1.4/§四）；TileDef 见 5.2。**功能字符可免声明**（见 5.7） | AI 生成 |
| `entities` | {type: EntityDef} | 可省略 | `{}` | type 命名 `[a-z_]`；EntityDef 见 5.3 | AI 生成 |
| `vars` | {string: number} | 可省略 | `{}` | 初值；可被 level.vars 覆盖 | AI 生成 |
| `enter` | Rule[] | 可省略 | `[]` | 玩家进入格子时逐条求值（**顺序求值**——组合时须避免同格条件互相触发，D 的闩锁对是安全范例） | AI 生成 |
| `deny` | DenyRule[] | 可省略 | `[]` | 移动前对目标格求值；命中即拦截 | AI 生成 |
| `turn` | TurnRule[] | 可省略 | `[]` | 每回合提交时执行；forEachCell 时逐格求 when | AI 生成 |
| `overlays` | {prop: {kind}} | 可省略 | `{}` | kind ∈ {fracture, pit}（已知边界 L-4） | AI 生成 |
| `playerArt` | {eyes: bool} | 可省略 | `{}` | 表现层 | 风格参数 |

**必填性依据（v1.1 修正）**：runtime 对可省略字段均有缺省容错（`dsl.x \|\| 空集`），D 实例省略 turn/overlays 空字段仍正常运行——静态核对首跑抓出 v1 初稿"全部必填"定义过严，**向已验证实例的实际契约对齐**（实例为事实，不改原型）。核心必填 4 字段无缺省容错，缺任一 runtime 直接异常。

### 5.2 TileDef

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `style` | string | ✅ | ∈ {target, door, exit, stone}（**预置视觉原语枚举，L-5 待扩**）；未匹配样式走缺省地板绘制 |
| `glyph` | string | ❌ | 单字符（exit 的显示字） |
| `solid` | bool | ❌ | 默认 false；true = 实心不可入（推箱阻挡判定用） |

### 5.3 EntityDef

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `style` | string | ✅ | ∈ {crate, key}（预置视觉原语枚举，L-5） |
| `pushable` | bool | ❌ | 可被推动（推箱语义） |
| `solid` | bool | ❌ | 阻挡 |
| `pickup` | Effect[] | ❌ | 进入该格时执行并移除实体（B 的钥匙语义）；**pickup 实体不阻挡移动**（runtime 行为） |

### 5.4 规则对象与效果白名单

| 规则型 | 挂载字段 | 结构 |
|---|---|---|
| enter | `enter[]` | {when: expr, effects: Effect[]} |
| turn | `turn[]` | {forEachCell?: bool, when: expr, effects: Effect[]} |
| deny | `deny[]` | {when: expr, message: 模板字符串}（无 effects） |

**Effect 白名单（9 op，v1.2 重新核对 runtime 实装修正——原"7 op"计数错误。9 个操作符按下方 6 行归类列出：var.add / var.sub / prop.set / prop.add / prop.sub / pit / fx / log / shake，超出任一即运行时报错——`DSL 未知效果`）**：

| op | 参数 | 作用目标 | 语义 |
|---|---|---|---|
| var.add / var.sub | {name, value:number} | 全局 | value 为字面量（**不可写表达式**，v3 核对确认） |
| prop.set / prop.add / prop.sub | {prop, value} | **focus 格** | 只能写焦点格属性（已知边界 L-2：无跨格写） |
| pit | 无 | focus 格 | 标记为洞（不可通行） |
| fx | {kind} | focus 格 | kind ∈ {sparkle, dust, confetti, debris, flash} |
| log | {text: 模板} | — | 事件日志 |
| shake | 无 | — | 震屏 |

### 5.5 表达式子语言

- **字面量**：数字、`'字符串'`、true/false（runtime 仅兼容小写；**无 null 字面量**——求值器不识别 null，写作 null 会抛"未知标识符"，v1.2 核对修正）；
- **运算符**：`+ - * / < > <= >= == !=`（算术与比较）、`&&`（逻辑与）、`!`（逻辑非）、**逻辑或（两根连续竖线组成的双字符运算符——为避免预览渲染误析，本文一律不直接书写该符号，符号以 dsl_runtime.js `tokenize` 实装为准）**；括号配对（**无 `%`，已知边界 L-3**）；
- **内建函数白名单（12，v1.2 计数修正——原"（10）"与所列清单不符）**：`tile(x,y)` `px()` `py()` `tx()` `ty()` `tchar()` `prop(x,y,k)` `v(k)` `count_tile(c)` `count_entity(t)` `count_on(t,c)` `count_prop(k,min)`——与 dsl_runtime.js `ctxFor().builtins` 实装逐一核对一致；
- **未知标识符 / 未知函数 / 未知效果一律抛错**（白名单三重防线）；
- **安全 LIMITS**：表达式 ≤400 字符、括号深 ≤24、单规则效果 ≤64、cellProps ≤20000、地图 ≤4096 格（runtime 实装值；聚合预算/超时/回滚为 G1 安全待办，见 Spike 报告 §11.5）；
- 表达式求值上下文：`px/py` = 玩家当前位置，`tx/ty/tchar/prop` = 规则焦点格。

### 5.7 功能字符与样式声明的关系（静态核对首跑发现）

机制规则可以用 `tchar()=='x'` 引用**未在 tiles 中声明样式**的地图字符（D 的踏板即此用法）：runtime 对未声明字符走缺省地板绘制，`tileDef(ch)` 返回空对象，**功能判定完全正常**。因此 Schema 区分两类字符：
- **样式字符**（在 tiles 声明）：有专属视觉（door/exit/stone 等）；
- **功能字符**（仅规则引用）：无专属视觉，判定靠规则表达式。
推荐样式声明以获得视觉语义，但不强制——静态核对将未声明字符降为提示级（非法域仍为失败：即完全不在任何合法集合中的字符）。

### 5.6 组合性条款（曦指令 6：支持新机制，不退化为枚举）

Schema 只约束**词汇合法性**（op 白名单、函数白名单、结构完整），**不约束机制语义的组合方式**。判定一个新机制是否合法的依据链 = ①通过本 Schema 结构校验 → ②runtime 执行无错误 → ③品类专属验证器判定可解 → ④试玩确认机制生效。四步全部通过即为合法新玩法；**没有任何一步要求新机制"类似"已注册玩法**。

**证据边界（v1.2.1 限定，曦验收意见 1）**：「Brief D 走通全链」指 **Spike 阶段受控一次性生成**（人工受控流程、单样本、§11.4 生成档案留痕）——证明组合原语路线可行，**不代表产品内 Brief → 模型调用 → DSL 生成的自动管线已建成**（自动复现性为 Spike 三关中未通过项，属 G1 建设范围）。

## 六、字段映射表（Brief → Game Design Package → Level / Mechanic DSL → Runtime）

| 层 | Brief（用户输入） | Game Design Package（策划 Agent 产出） | Level / Mechanic 落点 | Runtime 消费点 |
|---|---|---|---|---|
| 玩法机制 | 自然语言机制描述（如"踩过的格子两回合后碎裂"） | 机制结构化描述：状态变量集 / 触发条件 / 效果 | `mechanic.vars` + `turn[]`（forEachCell） | `commitTurn()` 逐格求值 → `runEffects()` |
| 移动/交互规则 | "不能通过""推不动" | 阻挡条件 | `deny[]` | `tryMove()` 移动前检查 |
| 实体与库存 | "收集钥匙""推箱子" | 实体类型与能力 | `entities{}` + `dynamic[]` | 拾取 effects / 推动判定 |
| 全局状态 | 隐含（计数、开关） | 状态变量与初值 | `vars`（双层声明） | 表达式 `v(k)` |
| 胜利条件 | "抵达出口获胜""箱子全部就位" | win 条件 | `win` 表达式 | `isWin()` 每步判定 |
| 地形语义 | "碎裂成洞""闸门" | tile 字符与样式、overlays | `tiles{}` + `overlays{}` | `drawStaticChar` / `drawDynamic` 覆盖层 |
| 数值展示 | （隐含）进度可见 | 状态行文案 | `status` 模板 | HUD statusEl |
| 关卡布局 | "合理规划路线"（数量/难度） | 关卡集 | `levels[]`（map/dynamic/vars/cell_props） | `init()` / 渲染 / BFS 验证器 |
| 表现风格 | （可选风格约束） | 玩家外观等 | `playerArt` | drawDynamic |
| 模板封装边界（v1.2 补） | —（组织层，不来自 Brief） | GridPuzzleTemplate 外壳：category / dsl_version / engine_contract / fixed_params / presentation | `dsl_version` ↔ `mechanic.dsl`（**同值** `"grid-puzzle/0.1"`）；`variable_params.mechanic` 即 MechanicDSL、`.levels` 即 LevelData[]；`presentation.tile_size` → 页面实例化 `cfg.tile` | runtime 只消费解包后的 MechanicDSL / LevelData；**外壳字段 runtime 不读取**（版本断言在 DSLRules 首行、针对 `mechanic.dsl`） |

**映射表用法**：G1 的策划 Agent 按"Brief → GDP 机制结构化描述"产出，代码生成 Agent 按"GDP → DSL/Level 落点"填充——两步各自有 Schema 校验闸门（MU-2 / MU-3），**映射表就是两个 Agent 之间的接口规格**（对应 v3.1 §二·六 Game Design Package 契约的品类实例化）。

## 七、已知限制与待验证项

### 已知表达力边界（L 系列，均有 Spike 分析依据，非臆测）

| 编号 | 边界 | 依据 | 影响 |
|---|---|---|---|
| L-1 | 无移动方向上下文（enter/turn 表达式拿不到移动方向） | Brief D 设计时分析（冰面滑行不可表达） | 修改移动语义类机制暂不可表达 |
| L-2 | 效果只作用焦点格，无跨格写 | 开关照明类案例分析 | 跨格联动需用全局 var 绕行 |
| L-3 | 表达式无 `%` 运算 | 开关闸门设计时分析（奇偶不可直接判） | 奇偶语义需用条件 add/sub 对绕行 |
| L-4 | overlays 仅 fracture/pit 两种 | runtime 实装 | 新地形视觉需扩 kind |
| L-5 | tile/entity 样式为预置枚举（target/door/exit/stone/crate/key） | runtime 实装 | 新视觉走缺省绘制，辨识度降 |

**处置**：全部登记为 **G1 DSL v0.2 的候选扩展项**，扩展原则 = 只加通用能力原语、不加玩法语义（曦红线）。**是否扩展取决于新 Brief 的实测需要，不在本前置预先实现。**

### 待验证项（V 系列，无实测依据，曦指令 7：不自行补造）

| 编号 | 待验证内容 | 验证方式 |
|---|---|---|
| V-2.1 | `map` 中 `p` 字符与 `level.player` 坐标的一致性是否升格为强制校验 | G1 Schema 校验器实装时决定（当前 runtime 不强制） |
| V-2.2 | cell_props 属性值与规则用法的类型一致性静态校验 | G1 校验器实装时决定 |
| V-2.3 | 表达式**语法级**静态校验（当前静态核对只到结构级：op 白名单/变量引用/LIMITS；语法错误由 runtime 求值时暴露——B/C 首跑各暴露过一次） | G1 决定是否前置静态语法检查（降低"拦截-重试"成本） |
| V-2.4 | 四机制归纳的可变参数维度是否覆盖首期品类全部 Brief 类型 | 持续验证：每个新 Brief 生成都是一次检验（MU-10 机制） |
| V-2.5 | Token（6K/2K）、重试率（40%）、缓存命中（30%）假设 | G1 逐次计量实测回填（前置 5 已立项） |
| V-2.6 | `dynamic` 初始数据中**多实体同格重叠**的合法性约束（runtime 不校验初始重叠：移动命中判定取首个实体、拾取会全部触发，但初始数据合法性无任何约束） | G1 校验器实装时决定是否禁止重叠或声明去重规则（本项仅登记，不自行补造强制约束） |
| V-2.7 | **玩家初始位置与实体格 / 特殊地形的初始态冲突**（玩家开局落在实体上、坑上或未声明功能格：runtime 不校验初始态，直接以该状态开局） | G1 校验器实装时决定初始态合法性规则（本项仅登记，不自行补造强制约束） |

## 八、静态兼容性核对结果（曦指令 8：只检查，不修改）

核对脚本：`11_Spike_网格解谜/tools_schema_check.py`（**只读**，不写任何原型文件），对四机制八关卡执行结构级校验（DSL 版本/字段完整性/白名单/表达式 LIMITS/交叉引用/地图约束）。

**首轮结果（133 通过 / 3 失败 / 0 提示）——3 处失败全部是 Schema v1 初稿定义与实证契约的偏差，不是实例错误**：
1. D 缺 `turn`/`overlays` 字段仍正常运行 → runtime 有缺省容错 → §5.1 必填性修正为两档（v1.1）；
2/3. D 的踏板字符 a/x 未声明 tiles 样式但功能正常 → 功能字符可免样式声明 → §四 map 约束与 §5.7 修正。

**修正后复跑（脚本实跑输出，2026-11-12 复核确认）：138 通过 / 0 失败 / 2 提示**——2 条提示均为合法状态：D 两关的功能字符 a/x 无样式声明（§5.7 功能字符约定）。实例零不兼容，Schema 修正两处向实证契约对齐。完整逐项输出可复跑 `python tools_schema_check.py` 查看。

**统计口径（v1.2 补，曦审阅意见 7：明确用例数 / 断言数 / 通过数 / 提示数的关系）**：
- **核对对象（用例）** = 4 机制 + 8 关卡 = **12 个**；
- **检查点（断言级）** = **140 个** = 通过 **138** + 失败 **0** + 提示 **2**；各机制段检查点数随规则 / 表达式数量浮动（A 21 / B 30 / C 40 / D 47，合计 138 通过）；
- **提示（⚠）不计入失败**：2 条提示 = D 两关 a/x 功能字符无样式声明（合法状态，见 §5.7），该两关的"字符集合规"检查点以提示形式落地、而非通过；
- **两轮数字不可直接对比**：首轮由脚本早期版本产出（检查点合计 133+3=136）；v1.1 修正时脚本判定分支同步调整（必填性两档化、未声明功能字符降为提示级），复跑以现行脚本为准（138+0+2=140）；
- **§九早前标注的"32/32"口径撤销**：无法与脚本输出对应（候选组合 8 关卡×4 断言=40、4 机制+8 关卡=12 均不匹配），判定为统计口径错误，统一以脚本实跑数字为准；
- **脚本对齐事项**：脚本 tiles 保留字符检查面当前为 {#, p}（map 字符集检查面为 {#, ., p}），与本文 §5.1 的 {#, ., p} 定义尚差一项——本次按"只修正文档"指令不动脚本，登记为对齐事项（四机制无一声明 tiles['.']，复跑结果不受影响，已核实）。

## 九、前置 2 验收记录（提交审阅，不自宣布通过）

| 交付项 | 状态 |
|---|---|
| 模板设计参数清单 | ✅ §二 |
| 通用游戏设计参数 Schema | ✅ §三 |
| 关卡数据 Schema | ✅ §四 |
| 机制 DSL Schema | ✅ §五 |
| 字段映射表 | ✅ §六 |
| 已知限制与待验证项 | ✅ §七（L-1~L-5 / V-2.1~V-2.7） |
| 静态兼容性核对 | ✅ §八 + `tools_schema_check.py`（只读；核对对象 12，检查点 140 = 通过 138 / 失败 0 / 提示 2） |

**自查声明**：①A/B/C/D 按指令未固化为枚举（§2.3 判定标准写死）；②组合性条款在 §5.6（Schema 只管词汇合法性，不管语义组合）；③无实测依据的约束全部落在 V 系列，未自行补造；④未修改任何运行时代码、DSL、原型与冻结数据（唯一改动文件 = 本文档；只读校验脚本本次按指令未动）。

**规范定位声明（v1.2，曦 2026-11-12 审阅意见）**：本文档是**设计级 Schema 规范**；当前 `tools_schema_check.py` 只完成既有四机制八关的**静态兼容性检查**（结构级、只读），**不代表 G1 产品级校验器已经实现**——表达式语法级校验、可解性验证、生成链路校验均属 G1 建设范围（V-2.3 等）。静态核对通过 ≠ 校验器建成。

**验收结论（2026-11-12，曦）**：✅ **前置 2 通过设计级文档验收**——九项修订全部确认，整体质量达到前置 2 预期，不再扩大本轮 Schema 范围。验收边界 = 设计级 Schema 规范及现有实例的静态兼容性检查，不代表 G1 产品级校验器已实现。遗留三个轻量事项（MU-10/Brief D 证据表述限定 → 已随 v1.2.1 处理；脚本对齐缺口 {#,p} vs {#,.,p} → 维持 §八留档、脚本未动；空表格渲染残留 → 已随 v1.2.1 清理）**不阻塞前置 3**。本文档收口，后续仅按修订记录追加，不再持续打磨。

---

## 修订记录

- **v1.2.1（2026-11-12，曦验收意见轻量修订 + 收口）**：
  1. §2.3 / §5.6 补 MU-10 与 Brief D 证据表述限定：Spike 阶段受控一次性生成验证 ≠ 产品内自动管线已建成（对齐三层口径）；
  2. §5.5 运算符清单改为围栏块、修订记录第 5 条去掉内联双竖线代码引用——清理预览渲染器把裸双竖线误析为空表格的格式残留（根因：全文档仅这两处存在围栏外的裸双竖线；修复时修订记录描述行自身的双竖线引用也已一并清除）。**终版形态（曦验收复核后定稿）：改用自然语言描述——首版修复所用围栏因缩进在列表项内、部分渲染器不识别，显示层仍有裸双竖线；现全段零竖线字符，任何渲染器无歧义，逻辑或符号以 dsl_runtime.js `tokenize` 实装为准**；
  3. 脚本对齐缺口（tiles 保留字符检查面 {#, p} vs Schema {#, ., p}）维持 §八留档，脚本未改动；
  4. §九记录曦验收结论：**前置 2 通过设计级文档验收**，文档收口。
- **v1.2（2026-11-12，曦审阅意见九条）**：
  1. §5.4 Effect 白名单计数修正：**9 op**（原"7 op"计数错误），与 dsl_runtime.js `runEffects` switch 实装逐一核对一致；
  2. §5.5 内建函数计数修正：**12 个**（原"（10）"与所列清单不符），与 `ctxFor().builtins` 实装核对一致；顺带修正字面量定义（无 null 字面量，附加核对发现）；
  3. §5.1 tiles 保留字符补 `.`：`#` / `.` / `p` 均不得作为自定义 tiles 键（引擎对 `#`/`.` 特判绘制，依据 grid_engine.js L77–85）；
  4. `p` 字符一致性改为三层口径（§一·1.4 / §四 player 行）：Runtime 事实（不读 map 的 p）/ 设计约定（提示级）/ 待验证（V-2.1），不再写成已冻结强制约束；
  5. §四 `dynamic` 必填性修正：**可省略、缺省 `[]`**（runtime 对该字段缺失时按空数组缺省处理，完整表达式见 §四 `dynamic` 行），不再是"必填 + 默认 []"的矛盾表述；
  6. §三 / §六 补 GridPuzzleTemplate.dsl_version ↔ MechanicDSL.dsl 字段映射与封装边界（外壳字段 runtime 不读取）；
  7. §八补统计口径（对象 12 / 检查点 140 = 138+0+2），撤销 §九"32/32"错误口径，披露两轮检查点总数差异原因；
  8. §三 presentation 修正：移除 player_eyes（职责归 playerArt.eyes），tile_size 核对为装配层配置（cfg.tile，引擎缺省 44，非 MechanicDSL 字段）；
  9. §七新增 V-2.6（实体初始重叠）/ V-2.7（玩家初始位置冲突）——仅登记，不补造规则；文末新增规范定位声明（设计级 Schema，静态检查 ≠ G1 校验器）。
- **v1.1（2026-11-12）**：静态核对首跑后修正必填性两档化（D 省略空字段合法）与功能字符可免样式声明（§5.7 新增）。
- **v1.0（2026-11-12）**：初版。

**前置 2 已验收通过（2026-11-12），本文档收口。下一阶段 = 前置 3 可玩性 GT 判定标准；不再扩展 DSL，不启动 G1 编码。**
