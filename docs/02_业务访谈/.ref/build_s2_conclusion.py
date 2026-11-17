# -*- coding: utf-8 -*-
"""S2 调研结论（第一轮）"""
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = r"D:/workbuddy/AI_Game_Design_Agent_Workbench/02_业务访谈/S2调研结论_第一轮.docx"
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
         first_indent=None, line=1.4):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.space_before = Pt(0)
    pf.line_spacing = line
    if first_indent:
        pf.first_line_indent = Pt(first_indent)
    r = p.add_run(text)
    set_font(r, size, bold, color)
    return p


def h1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_font(r, 13.5, True, NAVY)
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
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_font(r, 10.5, True, BLUE)
    return p


def shade(cell, color):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:fill"), color)
    tcPr.append(sh)


def table(doc, headers, rows, widths, body_size=8.5, center=()):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    _tblPr = t._tbl.tblPr
    _layout = OxmlElement("w:tblLayout")
    _layout.set(qn("w:type"), "fixed")
    _tblPr.append(_layout)
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        set_font(r, 8.5, True, RGBColor(0xFF, 0xFF, 0xFF))
        shade(hdr[i], "2E5C8A")
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(1.5)
            p.paragraph_format.line_spacing = 1.25
            if i in center:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(v)
            set_font(r, body_size)
    for row in t.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = Cm(w)
        row._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))
    for row in t.rows[:-1]:
        for cell in row.cells:
            for p in cell.paragraphs:
                p.paragraph_format.keep_with_next = True
    return t


doc = Document()
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.left_margin = Cm(2.4)
sec.right_margin = Cm(2.4)
sec.top_margin = Cm(2.2)
sec.bottom_margin = Cm(2.2)

st = doc.styles["Normal"]
st.font.name = FONT
st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(2)
r = p.add_run("S2 用户与业务访谈 · 第一轮结论")
set_font(r, 18, True, NAVY)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(2)
r = p.add_run("五份样本 · 大型 / 中型 / 小型各一场，另加两场跨行业对照")
set_font(r, 10.5, False, RGBColor(0x4A, 0x5A, 0x6A))

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(10)
r = p.add_run("2026-11-09　|　本文件用于 v2.0 第 11 章（S2）与评测设计，不对外")
set_font(r, 8.5, False, GREY)

# ============ 一、样本 ============
h1(doc, "一、样本与采集方式")

table(doc,
      ["编号", "对象", "规模", "方向", "方式", "信息完整度"],
      [
          ["01", "汽机检修从业者", "—", "电力（跨行业对照）", "聊天，回忆整理", "工作票制度完整，事故细节空"],
          ["02", "高压电工", "—", "电力（跨行业对照）", "聊天，回忆整理", "仅确证「有唱票」"],
          ["03", "叙事关卡策划", "小型", "叙事 / 内容结构", "对话，同步整理", "机制清楚，无数字无事故"],
          ["04", "放置类活动策划", "中型", "数值 / 机制 / 配比", "贴吧公开回复", "流程与一次轻量事故"],
          ["05", "剧情策划", "大型（米哈游）", "叙事 / 世界观", "文字问答", "最完整，含三级核对机制"],
      ],
      [1.1, 3.4, 1.9, 3.6, 2.6, 3.4], center=(1, 3))

para(doc, "五份里，游戏行业三份，跨行业两份。三份游戏行业样本分别来自小型、中型、大型团队——这一点比样本数量更重要，它让「规模是否影响痛点结构」这个问题可以初步回答。",
     10, first_indent=21, space_after=8)

# ============ 二、核心发现 ============
h1(doc, "二、核心发现：三个岗位，同一个问题")

para(doc, "把三份游戏行业样本摊在一起，会看到一件不在预期内的事。", 10, first_indent=21)

table(doc,
      ["样本", "工作对象", "他花时间的地方", "原话"],
      [
          ["03 叙事关卡策划", "角色、剧情、关卡", "角色之间的关系、剧情承接、剧情与关卡的切分", "「这一步怎么去和关卡去做切分」"],
          ["04 放置活动策划", "机制、活动、奖励", "新机制与已有机制的联动", "「一般都是靠灵光乍现」"],
          ["05 剧情策划（大厂）", "设定、大纲、剧情、任务", "核对角色经历、人物关系、时间线", "「剧情积累越多越容易出现细节遗漏」"],
      ],
      [3.0, 2.8, 6.2, 4.0])

para(doc, "", space_after=4)
para(doc, "对象不同（内容 / 数值 / 机制），但问题形态一样：改一处，怎么知道影响了哪些地方。", 10, bold=True, first_indent=21, space_after=6)
para(doc, "这不是「他们不会写」，也不是「他们不用心」。三层 review（自查 → 主笔审核 → 交叉 review）已经是重流程，仍然会漏——因为内容在增长，而人的核对能力不增长。", 10, first_indent=21)

# ============ 三、假设 ============
h1(doc, "三、假设状态")

