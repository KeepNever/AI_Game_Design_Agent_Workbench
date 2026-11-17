# -*- coding: utf-8 -*-
"""S4 品类与 MVP 决策草案"""
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = r"D:/workbuddy/AI_Game_Design_Agent_Workbench/00_立项文档/S4_品类与MVP决策草案.docx"
FONT = "微软雅黑"
NAVY = RGBColor(0x17, 0x36, 0x5D)
BLUE = RGBColor(0x2E, 0x5C, 0x8A)
GREY = RGBColor(0x59, 0x59, 0x59)
AMBER = RGBColor(0x7F, 0x60, 0x00)


def set_font(run, size=10.5, bold=False, color=None):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = color
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)


def para(doc, text, size=10.5, bold=False, color=None, space_after=6,
         first_indent=None, align=None, line=1.4):
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
    p.paragraph_format.space_before = Pt(15)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_font(r, 14, True, NAVY)
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
    p.paragraph_format.space_before = Pt(9)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_font(r, 11, True, BLUE)
    return p


def quote(doc, text, label=None):
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
        set_font(r0, 9.5, True, AMBER)
    r = p.add_run(text)
    set_font(r, 10, False, RGBColor(0x33, 0x33, 0x33))
    return p


def shade(cell, color):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:fill"), color)
    tcPr.append(sh)


def table(doc, headers, rows, widths, body_size=9, center_cols=()):
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
        shade(hdr[i], "2E5C8A")
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing = 1.3
            if i in center_cols:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(v)
            set_font(r, body_size)
    for row in t.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = Cm(w)
        trPr = row._tr.get_or_add_trPr()
        trPr.append(OxmlElement("w:cantSplit"))
    for row in t.rows[:-1]:
        for cell in row.cells:
            for p in cell.paragraphs:
                p.paragraph_format.keep_with_next = True
    return t


doc = Document()
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.left_margin = Cm(2.5)
sec.right_margin = Cm(2.5)
sec.top_margin = Cm(2.3)
sec.bottom_margin = Cm(2.3)

st = doc.styles["Normal"]
st.font.name = FONT
st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(2)
r = p.add_run("S4 品类与 MVP 决策草案")
set_font(r, 19, True, NAVY)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(2)
r = p.add_run("讨论稿 · 不并入 v1.2.2，待 S2 访谈结论出来后再定稿")
set_font(r, 11, False, RGBColor(0x4A, 0x5A, 0x6A))

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(12)
r = p.add_run("2026-11-08　|　依据：v1.2.2 第 1.4、3.4、9.1、12.1 节；20 条 JD 样本；四类竞品矩阵")
set_font(r, 9, False, GREY)

para(doc, "这份草案解决三个问题：产品结构怎么描述、品类规则怎么隔离、首期做哪个场景。前两个是架构问题，现在就能定；第三个必须等 S2 访谈，草案只给判断标准，不给结论。", 10.5, first_indent=21)

# ============ 一、结论 ============
h1(doc, "一、三条判断")

para(doc, "第一，三个方向不是三个产品。Agent 工作流、内容生成、质量检查是一条链路上的三段，各自承担不同职责，缺一段这条链路就断。把它们写成三个候选方向，是把产品结构误当成了产品选择。", 10.5, first_indent=21)

para(doc, "第二，品类扩展的边界在规则，不在流程。通用底座能复用的是编排、检索、生成、检查框架、审核与版本；不能复用的是具体规则。拿 RPG 的 Q001–Q013 去检查休闲游戏关卡，得到的是错误结论，不是「通用能力」。", 10.5, first_indent=21)

para(doc, "第三，首期要收的是范围，不是视野。首期做一个场景的完整闭环，第二个场景做轻量验证；第二个场景的作用不是「证明我们能扩展」，而是「证明底座抽对了」。这两句话不一样，验收标准也不一样。", 10.5, first_indent=21)

# ============ 二、产品结构 ============
h1(doc, "二、产品结构：一条链路，三个职责")

para(doc, "五段链路，每段有明确的输入输出。三个能力不是并列的功能模块，而是链路上的三段职责。", 10.5, first_indent=21)

