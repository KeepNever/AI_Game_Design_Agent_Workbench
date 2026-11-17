# -*- coding: utf-8 -*-
"""生成 v1.2.2 待合并修订包（S3 竞品结论）"""
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = r"D:/workbuddy/AI_Game_Design_Agent_Workbench/03_竞品研究/S3修订包_v1.2.2待合并.docx"
FONT = "微软雅黑"
NAVY = RGBColor(0x17, 0x36, 0x5D)
GREY = RGBColor(0x59, 0x59, 0x59)


def set_font(run, size=10.5, bold=False, color=None):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = color
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)


def para(doc, text, size=10.5, bold=False, color=None, space_after=6,
         first_indent=None, align=None, line=1.45):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.space_before = Pt(0)
    pf.line_spacing = line
    if first_indent:
        pf.first_line_indent = Pt(first_indent)
    if align:
        p.alignment = align
    r = p.add_run(text)
    set_font(r, size, bold, color)
    return p


def h1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_font(r, 14, True, NAVY)
    # 底部边框
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:color"), "17365D")
    pbdr.append(bottom)
    pPr.append(pbdr)
    return p


def h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_font(r, 11, True, RGBColor(0x2E, 0x5C, 0x8A))
    return p


def quote(doc, text, label=None):
    """带左侧竖线的引用块"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0.6)
    pf.space_after = Pt(6)
    pf.line_spacing = 1.35
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    left = OxmlElement("w:left")
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), "18")
    left.set(qn("w:color"), "2E5C8A")
    pbdr.append(left)
    pPr.append(pbdr)
    if label:
        r0 = p.add_run(label + "　")
        set_font(r0, 9.5, True, RGBColor(0x7F, 0x60, 0x00))
    r = p.add_run(text)
    set_font(r, 10, False, RGBColor(0x33, 0x33, 0x33))
    return p


def shade(cell, color):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:fill"), color)
    tcPr.append(sh)


def table(doc, headers, rows, widths, header_fill="2E5C8A", body_size=9):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        set_font(r, 9, True, RGBColor(0xFF, 0xFF, 0xFF))
        shade(hdr[i], header_fill)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.3
            r = p.add_run(v)
            set_font(r, body_size)
    for row in t.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = Cm(w)
        trPr = row._tr.get_or_add_trPr()
        cant = OxmlElement("w:cantSplit")
        trPr.append(cant)
    # 除末行外，段落与下段同页 → 整表尽量不跨页
    all_rows = t.rows
    for row in all_rows[:-1]:
        for cell in row.cells:
            for p in cell.paragraphs:
                p.paragraph_format.keep_with_next = True
    return t


doc = Document()
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.left_margin = Cm(2.6)
sec.right_margin = Cm(2.6)
sec.top_margin = Cm(2.4)
sec.bottom_margin = Cm(2.4)

st = doc.styles["Normal"]
st.font.name = FONT
st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

# 标题区
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(2)
r = p.add_run("S3 竞品结论修订包")
set_font(r, 20, True, NAVY)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(2)
r = p.add_run("供 v1.2.2 合并使用 · 不覆盖 v1.2.1")
set_font(r, 12, False, RGBColor(0x4A, 0x5A, 0x6A))

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(14)
r = p.add_run("整理日期 2026-11-08　|　配套文件：03_竞品研究/竞品矩阵.xlsx（v2 修订版，四页签）")
set_font(r, 9, False, GREY)

para(doc, "这份文件只做一件事：把 S3 竞品研究得出的结论整理成可直接替换的文本块。v1.2.1 保持原样不动——它是已归档的执行版，改它会牵出目录页码和版本记录。等 S3 正式收敛后，按本文件合并生成 v1.2.2。", 10.5, first_indent=21)

# ============ 一、三处纠正 ============
h1(doc, "一、必须先纠正的三处")

para(doc, "上一版竞品分析有三处结论下重了。这三处如果不改，写进报告会被人当场问倒，因为对方只要打开产品页面就能反驳。", 10.5, first_indent=21)

h2(doc, "1. 传统工具不是「只负责编辑，不负责检查」")
para(doc, "articy:draft 的 Simulation / Analysis Mode 可以在临时流程中计算条件、标出当前路径上的无效分支、跟踪变量变化；Arcweave 也支持条件分支与 Play Mode 测试。", 10.5, first_indent=21)
para(doc, "准确的说法是：它们已经具备条件模拟和路径测试，但公开资料尚不能证明其具备全局有限状态搜索与 RPG 领域诊断。自定义函数需要手动输入预期返回值，官方文档没有证明它会自动穷举全部状态组合。", 10.5, first_indent=21)

h2(doc, "2. 死路检测与路径分析已有明确同类实现")
para(doc, "IntelliVNG 的开源项目展示了孤立节点、死胡同检测、路径枚举与约束检查，并有把问题节点交给 Agent 重新生成的流程；Kleene 提供场景结构分析与死路检查。它们未必是成熟的商业策划产品，也没有证据证明具备完整的 RPG 状态约束诊断，但足以推翻「我们是少数能检测分支死路的工具」这种说法。", 10.5, first_indent=21)

h2(doc, "3. 生成侧不能简单说成「生成完就交付，不验证」")
para(doc, "Summer Engine 已能通过 Agent 构建游戏场景、脚本和 NPC，并支持运行、测试、迭代与发布；Rosebud 也能从描述生成可玩游戏并继续修改。Inworld 的 Character Studio 确实已退役，但官方说明原有能力迁移到了 Agent Runtime，不能据此推导整个 AI NPC 赛道失败。Convai 也有 Narrative Design，可以用目标、决策与触发器组织故事推进，并非只做聊天。", 10.5, first_indent=21)

h2(doc, "另外两条证据边界")
para(doc, "① ToolsFYI 的 Interactive Story State Author，目前没有找到足以独立核实的公开原文，暂记为待核实竞品，不进入结论。核验方式：打开页面点 Load example → Generate，看是否真出分析报告。", 10.5, first_indent=21)
para(doc, "② 《骇游侠探》的开发复盘确实记录了 Articy 自定义函数缺少语法与参数检查的问题，但该团队后来通过自建插件补上了这部分检查。所以它证明的是「官方能力有缺口」，不能扩大成「Articy 完全没有校验能力」。", 10.5, first_indent=21)

# ============ 二、8.1 替换文本 ============
h1(doc, "二、8.1 节替换文本（整节替换）")

para(doc, "以下四段可直接替换 8.1「必须研究的工具与竞品类别」全文。已按四类组织，并在每一类末尾写明「研究重点」，避免只列名字不说明为什么研究。", 10.5, first_indent=21)

h2(doc, "8.1 必须研究的工具与竞品类别")

para(doc, "一、传统叙事编辑与脚本工具", 10.5, bold=True, space_after=3)
para(doc, "代表产品包括 articy:draft、Ink/Inky、Twine 和 Arcweave。这类工具已经具备剧情节点组织、角色与对象管理、变量、条件分支、流程预览和部分路径模拟能力：articy:draft 可以模拟指定 Journey 中的条件变化并标出当前路径上的无效分支，Arcweave 可以通过 Play Mode 验证条件分支。研究重点不应再停留在它们能不能画流程图，而应关注它们能检查到什么程度、是否支持全局状态可达性分析、能否解释导致任务无法推进的具体状态约束，以及是否方便把检查能力接入策划的日常工作流。", 10.5, first_indent=21)

para(doc, "二、AI NPC 与实时叙事平台", 10.5, bold=True, space_after=3)
para(doc, "代表产品包括 Inworld、Convai 和 NVIDIA ACE。这类产品主要围绕角色对话、记忆、行为、情绪、动作和游戏运行时交互展开：Convai 已支持目标驱动的叙事流程，Inworld 则将原 Character Studio 的能力迁移至 Agent Runtime。研究重点是角色与玩家的实时交互、运行时状态管理、引擎接入和叙事触发机制，同时要区分运行时角色行为与研发阶段的任务设计、规则校验。不能因为这类平台有对话和 NPC 行为能力，就认为它们已经覆盖了 RPG 任务包的生产与质量验证。", 10.5, first_indent=21)

para(doc, "三、AI 游戏生成与研发引擎", 10.5, bold=True, space_after=3)
para(doc, "代表产品包括 Rosebud AI 和 Summer Engine。这类工具试图从自然语言描述直接生成可玩的游戏内容，能力范围已经从单纯生成文案扩展到场景、脚本、资源、NPC 和可运行项目。Summer Engine 还支持 Agent 调用引擎工具进行构建、运行和测试，不能简单归类为只负责生成、不负责验证。研究重点应放在生成结果能否进入真实项目、能否被程序化修改、运行时测试覆盖到什么程度，以及是否具备针对任务规则和状态约束的专门分析能力。", 10.5, first_indent=21)

para(doc, "四、叙事结构分析与校验工具", 10.5, bold=True, space_after=3)
para(doc, "代表项目包括 IntelliVNG、Kleene，以及待核实的 Interactive Story State Author。IntelliVNG 已展示图结构校验、死路检测、路径分析和问题节点定位；Kleene 提供场景结构分析和死路检查；ToolsFYI 的工具若经原文确认，也可能覆盖有界变量状态搜索及 UNKNOWN 处理。由此可以明确，节点可达性、死路检测、路径枚举和有限状态搜索都不能直接作为本项目的独占创新。真正值得继续研究的是：能否结合 RPG 任务规则，识别具体的状态冲突，给出导致路径不可满足的变量、条件和边，并向策划提供可解释、可操作的修复建议。", 10.5, first_indent=21)

# ============ 三、差异化三条 ============
h1(doc, "三、差异化：从四条改为三条")

para(doc, "原来的四个方向里，「自动校验与错误解释」被拆成了两件事——校验本身已不独特，诊断才是；「人工审核闭环」保留，但去掉照搬工业制度的表述。", 10.5, first_indent=21)

table(doc,
      ["差异化方向", "应该证明什么", "当前证据状态"],
      [
          ["RPG 领域规则集",
           "能识别通用图分析器不理解的任务语义、角色知识边界、线索获取上限和隐藏结局约束",
           "需要通过规则测试集证明"],
          ["可解释、可修复的诊断",
           "不止报告 UNSAT，还能指出冲突变量、约束来源、阻断路径和可能的修复方向",
           "目前是产品设计目标，尚未实现"],
          ["融入策划工作流的审核闭环",
           "从 Brief、生成、检查到策划确认、修改留痕和版本导出形成完整流程",
           "有原型与方案支撑，仍需用户访谈验证"],
      ],
      [4.2, 8.2, 3.6])

para(doc, "", space_after=4)
para(doc, "两条不写成差异化的（本轮明确降级）：", 10.5, bold=True, space_after=3)
para(doc, "「4–5 级签发、唱票复诵」不直接写成游戏策划产品的差异化。它来自高风险作业流程，不代表游戏策划也存在同样的多级签发需求。可以保留人工确认、审核记录、版本追踪，但审批层级和复核方式应由真实策划访谈决定。", 10.5, first_indent=21)
para(doc, "「中文 RPG 语境」更适合列为本地化适配能力，而不是核心壁垒。招聘 JD 中出现品类打标、口径对齐，说明这是值得关注的工作内容，但还不足以证明中文 RPG 规则库本身能形成竞争优势。", 10.5, first_indent=21)

# ============ 四、替换段落 ============
h1(doc, "四、可直接替换 2.3 与 8.3 的段落")

para(doc, "以下文字替换 2.3「产品差异化结论」和 8.3「初步差异化方向」中关于差异化的核心表述。两处内容应保持一致，避免一处改了另一处没改。", 10.5, first_indent=21)

quote(doc,
      "本项目不以节点编辑、分支模拟、死路检测或有限状态搜索作为独占技术创新，这些能力在现有叙事工具和开源分析项目中已有不同程度的实现。项目的差异化方向在于面向 RPG 任务策划构建领域专属的 Schema 与规则集，将通用结构分析与角色知识边界、任务状态约束、剧情设定等领域规则结合，并进一步提供可定位到具体变量、条件和任务路径的诊断信息。在此基础上，将 Brief 解析、项目知识检索、结构化生成、规则与语义检查、人工审核和版本交付整合为一条完整工作流。以上差异化仍需通过竞品实测和目标用户访谈验证，不预先视为已经成立的竞争优势。",
      label="替换文本")

para(doc, "这段话有一处刻意的写法：最后一句主动承认尚未验证。看起来是示弱，实际是把「作品集里哪些是已证的、哪些是待证的」这条线守住。评审老师最怕的不是方案不完整，是分不清哪句有依据。", 10.5, first_indent=21)

# ============ 五、五条口径纪律 ============
h1(doc, "五、写报告时的五条口径纪律")

rows = [
    ["1", "未打开原文的不写成事实",
     "凡未核实的，一律写「据公开描述」或标注待核实。ToolsFYI 目前属于这一类。"],
    ["2", "区分「已有类似实现」与「已达产品级」",
     "IntelliVNG、Kleene 是开源或社区项目，不等于成熟商业产品，但足以推翻「只有我们做」这种说法。"],
    ["3", "不因为竞品做了就否定自己，也不因为自己要做就贬低竞品",
     "判断标准只有一条：策划在实际工作中会不会用。这条目前没有证据，等访谈。"],
    ["4", "引用别人的话要带边界",
     "《骇游侠探》那句必须补「团队后来自建插件补上了」；Summer Engine 那句不能引申为「它不验证」。"],
    ["5", "Q013 降级但不砍掉",
     "它从「技术创新卖点」降为「产品质量能力的一部分」。砍掉会让 12 章失去落点，留着也没人否认它能跑。"],
]
table(doc, ["#", "纪律", "具体做法"], rows, [1.2, 5.2, 9.6])

# ============ 六、待核实 ============
h1(doc, "六、合并前必须核实的六件事")

para(doc, "这六条会直接影响措辞强度。核完一条，去 竞品矩阵.xlsx 的「待核实线索」页把状态改掉，别在这里改，避免两处不一致。", 10.5, first_indent=21)

rows = [
    ["1", "ToolsFYI 状态分析器是否真能跑",
     "「Q013 不独特」最重的证据靠它。若是内容农场占位页，结论强度要下调"],
    ["2", "articy 是否提供全局不可达检查",
     "如能，12 章必要性论证要重写；如不能，正是本项目的空位"],
    ["3", "articy 自定义函数预期值是否必须手填",
     "决定「它能查多深」的边界"],
    ["4", "Inworld 能力迁移到 Agent Runtime 的具体范围",
     "结论已改成「迁移」，需官方原文支撑"],
    ["5", "Convai Narrative Design 的能力边界",
     "避免把「目标、决策、触发器」写成它已覆盖任务质量验证"],
    ["6", "IntelliVNG 的 Agent 重生成流程是否可用",
     "这是修复闭环的雏形，影响「可修复诊断」这条差异化的强度"],
]
table(doc, ["#", "待核实项", "影响"], rows, [1.2, 6.4, 8.4])

# ============ 尾注 ============
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(18)
r = p.add_run("本文件为内部修订工作稿，不作为对外交付物。合并入 v1.2.2 后建议归档至 00_立项文档/。")
set_font(r, 9, False, GREY)

doc.save(OUT)
print("saved:", OUT)