table(doc,
      ["假设", "状态", "依据", "缺口"],
      [
          ["H-01a 存在高频、耗时步骤", "未验证", "方向明确（关系核对、锚点、机制联动），但五份样本零工时数字", "缺一次带时间的记录"],
          ["H-01b 该步骤质量可判定", "已验证", "三级核对、三层 review 的存在，说明「对不对」有标准，否则无法审", "—"],
          ["H-02 Brief 解析与重复整理成本", "未验证", "无人谈及需求解析环节", "缺直接证据"],
          ["H-03a 设定冲突确实存在", "已验证", "米哈游明确确认 + 成因（长期积累）；另两位有相关表述", "—"],
          ["H-03b 冲突造成显著返工成本", "未验证", "五份样本均无具体时长；受访者表示不便展开", "缺数字，且本轮不再追"],
          ["H-04 品类差异影响痛点结构", "已验证", "放置类明确无叙事需求；小/中/大三档团队痛点形态不同但问题同构", "—"],
      ],
      [4.2, 1.9, 7.3, 2.6], center=(2,))

para(doc, "", space_after=4)
para(doc, "六条里判真三条（H-01b、H-03a、H-04），未验证三条（H-01a、H-02、H-03b）。判真的三条足以支撑产品存在，未验证的三条决定产品的价值能写多大。",
     10, first_indent=21)

# ============ 四、能写什么 ============
h1(doc, "四、能写进报告的，与不能写的")

h2(doc, "可以写（有直接依据）")
para(doc, "「一位大型项目剧情策划描述：涉及公共设定变更需同步给剧情、任务、演出三类负责人，并保留历史版本。」", 10, first_indent=21, space_after=3)
para(doc, "「一位叙事关卡策划描述：每个关卡设有锚点，触发后才引出下一步；某 NPC 需完成前置任务才能认识。」", 10, first_indent=21, space_after=3)
para(doc, "「一位放置类活动策划描述：固定活动按开服天数推进，奖励产出占比 1:10:100，中间档需固定人数。」", 10, first_indent=21, space_after=6)

h2(doc, "不能写（越界表述）")
para(doc, "不能写「游戏策划普遍存在该痛点」——五份样本不足以支撑「普遍」。", 10, first_indent=21, space_after=3)
para(doc, "不能写「设定冲突每天发生」——无人给出频率。", 10, first_indent=21, space_after=3)
para(doc, "不能写「该问题每年造成 X 小时返工」——无任何数字来源。", 10, first_indent=21, space_after=3)
para(doc, "不能把火影「策划说」的内容当作策划自述——那是 C 级材料，只能放在行业公开信息里。", 10, first_indent=21, space_after=6)

h2(doc, "另一条可用的观察")
para(doc, "访谈中，受访者在涉及内部设定管理流程与事故细节时普遍表示不便透露。这一反应本身说明：设定一致性与变更同步被视为团队的核心资产，而非通用做法。换言之，这些流程没有形成行业标准，各家自行摸索，因此也不存在可直接套用的现成方案。",
     10, first_indent=21)

# ============ 五、对产品的影响 ============
h1(doc, "五、对产品定位的三条影响")

para(doc, "一，产品定位应从「品类模块化」调整为「变更影响分析」。原来设想是「通用底座 + RPG 模块 + 休闲模块」，但三个品类的规则完全不能通用。真正通用的是引用关系与影响面分析，不能通用的是每个品类的规则内容。",
     10, first_indent=21, space_after=5)
para(doc, "二，通用大模型是现实替代品。受访者已在用大模型聊设计瓶颈，但用的是「问」而不是「查」——大模型看不到他的表、他的前置条件、他的角色关系。差异化落在「工具能读到数据」，不是「工具也用了 AI」。",
     10, first_indent=21, space_after=5)
para(doc, "三，版本管理不是痛点。受访者明确表示已保留历史版本便于追溯。产品不应重复这一能力，应专注影响面定位。",
     10, first_indent=21)

# ============ 六、剩余缺口 ============
h1(doc, "六、剩余缺口与本轮决定")

table(doc,
      ["缺口", "影响", "本轮处理"],
      [
          ["H-03b 返工成本数字", "决定价值论证能写多大", "不再追。报告标「已确认存在，成本未量化」"],
          ["H-01a 工时数字", "决定效率指标能否成立", "评测改用「发现问题所处阶段」与「返工次数」，不测单次耗时"],
          ["H-02 Brief 解析成本", "影响生成环节的价值主张", "降为次要论点，不作为主卖点"],
          ["真实数据格式", "影响 Schema 设计", "用原型反推，标注为「假设格式」"],
      ],
      [4.4, 5.2, 6.4], center=(3,))

para(doc, "", space_after=4)
para(doc, "本轮调研到此收口。继续追问同类问题，对方会开始觉得越界，反而损害已建立的关系。剩余缺口靠原型验证与公开材料补，不再依赖访谈。",
     10, first_indent=21)

# ============ 尾 ============
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(12)
r = p.add_run("下一步：把本结论并入 v2.0 第 11 章，并将 H-03a 的判真写入第 3 章「需要验证的痛点假设」。")
set_font(r, 8.5, False, GREY)

doc.save(OUT)
print("saved:", OUT)