table(doc,
      ["链路环节", "职责", "输入", "输出", "归属"],
      [
          ["① 需求解析", "把 Brief 中的目标、约束、缺口解析成结构化任务", "策划 Brief、项目资料", "结构化需求 + 待确认清单", "通用"],
          ["② 生成", "检索项目知识，生成任务、剧情、关卡与配置", "结构化需求、知识库、品类 Schema", "品类专属设计产物", "通用框架 + 品类规则"],
          ["③ 检查", "确定性规则、语义检查、状态条件判定", "设计产物、品类规则集", "问题清单（位置、原因、严重度）", "通用框架 + 品类规则"],
          ["④ 诊断与修复建议", "定位冲突变量与阻断路径，给出候选修改", "问题清单", "可复核的违反点 + 修改建议", "通用框架 + 品类规则"],
          ["⑤ 审核与交付", "人工确认、留痕、版本、导出", "修复后的产物", "可交接的任务包 / 关卡配置", "通用"],
      ],
      [2.6, 5.4, 3.6, 4.0, 3.2], body_size=8.5)

para(doc, "", space_after=4)
para(doc, "对应的三个能力定位：", 10.5, bold=True, space_after=3)
table(doc,
      ["能力", "在产品中的定位", "解决什么问题", "能不能跨品类复用"],
      [
          ["完整 Agent 工作流", "产品主干", "把策划需求转化为可交付的设计产物", "能，整套复用"],
          ["AI 内容生成", "生产能力", "生成任务、剧情、关卡、玩法与配置", "框架复用，生成规则按品类换"],
          ["质量检查与修复", "质量能力", "发现逻辑冲突、约束遗漏，给出修复建议", "★检查框架复用，检查规则不能复用"],
      ],
      [4.0, 3.2, 6.2, 5.4], body_size=9)

# ============ 三、通用与品类边界 ============
h1(doc, "三、划清一条线：什么能通用，什么不能")

para(doc, "这条线如果不划清，第二个品类一接就会出问题——不是因为架构不够抽象，而是因为有人会顺手把 RPG 的规则拿去用。", 10.5, first_indent=21)

table(doc,
      ["层", "内容", "跨品类", "判断标准"],
      [
          ["通用底座", "Agent 编排、知识检索、生成调度、检查执行框架、问题对象、审核流程、版本与导出", "直接复用", "换品类后代码不用改"],
          ["品类 Schema", "对象定义、字段、合法取值（RPG 的 Quest/Node/Edge/变量域；休闲的 Level/Obstacle/难度参数）", "必须重写", "换品类后必须新增一套定义"],
          ["品类规则集", "Q 系列检查规则、语义审查规则", "绝对不能复用", "换品类后规则结论不成立"],
          ["评测集", "测试样本、GT、负面样例", "按品类分开，不混算", "混算会让通过率失去意义"],
      ],
      [3.0, 8.4, 3.4, 4.0], body_size=9)

para(doc, "", space_after=4)
para(doc, "举一个具体的反例：RPG 里「隐藏结局要求 clue_count ≥ 2，但全任务最多只能获得 1 条线索」是阻断级错误；休闲游戏里根本没有线索和隐藏结局这两个概念。如果规则集不隔离，系统会拿一条不存在的变量去检查，报出「通过」或「未知」，两种结果都是错的。", 10.5, first_indent=21)

# ============ 四、规则隔离机制 ============
h1(doc, "四、规则隔离怎么落到工程上")

para(doc, "上一节是原则，这一节是机制。四件事，缺一件规则就会串用。", 10.5, first_indent=21)

h2(doc, "1. 每条规则必须声明适用品类")
para(doc, "规则包（RulePack）带 applicable_genres 字段，加载时按 project.genre 过滤。没有声明的规则默认不执行，而不是默认对所有品类生效——默认放开是串用的主要来源。", 10.5, first_indent=21)

h2(doc, "2. 规则分两层，通用层只放与品类无关的判断")
para(doc, "通用层可以查：ID 唯一性、引用完整性、字段必填、类型合法、版本一致性。这些换任何品类都成立。品类层查：状态可达性、线索上限、难度梯度、参数区间。分层的意义是让「哪些规则可以跨品类」变成结构上的事实，而不是靠人记。", 10.5, first_indent=21)

