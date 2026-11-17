# -*- coding: utf-8 -*-
"""S3 竞品矩阵 v2：按用户纠正修订（articy 模拟能力、Inworld 迁移、Summer 可测、ToolsFYI 待核实）"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

P = r"D:/workbuddy/AI_Game_Design_Agent_Workbench/03_竞品研究/.ref/_tmp_竞品矩阵.xlsx"

FONT = "微软雅黑"
NAVY = "17365D"
BLUE = "2E5C8A"
LIGHT = "EAF1F8"
GREY = "F2F2F2"
WARN = "FFF2CC"
RED = "FFC7CE"
GREEN = "C6EFCE"

thin = Side(style="thin", color="BFC9D4")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)


def fill(c):
    return PatternFill("solid", fgColor=c)


def title_block(ws, text, sub, width):
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=width)
    c = ws.cell(row=1, column=1, value=text)
    c.font = Font(name=FONT, size=14, bold=True, color="FFFFFF")
    c.fill = fill(NAVY)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[1].height = 30

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=width)
    c = ws.cell(row=2, column=1, value=sub)
    c.font = Font(name=FONT, size=9, color="4A5A6A")
    c.fill = fill(LIGHT)
    c.alignment = Alignment(horizontal="left", vertical="center", indent=1, wrap_text=True)
    ws.row_dimensions[2].height = 32


wb = openpyxl.Workbook()

# ============ Sheet 1 竞品总表 ============
ws = wb.active
ws.title = "竞品总表"
COLS = [
    ("分类", 14, "center"), ("产品", 20, "left"), ("定位一句话", 30, "left"),
    ("核心能力（已核实部分）", 42, "left"), ("校验能力到什么程度", 26, "left"),
    ("是否做生成", 12, "center"), ("定价", 22, "left"),
    ("威胁度", 10, "center"), ("与本项目的关系", 34, "left"), ("来源", 30, "left"),
]
title_block(ws, "S3 竞品矩阵 · 四类竞品（v2 修订版）",
            "采集 2026-11-08，按「已核实 / 未核实」分开写。威胁度只针对「本项目要做的事」。凡标注【待核实】的条目，写进报告前必须打开原文确认。", len(COLS))

hdr = 3
for i, (name, w, align) in enumerate(COLS, start=1):
    c = ws.cell(row=hdr, column=i, value=name)
    c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
    c.fill = fill(BLUE)
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDER
    ws.column_dimensions[get_column_letter(i)].width = w
ws.row_dimensions[hdr].height = 36

ROWS = [
    # ---------- 一、传统叙事编辑与脚本工具 ----------
    ("传统叙事工具", "articy:draft X", "游戏叙事设计的事实标准，15 年以上",
     "Flow 可视化图与嵌套流程、模板系统与对象数据库、全局变量、条件与指令（expresso 脚本）、本地化流水线、Unity/Unreal 官方导入器",
     "已有：Simulation / Analysis Mode。可在指定 Journey 内模拟条件、标出当前路径上的无效分支（红色）、跟踪变量变化。\n未证明：全局有限状态穷举；自定义函数需手动填预期返回值",
     "无", "免费版 + €5.99/用户/月起", "低",
     "补充关系而非替代。它解决「这条路径走不走得通」，本项目要做「是否存在任何可满足路径」以及「差了哪个变量」",
     "articy.com/en?p=7969；articy.com/en?p=4356；store.steampowered.com/app/230780"),

    ("传统叙事工具", "Arcweave", "浏览器协作叙事工具，团队远程用",
     "节点式剧情编排、条件分支、Play Mode 测试、多人实时协作",
     "有：条件分支与 Play Mode 可验证分支走向。\n未证明：全局状态穷举",
     "无", "免费档 + 订阅", "低",
     "证明「浏览器 + 协作 + 可测试」是已经被接受的形态，本项目不做编辑器，只做检查",
     "（据用户核对，Arcweave 支持条件分支与 Play Mode；具体条款以官网为准）"),

    ("传统叙事工具", "ink / Inky（inkle）", "脚本式叙事语言，开源，写作者友好",
     "纯文本脚本语法、变量与条件、分支汇合；Unity/Unreal/Godot 社区插件；《80 Days》《Sea of Thieves》在用",
     "编译期做语法与引用检查；不做状态可达性分析", "无",
     "免费，MIT", "低",
     "可作为任务 JSON 之外的一种导入格式",
     "loreweaver.ink/insights/how-to-get-started-narrative-design-tools"),

    ("传统叙事工具", "Twine", "浏览器里的分支原型工具",
     "段落 + 链接的极简结构，输出 HTML；半小时能跑通一个分支故事",
     "无校验", "无", "免费开源", "无",
     "它的用户群（独立开发者、Game Jam）最容易接受轻量校验工具",
     "loreweaver.ink/insights/how-to-get-started-narrative-design-tools"),

    ("传统叙事工具", "Yarn Spinner", "Unity 对话系统，knot/stitch 结构",
     "对话脚本编译为运行时结构、条件与变量、Unity 深度集成；《DREDGE》《Night in the Woods》在用",
     "编译期检查，不做状态穷举", "无", "免费，MIT", "低",
     "同 ink：可作为导入格式",
     "zipdo.co/best/narrative-software/"),

    ("传统叙事工具", "Storyflow", "2026 新品，成「图」之前的成型阶段工具",
     "Arc、角色、世界观、环境叙事收在一张画布上，AI 可通读全文",
     "官方自述：没有节点、分支、条件、变量、状态，没有引擎导出，也没有模拟玩家路径的方式",
     "有（写作辅助）", "$7.99/月（年付）", "低",
     "证明「结构化之前的模糊阶段」确实有需求，且这一段不需要图",
     "storyflow.so/blog/best-tools-game-narrative-teams-2026"),

    # ---------- 二、AI NPC 与实时叙事平台 ----------
    ("AI NPC 与实时叙事", "Inworld", "原 AI NPC 标杆，Character Studio 已退役",
     "2025 年 3–9 月退役 Character Studio，原有能力迁移至 Agent Runtime；现提供语音、TTS/STT 与 Agent 运行时，服务 Google、NVIDIA、Xbox 等企业客户",
     "不做任务结构校验", "有（运行时对话）",
     "按量计费，TTS 约 $5–25/百万字符", "低",
     "★不能说「赛道失败」。准确说法：角色运行时能力正在从「角色工作室」转向「Agent 运行时」，说明运行时这一层在被平台化，而研发阶段的校验仍然空着",
     "aigamingdev.com/blog/convai-vs-inworld-vs-diy-talking-npcs-2026；docs.inworld.ai（待核实具体迁移公告）"),

    ("AI NPC 与实时叙事", "Convai", "托管 NPC 全链路平台",
     "语音识别 + LLM 推理 + TTS + 口型 + 长期记忆 + Vision 场景感知 + Actions；Narrative Design 支持用目标、决策与触发器组织故事推进；Unity/Unreal/three.js 插件",
     "不做任务结构校验；叙事推进靠触发器和决策组织，不是设计态验证",
     "有（运行时对话）",
     "Free 100 次交互/月；Indie $29/月 3000 次", "低",
     "它做「运行时怎么演」，本项目做「设计态对不对」。不能因为有 Narrative Design 就认为它覆盖了任务包质量验证",
     "aigamingdev.com/blog/convai-vs-inworld-vs-diy-talking-npcs-2026"),

    ("AI NPC 与实时叙事", "NVIDIA ACE", "端侧推理 + 面部动画中间件",
     "Audio2Face 面部动画、Riva 语音识别、Nemotron-Mini-4B 端侧小模型（约 2GB 显存），零往返延迟；《Mecha BREAK》为首个公开集成",
     "不做任务结构校验", "有（运行时对话）",
     "微服务按用计费，端侧无调用费", "低",
     "端侧方案把延迟与成本压下来了，但记忆与一致性责任仍在开发者身上",
     "strayspark.studio/blog/ai-npcs-persistent-memory-inworld-convai-nvidia-ace-mcp"),

    # ---------- 三、AI 游戏生成与研发引擎 ----------
    ("AI 游戏生成与引擎", "Summer Engine", "AI 原生引擎（兼容 Godot 4），Agent 驱动构建",
     "Agent 调用引擎工具构建场景、脚本与 NPC，支持运行、测试、迭代与发布；描述任务后 NPC、目标、追踪、奖励一次性接好",
     "能做运行时测试与迭代，不能简单归为「生成完就交付」。但无针对 RPG 任务规则与状态约束的专门分析",
     "有（强，且落地到运行）", "未公开", "高",
     "★最接近的一条。它已经占了「生成 + 接线 + 跑起来」，本项目不能在这个方向硬碰；差异化只能落在「设计态规则诊断」",
     "summerengine.com/zh/blog/ai-quest-generator"),

    ("AI 游戏生成与引擎", "Rosebud AI", "文本到可玩网页游戏（vibe coding）",
     "一句话生成可玩网页游戏，含 RPG、视觉小说、互动叙事模板；生成后可继续修改；内置资产生成；免费托管、社区 remix",
     "可反复修改与重生成，不是一次性交付；但无结构校验", "有（强）",
     "$30/月起（商用授权档）", "中",
     "它的用户拿到的是「能跑的东西」，但不知道结构对不对——这是校验工具的天然入口",
     "ludo.ai/compare/ludo-vs-rosebud"),

    ("AI 游戏生成与引擎", "Ludo.ai", "创意、资产与市场数据",
     "概念生成、Top Charts 拆解、精灵图/3D/音频生成、GDD 起草，导出到引擎",
     "无", "有（资产为主）", "免费试用 + 订阅", "低",
     "不构成竞争；它的 Top Charts 拆解是品类数据来源之一",
     "ludo.ai"),

    # ---------- 四、叙事结构分析与校验工具 ----------
    ("结构分析与校验", "IntelliVNG Studio", "GitHub 开源的非线性叙事分析项目",
     "结构校验（孤立节点、死胡同、非法链接）、路径枚举、分支分布与伪非线性检测、约束合规评分；有把问题节点交 Agent 重新生成的流程",
     "有图结构层校验与定位。未证明具备完整 RPG 状态约束诊断；「回喂 Agent 重生成」是修复闭环的雏形",
     "无（分析为主）", "开源", "中",
     "★它的存在足以推翻「我们是少数能检测分支死路的工具」。但它停在「指出节点有问题」，没做到「解释差哪个变量、怎么改」",
     "github.com/FE-square/IntelliVNG（据用户核对）"),

    ("结构分析与校验", "Kleene Analyze", "以 Claude Skill 形式提供的分支场景分析",
     "15 类分析：网格覆盖、死路、不可达节点、铁路化、伪选择、路径枚举、循环检测、物品可获得性、不可能的特质要求、结局可达性、Schema 校验",
     "有图可达与结局可达；条件层只做「不可能的特质要求」检测，未做完整状态枚举",
     "无", "开源 Skill", "中",
     "分析项清单值得借鉴：尤其「伪选择」「铁路化」两类，本项目 Q 系列还没有",
     "lobehub.com/skills/kleene-games-kleene-kleene-analyze"),

    ("结构分析与校验", "Interactive Story State Author（ToolsFYI）", "浏览器内的分支故事状态分析工具【待核实】",
     "页面自述：有界整数/布尔变量、守卫条件与状态更新、导出离线可玩 HTML；分析器探索「场景 × 变量」状态，报告死路与非法转移，仅在完整搜索后判定不可达，10000 状态上限触顶报「未确认」；限 12 变量 / 64 场景 / 16 选项",
     "若经原文确认，则覆盖有界变量状态搜索 + 三态处理。\n目前：未找到可独立核实的公开原文，暂记待核实竞品",
     "无", "免费网页工具【待核实】", "待定",
     "它是本批最强的「不是独有创新」的证据，但正因为只有二手描述，报告里不能当已确认事实用。核验方式：打开页面 Load example → Generate，看是否真出报告",
     "toolsfyi.com/tools/generators/interactive-story-state-author（待核实）"),

    ("结构分析与校验", "LoreWeaver Architect", "把散文转成结构化叙事数据",
     "粘贴设定、角色描述、设计文档，自动生成实体图、对话树、任务流、关系图；也可视化拖节点",
     "无状态校验", "有（结构抽取）", "免费起步", "中高",
     "★它切的是「从设定到结构」这一段，与本项目 9.2–9.3 直接重叠。差异化只能落在「结构出来之后怎么验」",
     "loreweaver.ink/insights/how-to-get-started-narrative-design-tools"),
]

r = hdr + 1
for row in ROWS:
    for i, v in enumerate(row, start=1):
        c = ws.cell(row=r, column=i, value=v)
        c.font = Font(name=FONT, size=9)
        c.border = BORDER
        if i in (1, 6, 8):
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        else:
            c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    ws.row_dimensions[r].height = 84
    r += 1

for rr in range(hdr + 1, r):
    c = ws.cell(row=rr, column=8)
    v = c.value
    if v == "高":
        c.fill = fill(RED)
        c.font = Font(name=FONT, size=9, bold=True, color="9C0006")
    elif v == "中高":
        c.fill = fill(WARN)
        c.font = Font(name=FONT, size=9, bold=True, color="7F6000")
    elif v == "中":
        c.fill = fill(WARN)
        c.font = Font(name=FONT, size=9, color="7F6000")
    elif v == "待定":
        c.fill = fill(GREY)
        c.font = Font(name=FONT, size=9, color="595959")

ws.freeze_panes = "C4"
ws.auto_filter.ref = f"A{hdr}:J{r-1}"

# ============ Sheet 2 能力对照 ============
ws2 = wb.create_sheet("能力对照")
CAP = [
    ("能力", 32),
    ("传统叙事工具\narticy / Arcweave / ink", 18),
    ("AI NPC 平台\nConvai / ACE / Inworld", 18),
    ("AI 生成引擎\nSummer / Rosebud", 18),
    ("分析校验工具\nIntelliVNG / Kleene", 18),
    ("本项目定位", 46),
]
title_block(ws2, "能力对照 · 每个能力做到哪一步",
            "✓ 具备　◐ 部分或需人工　✗ 不具备。判断来自公开文档与产品页面，未做实测；标【待核实】的不计入结论。", len(CAP))

for i, (name, w) in enumerate(CAP, start=1):
    c = ws2.cell(row=3, column=i, value=name)
    c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
    c.fill = fill(BLUE)
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDER
    ws2.column_dimensions[get_column_letter(i)].width = w
ws2.row_dimensions[3].height = 44

MATRIX = [
    ("分支图可视化编辑", "✓", "✗", "◐", "✗", "不做。重资产，且 articy 已做到极致"),
    ("变量与条件表达", "✓", "◐", "◐", "✓", "做，但只支持布尔与有界整数"),
    ("单路径条件模拟（走一条路看通不通）", "✓", "◐", "◐", "✓", "不做，已有工具做好，做了也没有增益"),
    ("全局状态穷举（是否存在任何可满足路径）", "◐ 需手填预期值，未证明穷举", "✗", "✗", "◐ 小规模枚举 / 待核实", "★核心能力。但要承认：这是工程实现，不是发明"),
    ("三态输出 SAT/UNSAT/UNKNOWN", "✗", "✗", "✗", "◐ 有「未确认」概念", "做，且界面上与「通过」严格分开"),
    ("定位到变量与边的可修复诊断", "✗", "✗", "✗", "◐ IntelliVNG 可回喂 Agent 重生成", "★真正差异化：报「差 1 条线索，卡在这条边」"),
    ("RPG 领域规则（角色知识边界、线索上限）", "✗", "✗", "✗", "✗", "★真正差异化：内容层规则，通用分析器不会内置"),
    ("从 Brief 生成结构化任务", "✗", "✗", "✓", "✗", "做，但生成不是卖点"),
    ("运行时对话与 NPC 记忆", "✗", "✓", "◐", "✗", "明确不做（1.3 已划界）"),
    ("生成后测试与迭代", "◐", "◐", "✓ Summer 可运行测试", "◐", "不竞争这一层，只做设计态"),
    ("引擎导出（Unity/Unreal）", "✓", "✓", "◐", "✗", "首期不做，导出 JSON/Markdown"),
    ("人工确认与审核留痕", "✗", "✗", "✗", "✗", "做确认点与留痕；层级与复核方式待访谈定，不照搬工业制度"),
]

r = 4
for row in MATRIX:
    for i, v in enumerate(row, start=1):
        c = ws2.cell(row=r, column=i, value=v)
        c.border = BORDER
        c.font = Font(name=FONT, size=9)
        if i == 1:
            c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            c.fill = fill(GREY)
        elif i == 6:
            c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
            if v.startswith("★"):
                c.fill = fill(WARN)
                c.font = Font(name=FONT, size=9, bold=True, color="7F6000")
        else:
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            if v.startswith("✓"):
                c.fill = fill(GREEN)
            elif v.startswith("◐"):
                c.fill = fill(WARN)
            elif v.startswith("✗"):
                c.font = Font(name=FONT, size=9, color="A6A6A6")
    ws2.row_dimensions[r].height = 40
    r += 1

ws2.freeze_panes = "B4"

# ============ Sheet 3 结论与定位 ============
ws3 = wb.create_sheet("结论与定位")
ws3.column_dimensions["A"].width = 6
ws3.column_dimensions["B"].width = 116
title_block(ws3, "结论 · Q013 从「技术亮点」降为「质量能力」", "这一页给写报告和面试用。凡与本轮纠正冲突的旧表述，一律以本页为准。", 2)

BLOCKS = [
    ("一", "四类竞品的真实格局（纠正后）"),
    ("", "1. 传统叙事编辑与脚本工具（articy:draft、Arcweave、ink、Twine、Yarn Spinner、Storyflow）：不只是画图。articy 有 Simulation / Analysis Mode，可在指定 Journey 内模拟条件、标出当前路径的无效分支、跟踪变量；Arcweave 有 Play Mode 可验证条件分支。"),
    ("", "　→ 准确说法：它们已有条件模拟和路径测试，但公开资料不能证明其具备全局有限状态搜索与 RPG 领域诊断。不能写成「传统工具只负责编辑，不负责检查」。"),
    ("", "2. AI NPC 与实时叙事平台（Convai、Inworld、NVIDIA ACE）：做角色对话、记忆、行为与运行时交互。Convai 的 Narrative Design 可用目标、决策、触发器组织故事推进，不是只做聊天。Inworld 的 Character Studio 已退役，但能力迁移至 Agent Runtime。"),
    ("", "　→ 不能据此说 AI NPC 赛道失败；也不能因为有 Narrative Design 就认为它覆盖了任务包质量验证。它管「运行时怎么演」，不管「设计态对不对」。"),
    ("", "3. AI 游戏生成与研发引擎（Summer Engine、Rosebud、Ludo）：已从生成文案扩展到场景、脚本、NPC 和可运行项目。Summer Engine 支持 Agent 构建、运行、测试、迭代、发布。"),
    ("", "　→ 不能简单写成「生成完就交付，不验证」。准确说法：它们能跑起来、能测试，但没有针对 RPG 任务规则与状态约束的专门分析。"),
    ("", "4. 叙事结构分析与校验工具（IntelliVNG、Kleene、Interactive Story State Author）：IntelliVNG 已展示孤立节点、死胡同、路径枚举、约束检查和把问题节点交 Agent 重新生成的流程；Kleene 提供场景结构与死路检查。"),
    ("", "　→ 节点可达性、死路检测、路径枚举、有限状态搜索，都不能作为本项目的独占创新。"),
    ("二", "必须承认：Q013 不再是独占创新"),
    ("", "三件事已被别人做了：图可达与死路检测（IntelliVNG / Kleene）、条件模拟（articy / Arcweave）、有界变量状态搜索（ToolsFYI 若核实成立，连 1 万状态上限与「未确认」都一致）。"),
    ("", "所以 Q013 的定位要降一级：它不再是「技术创新卖点」，而是「产品质量能力的一部分」。"),
    ("", "真正值得投入的不是再证明一次「有限状态搜索能跑」，而是三件别人没做或没做透的事：领域规则、定位到变量与边的诊断、把检查嵌进策划的工作流。"),
    ("三", "差异化三条（替换原四条）"),
    ("", "① RPG 领域规则集：识别通用图分析器不理解的任务语义——角色知识边界、线索获取上限、隐藏结局的复合条件。证据状态：需用规则测试集证明。"),
    ("", "② 可解释、可修复的诊断：不止报 UNSAT，还指出冲突变量、约束来源、阻断路径与可能的修复方向。证据状态：目前是设计目标，尚未实现。"),
    ("", "③ 融入策划工作流的审核闭环：Brief → 生成 → 检查 → 策划确认 → 修改留痕 → 版本导出。证据状态：有原型与方案，仍需访谈验证。"),
    ("四", "两条不要写的（本轮明确降级）"),
    ("", "「4–5 级签发、唱票复诵」不写成游戏策划产品的差异化。它来自高风险作业流程，不代表策划也有同样的多级签发需求。可以保留人工确认、审核记录、版本追踪，但审批层级与复核方式应由真实访谈决定。"),
    ("", "「中文 RPG 语境」列为本地化适配能力，不列为核心壁垒。JD 里出现「品类打标、对齐品类口径」说明这是值得关注的工作内容，但不足以证明中文规则库本身构成竞争优势。"),
    ("五", "可引用的三句原话（都带边界）"),
    ("", "① Summer Engine：「任务本质是状态……这都不是叙事，而是记账。文字生成器不碰这部分，结构工具描述它，但让你去实现。」"),
    ("", "　→ 用来说「生成之后那段没人管」成立；但不能引申为「Summer 不验证」，它本身支持运行与测试。"),
    ("", "② 《骇游侠探》开发复盘：「现有的 Articy 没有给我们提供任何机制来对它自己的函数执行语法检查……有时候要花几个小时定位哪个更改导致了构建失败。」"),
    ("", "　→ 必须补一句：该团队后来通过自建插件补上了这部分检查。所以它证明的是「官方能力有缺口」，不是「Articy 完全没有校验」。"),
    ("", "③ 以咏今朝 JD：「参与游戏设计过程，减少设计预期与实际体验的差距。」"),
    ("", "　→ 招聘方承认设计与成品有落差，可作为需求侧旁证，不当作痛点强度的证明。"),
    ("六", "可直接替换 2.3 / 8.3 的段落"),
    ("", "本项目不以节点编辑、分支模拟、死路检测或有限状态搜索作为独占技术创新——这些能力在现有叙事工具（articy:draft 的 Simulation Mode、Arcweave 的 Play Mode）和开源分析项目（IntelliVNG、Kleene）中已有不同程度的实现。项目的差异化在于面向 RPG 任务策划构建领域专属的 Schema 与规则集，把通用结构分析与角色知识边界、任务状态约束、剧情设定等领域规则结合，并提供可定位到具体变量、条件与任务路径的诊断信息；在此基础上，将 Brief 解析、项目知识检索、结构化生成、规则与语义检查、人工审核与版本交付整合为一条完整工作流。以上差异化仍需通过竞品实测与目标用户访谈验证，不预先视为已成立的竞争优势。"),
    ("七", "写报告时的口径纪律"),
    ("", "1. 凡未打开原文核实的，一律写「据公开描述」或标注待核实，不写成事实。ToolsFYI 目前属于这一类。"),
    ("", "2. 区分「已有类似实现」与「已达到产品级」：IntelliVNG、Kleene 是开源/社区项目，不等于成熟商业产品，但足以推翻「只有我们做」这种说法。"),
    ("", "3. 不因为竞品做了某件事就否定本项目，也不因为本项目要做就贬低竞品。判断标准只有一条：策划在实际工作中会不会用。这一条目前没有证据，等访谈。"),
]

r = 3
for num, text in BLOCKS:
    if num:
        ws3.cell(row=r, column=1, value=num).font = Font(name=FONT, size=11, bold=True, color=NAVY)
        c = ws3.cell(row=r, column=2, value=text)
        c.font = Font(name=FONT, size=11, bold=True, color=NAVY)
        c.fill = fill(LIGHT)
        for col in (1, 2):
            cc = ws3.cell(row=r, column=col)
            cc.border = BORDER
            cc.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws3.row_dimensions[r].height = 26
    else:
        c = ws3.cell(row=r, column=2, value=text)
        c.font = Font(name=FONT, size=9.5)
        c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True, indent=1)
        c.border = BORDER
        ws3.cell(row=r, column=1).border = BORDER
        ws3.row_dimensions[r].height = max(22, 14.5 * (len(text) // 54 + 1))
    r += 1

# ============ Sheet 4 待核实 ============
ws4 = wb.create_sheet("待核实线索")
COLS4 = [("线索", 44), ("为什么要核", 44), ("核的方式", 34), ("状态", 12)]
title_block(ws4, "待核实线索", "标「未核实」的一律不能写进报告当作事实。核完把状态改掉，并在来源列留下链接。", len(COLS4))
for i, (name, w) in enumerate(COLS4, start=1):
    c = ws4.cell(row=3, column=i, value=name)
    c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
    c.fill = fill(BLUE)
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDER
    ws4.column_dimensions[get_column_letter(i)].width = w

TODO = [
    ("ToolsFYI 的 Interactive Story State Author 是否真为可用工具", "「Q013 不独特」目前最重的证据就靠它；若是内容农场占位页，结论强度要下调", "打开页面点 Load example → Generate，看是否真出分析报告；查站点是否有作者/公司信息", "未核实"),
    ("articy:draft 是否提供全局不可达节点检查", "如果能，12 章必要性论证要重写；如果不能，就是本项目的空位", "装免费版，建 3 节点含不可满足条件的流程，看 Simulation 是否报出", "部分确认"),
    ("articy 自定义函数的预期返回值是否必须手填", "决定「它能查多深」的边界", "查官方 Help Center 的 function / condition 条目", "未核实"),
    ("Inworld Character Studio 退役后能力迁移的具体范围", "已在结论中改为「迁移至 Agent Runtime」，需官方原文支撑", "查 docs.inworld.ai 的迁移说明或官方公告", "部分确认"),
    ("Convai Narrative Design 的能力边界", "结论里写了「目标、决策、触发器组织故事推进」，需原文确认不能夸大", "查 Convai 文档的 Narrative Design 章节", "未核实"),
    ("Summer Engine 的构建/运行/测试/迭代是否面向外部开发者开放", "决定它算「竞品」还是「相邻赛道」", "看官网 pricing / docs，或申请试用", "未核实"),
    ("IntelliVNG 的「问题节点交 Agent 重生成」是否可用", "这是修复闭环的雏形，会影响「可修复诊断」这条差异化的强度", "看 GitHub README 与 demo", "未核实"),
    ("Arcweave Play Mode 的检查深度", "确认它是否只做分支走向，还是也能查状态条件", "官网文档或试用免费档", "未核实"),
]
r = 4
for row in TODO:
    for i, v in enumerate(row, start=1):
        c = ws4.cell(row=r, column=i, value=v)
        c.font = Font(name=FONT, size=9)
        c.border = BORDER
        c.alignment = Alignment(horizontal="center" if i == 4 else "left", vertical="center", wrap_text=True)
    st = ws4.cell(row=r, column=4)
    st.fill = fill(GREEN) if row[3] == "已确认" else (fill(WARN) if row[3] == "部分确认" else fill(GREY))
    ws4.row_dimensions[r].height = 42
    r += 1

dv = DataValidation(type="list", formula1='"未核实,部分确认,已确认,已推翻"', allow_blank=True, showDropDown=False)
ws4.add_data_validation(dv)
dv.add(f"D4:D{r-1}")

wb.properties.title = "S3 竞品矩阵 v2"
wb.properties.creator = "AI Game Design Agent Workbench"
wb.save(P)
print("saved:", P)