h2(doc, "3. 跨品类调用必须显式声明")
para(doc, "如果确实需要借用其他品类的规则做参考（例如「这个关卡结构像 RPG 的线性流程」），必须显式声明来源并标注为参考结论，不能混进正式检查结果。默认禁止，例外留痕。", 10.5, first_indent=21)

h2(doc, "4. 评测按品类分开跑，分开报")
para(doc, "30 条样本、通过率、UNKNOWN 比例都按品类分别统计。把两个品类的样本混在一起算一个总通过率，数字会好看，但说明不了任何事。", 10.5, first_indent=21)

para(doc, "", space_after=4)
quote(doc, "规则隔离不是架构洁癖。它决定第二个品类接入时，是改一个配置文件，还是回去重写检查器。前者是扩展，后者是返工。", label="为什么较真")

# ============ 五、两场景对比 ============
h1(doc, "五、RPG 与休闲：六个维度，现在只填得出一半")

para(doc, "S2 访谈要把这两个场景比出高下。但比之前得先说清比什么，否则聊完还是凭印象。下面六维，前三项现在有证据，后三项必须访谈才知道。", 10.5, first_indent=21)

table(doc,
      ["维度", "看什么", "当前证据", "判断"],
      [
          ["结构复杂度", "这个场景的任务/关卡有没有足够的状态与条件，能撑起 Q013 这类检查", "RPG 任务有分支、隐藏结局、状态变量；休闲关卡以参数与难度曲线为主", "RPG 占优"],
          ["岗位需求", "招聘市场上哪个方向真的在招、招多少", "20 条 JD：RPG 任务策划 0、剧情策划 1、休闲小游戏方向 6", "休闲占优"],
          ["内容与能力匹配", "你能不能独立产出这个场景的原创素材与设计", "125 万字同人 + 原创世界观可直接用于 RPG；休闲关卡需要数值与难度设计经验", "RPG 占优"],
          ["访谈可得性", "哪个方向的人更容易约到、更愿意讲细节", "未知，S2 实测", "待定"],
          ["评测可构造性", "能否独立构造 30 条含正负例的测试样本", "RPG 有设定基础，样本可写；休闲需要先定义难度参数体系", "RPG 略优"],
          ["第二场景成本", "另一个场景降为轻量验证时，要改多少东西", "未知，取决于规则隔离做得如何", "待定"],
      ],
      [2.8, 5.4, 6.4, 2.4], body_size=8.5, center_cols=(3,))

para(doc, "", space_after=4)
para(doc, "现在的局面是：岗位数据支持休闲，能力与内容资产支持 RPG，访谈决定最后一票。", 10.5, bold=True, first_indent=21)
para(doc, "这也解释了为什么不必现在二选一——两个方向各有两项硬证据，谁都没有压倒性优势。真正会改变天平的是访谈：哪个场景的人能说出具体的失败案例、能给出带时间的返工，那个场景就赢。岗位多的方向如果没人愿意深聊，做出来的东西也只能靠想象。", 10.5, first_indent=21)

# ============ 六、决策规则 ============
h1(doc, "六、S2 结束时的决策规则")

para(doc, "先把规则写死，避免到时候拿印象做决定。三条，按顺序判断。", 10.5, first_indent=21)

table(doc,
      ["条件", "决定", "说明"],
      [
          ["某个场景拿到 ≥3 次有效访谈，且能给出 2 个以上带时间或频次的返工案例", "该场景做首期完整闭环", "这是最理想的情况，直接定"],
          ["两个场景都不足 3 次，但其中一个 ≥2 次且能给出具体案例", "该场景做首期，另一个降为第二场景或不验证", "样本不足要在报告里写明，不能包装成行业结论"],
          ["两个场景都不足 2 次", "按能力匹配选 RPG，同时标注样本不足", "RPG 有现成内容资产，能在没有外部输入时继续推进；但结论只能写成个人对照"],
      ],
      [7.4, 5.2, 6.4], body_size=9)

para(doc, "", space_after=4)
para(doc, "补充一条：如果休闲侧的访谈明显更好，不要因为「已经写了 RPG」而硬撑。文档第 9.1 节自己写了——若证据不支持 RPG，必须调整，不得仅因已写入方案而继续。", 10.5, first_indent=21)

# ============ 七、MVP 范围 ============
h1(doc, "七、首期完整闭环，第二场景轻量验证")

para(doc, "两个场景的投入不是 1:1，也不是各做一半。首期要能跑通完整链路，第二场景只要证明「换品类只改规则包」。", 10.5, first_indent=21)

table(doc,
      ["", "首期场景（完整闭环）", "第二场景（轻量验证）"],
      [
          ["链路", "①→⑤ 全部走通", "只走 ②→③：给已有数据做检查，不做生成与审核"],
          ["Schema", "完整品类 Schema", "最小 Schema：3–5 个对象"],
          ["规则", "完整规则集（Q001–Q013 规模）", "3–5 条规则，覆盖结构与参数两类"],
          ["样本", "30 条评测样本 + 单元测试", "5 条手工样本，只验规则能否跑通"],
          ["界面", "完整工作台", "命令行或一个检查页"],
          ["验收", "14.5 的指标门槛全部适用", "只验一件事：换品类后主流程代码改动量 < 20%"],
      ],
      [2.6, 7.4, 7.4], body_size=9)

para(doc, "", space_after=4)
para(doc, "第二场景的验收标准只有一条，而且不是「能跑」——是「改动量足够小」。", 10.5, bold=True, first_indent=21)
para(doc, "如果接入第二个品类时，主流程代码几乎没动，只新增了 Schema 和规则包，说明底座抽对了，这是架构上的证据，写进作品集有分量。如果为了接第二个品类改了生成器、改了检查器、改了问题对象，那说明底座是按 RPG 硬编码的，「多品类」就只是一句规划。", 10.5, first_indent=21)

# ============ 八、与求职路线 ============
h1(doc, "八、这套结构怎么对应两条求职路线")

table(doc,
      ["路线", "讲什么", "哪些证据支撑"],
      [
          ["主攻：AI 游戏产品", "懂策划工作流，能把需求变成可交付产物，能判断内容质量",
           "品类 Schema、RPG 规则集、访谈记录、任务包样例"],
          ["备选：通用 B 端 AI 产品", "能抽象复杂业务流程，设计 Agent、工具调用、状态管理、人工审核与评测闭环",
           "通用底座、规则隔离机制、H0–D2 对照实验、审核留痕"],
      ],
      [4.2, 7.0, 7.8], body_size=9)

para(doc, "", space_after=4)
para(doc, "第二场景在这里的作用被放大了：对游戏岗，它证明「能扩展品类」；对 B 端岗，它证明「底座是抽出来的，不是给一个场景定制的」。同一个动作，两种叙述，这正是两条腿走路需要的材料。", 10.5, first_indent=21)

# ============ 九、S2 要补的问题 ============
h1(doc, "九、S2 访谈要补的四类问题")

para(doc, "现有访谈提纲是按 RPG 任务策划写的，要比较两个场景，得补四类。", 10.5, first_indent=21)

table(doc,
      ["要补什么", "怎么问", "判什么"],
      [
          ["休闲侧的完整流程", "你做一个关卡，从拿到需求到能玩，中间经过哪几步？", "有没有和 RPG 同构的环节（解析、生成、检查、审核）"],
          ["休闲侧的出错类型", "最近一次关卡上线后被反馈「太难/太简单」，是怎么发现的、改了什么？", "错误是否可判定——能判定才有检查空间"],
          ["休闲侧的参数管理", "难度是靠一张表调，还是靠手感试？那张表谁维护？", "有没有结构化的参数体系可检查"],
          ["两侧的对比判断", "如果有个工具能自动查出「这关的通关条件不可能达成」，你觉得有用吗？", "同一问题在两个场景的接受度差异"],
      ],
      [4.0, 7.6, 6.4], body_size=9)

para(doc, "", space_after=6)
para(doc, "第四问是关键。它把抽象的「哪个场景更适合」变成一个具体问题：同一个检查能力，谁更觉得有用。两个人给的答案如果差距很大，比什么维度表都直接。", 10.5, first_indent=21)


doc.save(OUT)
print("saved:", OUT)
