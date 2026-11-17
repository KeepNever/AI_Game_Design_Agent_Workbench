# -*- coding: utf-8 -*-
"""JD 矩阵模板 —— 10~15 条目标岗位的结构化采集表"""

try:
    import openpyxl
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "openpyxl>=3.1.0"])
    import openpyxl

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils import get_column_letter

OUT = r"D:/workbuddy/AI_Game_Design_Agent_Workbench/01_招聘调研/JD矩阵模板.xlsx"
TITLE = "JD 矩阵模板"


def xl_color(css_hex: str) -> str:
    value = css_hex.removeprefix("#").upper()
    if len(value) != 6:
        raise ValueError(f"Expected #RRGGBB, got: {css_hex}")
    return "FF" + value


XL_PRIMARY = xl_color("#4472C4")
XL_PRIMARY_DARK = xl_color("#2F5597")
XL_INPUT = xl_color("#D9E2F3")
XL_LIGHT = xl_color("#F2F5FA")
XL_BORDER = xl_color("#BFBFBF")
XL_TEXT = xl_color("#1F2A33")
XL_MUTED = xl_color("#5A6B7B")

thin = Side(style="thin", color=XL_BORDER)
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

HEADER_FONT = Font(name="微软雅黑", size=9, bold=True, color="FFFFFFFF")
BODY_FONT = Font(name="微软雅黑", size=9, color=XL_TEXT)
SMALL_FONT = Font(name="微软雅黑", size=9, color=XL_MUTED)

wb = Workbook()

# ============================================================
# Sheet 1: JD矩阵
# ============================================================
ws = wb.active
ws.title = "JD矩阵"
ws.sheet_properties.tabColor = XL_PRIMARY

COLS = [
    # (表头, 宽度, 类型, 是否判断列)
    ("序号", 6, "seq", False),
    ("公司", 15, "text", False),
    ("岗位名称", 24, "text", False),
    ("城市", 9, "text", False),
    ("招聘类型", 10, "enum", False),
    ("岗位类别", 16, "enum", False),
    ("发布日期", 11, "date", False),
    ("采集日期", 11, "date", False),
    ("来源渠道", 12, "enum", False),
    ("来源链接", 32, "text", False),
    ("是否在招", 9, "enum", False),
    ("工作职责（原文）", 38, "long", False),
    ("硬性要求（原文）", 30, "long", False),
    ("加分项（原文）", 24, "long", False),
    ("能力标签", 13, "enum", True),
    ("匹配度", 14, "enum", True),
    ("项目映射", 32, "long", True),
    ("岗位分层", 9, "enum", True),
    ("备注", 22, "long", False),
]

FILL_JUDGE = PatternFill("solid", fgColor=XL_INPUT)
FIRST_DATA = 2
LAST_DATA = 26          # 预留至 26 行：首轮已录入 20 条，留 5 行余量供继续补充
JUDGE_COLS = {"能力标签", "匹配度", "项目映射", "岗位分层"}

for idx, (name, width, kind, is_judge) in enumerate(COLS, start=1):
    col = get_column_letter(idx)
    c = ws.cell(row=1, column=idx, value=name)
    c.font = HEADER_FONT
    c.fill = PatternFill("solid", fgColor=XL_PRIMARY)
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDER
    ws.column_dimensions[col].width = width

ws.row_dimensions[1].height = 30

DATE_COLS = {"发布日期": 7, "采集日期": 8}
for r in range(FIRST_DATA, LAST_DATA + 1):
    for idx, (name, width, kind, is_judge) in enumerate(COLS, start=1):
        c = ws.cell(row=r, column=idx)
        c.font = BODY_FONT
        c.border = BORDER
        if is_judge:
            c.fill = FILL_JUDGE
        if kind == "long":
            c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        elif kind in ("enum", "seq", "date"):
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        else:
            c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        if kind == "date":
            c.number_format = "YYYY-MM-DD"

# 序号列：B 列为空则不显示
for r in range(FIRST_DATA, LAST_DATA + 1):
    ws.cell(row=r, column=1, value=f'=IF($B{r}="","",ROW()-1)')
    ws.cell(row=r, column=1).alignment = Alignment(horizontal="center", vertical="center")

# 数据验证
def add_dv(ws, formula, cells, prompt_title, prompt):
    dv = DataValidation(type="list", formula1=formula, allow_blank=True, showDropDown=False)
    dv.promptTitle = prompt_title
    dv.prompt = prompt
    dv.showInputMessage = True
    dv.errorTitle = "选项不在清单内"
    dv.error = prompt
    dv.showErrorMessage = True
    ws.add_data_validation(dv)
    dv.add(cells)


rng = f"{FIRST_DATA}:{LAST_DATA}"

def r_(col):
    return f"{col}{FIRST_DATA}:{col}{LAST_DATA}"
add_dv(ws, '"社招,校招,实习,内推,猎头"', r_("E"), "招聘类型", "社招 / 校招 / 实习 / 内推 / 猎头")
add_dv(ws, '"AI游戏产品,游戏策划工具,游戏策划,AI NPC与UGC,AI内容生产,研发工程,AI测试与质量,通用B端AI,项目管理,美术设计"',
       r_("F"), "岗位类别", "按文档 6.2 的六类拆分；研发工程岗不能混进产品岗")
add_dv(ws, '"企业官网,招聘平台,转载聚合,内推"', r_("I"), "来源渠道", "官方网站 / BOSS直聘等平台 / 第三方转载 / 内推")
add_dv(ws, '"是,否,待核实"', r_("K"), "是否在招", "转载信息一律先标待核实，投递前回官网确认")
add_dv(ws, '"业务理解,产品设计,Agent,研发工具,数据评测,跨部门协作"', r_("O"), "能力标签",
       "取最主要的一项，细分能力写进备注")
add_dv(ws, '"已具备,可作品集证明,需真实经验,短期不补"', r_("P"), "匹配度", "不要写百分比，只做四档判断")
add_dv(ws, '"冲刺,主攻,备选"', r_("R"), "岗位分层", "冲刺＝门槛略高；主攻＝最有把握；备选＝第二条出口")

# 条件格式：需真实经验标红、不在招标灰
ws.conditional_formatting.add(
    f"P{FIRST_DATA}:P{LAST_DATA}",
    CellIsRule(operator="equal", formula=['"需真实经验"'],
               fill=PatternFill("solid", fgColor=xl_color("#FFC7CE")),
               font=Font(name="微软雅黑", size=9, color=xl_color("#9C0006")))
)
ws.conditional_formatting.add(
    f"K{FIRST_DATA}:K{LAST_DATA}",
    CellIsRule(operator="equal", formula=['"否"'],
               font=Font(name="微软雅黑", size=9, color=xl_color("#9A9A9A")))
)

ws.auto_filter.ref = f"A1:S{LAST_DATA}"
ws.freeze_panes = "C2"

# ============================================================
# Sheet 2: 能力统计
# ============================================================
st = wb.create_sheet("能力统计")
st.sheet_properties.tabColor = XL_PRIMARY_DARK

st.merge_cells("A1:D1")
t = st["A1"]
t.value = "JD 分布统计（随 JD矩阵 自动更新）"
t.font = Font(name="微软雅黑", size=12, bold=True, color=XL_TEXT)
t.alignment = Alignment(horizontal="left", vertical="center")
st.row_dimensions[1].height = 26

HEAD_ROW = 2
for i, h in enumerate(["维度", "取值", "条数", "占比"], start=1):
    c = st.cell(row=HEAD_ROW, column=i, value=h)
    c.font = HEADER_FONT
    c.fill = PatternFill("solid", fgColor=XL_PRIMARY)
    c.alignment = Alignment(horizontal="center", vertical="center")
    c.border = BORDER

BLOCKS = [
    ("能力标签", ["业务理解", "产品设计", "Agent", "研发工具", "数据评测", "跨部门协作"], "O"),
    ("岗位类别", ["AI游戏产品", "游戏策划工具", "游戏策划", "AI NPC与UGC", "AI内容生产", "研发工程", "AI测试与质量", "通用B端AI"], "F"),
    ("匹配度", ["已具备", "可作品集证明", "需真实经验", "短期不补"], "P"),
    ("岗位分层", ["冲刺", "主攻", "备选"], "R"),
]

row = HEAD_ROW + 1
DATA_FIRST = row
for dim, values, col in BLOCKS:
    start_block = row
    for v in values:
        st.cell(row=row, column=1, value=dim if row == start_block else None)
        st.cell(row=row, column=2, value=v)
        st.cell(row=row, column=3, value=f'=COUNTIF(JD矩阵!${col}${FIRST_DATA}:${col}${LAST_DATA},$B{row})')
        st.cell(row=row, column=4, value=f'=IF(OR($C{row}="",$C${row + 1}=0),"",$C{row}/$C${row + 1})')
        row += 1

DATA_LAST = row - 1
TOTAL_ROW = row

st.cell(row=TOTAL_ROW, column=1, value="合计（JD 总条数）")
st.merge_cells(start_row=TOTAL_ROW, start_column=1, end_row=TOTAL_ROW, end_column=2)
st.cell(row=TOTAL_ROW, column=3, value=f'=COUNTA(JD矩阵!$B${FIRST_DATA}:$B${LAST_DATA})')

# 占比公式统一指向合计行
for r in range(DATA_FIRST, DATA_LAST + 1):
    st.cell(row=r, column=4, value=f'=IF(OR($C{r}="",$C${TOTAL_ROW}=0),"",$C{r}/$C${TOTAL_ROW})')

for r in range(DATA_FIRST, TOTAL_ROW + 1):
    for c_idx in range(1, 5):
        c = st.cell(row=r, column=c_idx)
        c.font = BODY_FONT
        c.border = BORDER
        if c_idx == 3:
            c.alignment = Alignment(horizontal="center", vertical="center")
            c.number_format = "0"
        elif c_idx == 4:
            c.alignment = Alignment(horizontal="center", vertical="center")
            c.number_format = "0.0%"
        else:
            c.alignment = Alignment(horizontal="left", vertical="center")

for c_idx in range(1, 5):
    c = st.cell(row=TOTAL_ROW, column=c_idx)
    c.font = Font(name="微软雅黑", size=9, bold=True, color="FFFFFFFF")
    c.fill = PatternFill("solid", fgColor=XL_PRIMARY_DARK)
    c.border = BORDER

for col, w in zip("ABCD", [14, 22, 10, 10]):
    st.column_dimensions[col].width = w
st.freeze_panes = f"A{HEAD_ROW + 1}"

# ============================================================
# Sheet 3: 填写说明
# ============================================================
doc = wb.create_sheet("填写说明")
doc.sheet_properties.tabColor = XL_MUTED

doc.merge_cells("A1:D1")
d = doc["A1"]
d.value = "填写说明与采集纪律"
d.font = Font(name="微软雅黑", size=12, bold=True, color=XL_TEXT)
d.alignment = Alignment(horizontal="left", vertical="center")
doc.row_dimensions[1].height = 26

FIELDS = [
    ("序号", "自动", "B 列有公司名才显示，不用手填。"),
    ("公司", "必填", "写招聘主体，不是外包或中介。"),
    ("岗位名称", "必填", "照抄 JD 原名，不要改写成自己习惯的叫法。"),
    ("城市", "必填", "多城市写主要base地。"),
    ("招聘类型", "必填", "社招 / 校招 / 实习 / 内推 / 猎头。"),
    ("岗位类别", "必填", "按文档 6.2 拆分；研发工程岗不要混成产品岗。"),
    ("发布日期", "必填", "JD 上的发布或更新时间，没有就写采集日期并注明。"),
    ("采集日期", "必填", "你看到这一条的日期，用于判断时效。"),
    ("来源渠道", "必填", "官方网站 / 招聘平台 / 转载聚合 / 内推。"),
    ("来源链接", "必填", "原始链接，不要只存截图。"),
    ("是否在招", "必填", "转载信息先标「待核实」，投递前回官网确认。"),
    ("工作职责（原文）", "必填", "原样摘录，不要先用自己的话改写——改写会丢掉关键词，后面统计能力频次就失真。"),
    ("硬性要求（原文）", "必填", "年限、学历、行业经验、引擎或代码要求。"),
    ("加分项（原文）", "选填", "UE/Unity、Agent、RAG、MCP、评测、UGC、策划经历等。"),
    ("能力标签", "必填", "只选最主要的一项，细分写进备注；这一列是频次统计的依据。"),
    ("匹配度", "必填", "已具备 / 可作品集证明 / 需真实经验 / 短期不补。四档判断，不写百分比。"),
    ("项目映射", "必填", "写明本项目哪一个页面、功能、文档或指标能证明这项能力。填不出就说明这条要求当前无法回应。"),
    ("岗位分层", "必填", "冲刺 / 主攻 / 备选。"),
    ("备注", "选填", "补充判断、面试传闻、团队情况。"),
]

hdr_row = 3
for i, h in enumerate(["字段", "是否必填", "填写规则"], start=1):
    c = doc.cell(row=hdr_row, column=i, value=h)
    c.font = HEADER_FONT
    c.fill = PatternFill("solid", fgColor=XL_PRIMARY)
    c.alignment = Alignment(horizontal="center", vertical="center")
    c.border = BORDER

r = hdr_row + 1
for name, req, rule in FIELDS:
    for i, v in enumerate([name, req, rule], start=1):
        c = doc.cell(row=r, column=i, value=v)
        c.font = BODY_FONT
        c.border = BORDER
        c.alignment = Alignment(horizontal="left" if i == 3 else "center",
                                vertical="top" if i == 3 else "center",
                                wrap_text=True)
    r += 1

r += 1
doc.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
c = doc.cell(row=r, column=1, value="采集纪律")
c.font = Font(name="微软雅黑", size=10, bold=True, color=XL_TEXT)
c.alignment = Alignment(horizontal="left", vertical="center")

RULES = [
    "1. 首轮收集 10–15 条高相关 JD，优先最近 3–6 个月发布或更新的岗位。",
    "2. 每条 JD 必须存：原文截图或文本、链接、采集日期、页面状态。链接失效时截图是唯一证据。",
    "3. 区分官方与转载。第三方转载只能用来发现岗位，不能当能力要求的证据；投递前回官网核实。",
    "4. 产品岗、策划岗、研发工程岗分开记，不要把 AI Agent 开发工程师当成产品经理 JD 统计。",
    "5. 至少 5 条来自游戏公司或游戏工具公司，否则样本会偏向通用 B 端，后面岗位分层会失真。",
    "6. 摘录职责和硬性要求时保持原文。用自己的话改写会让高频词统计失效，也会掩盖真实门槛。",
    "7. 填不出「项目映射」的条目不是废数据——它恰好标记了作品集暂时补不上的缺口，单独留着。",
]

r += 1
for line in RULES:
    doc.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
    c = doc.cell(row=r, column=1, value=line)
    c.font = BODY_FONT
    c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    doc.row_dimensions[r].height = 30
    r += 1

r += 1
doc.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
c = doc.cell(row=r, column=1, value="本阶段完成标准（对应文档 6.5）")
c.font = Font(name="微软雅黑", size=10, bold=True, color=XL_TEXT)

CHECKS = [
    "☐ 完成 10–15 条 JD 原文收集，至少 5 条来自游戏公司或游戏工具公司。",
    "☐ 区分产品岗、策划岗、研发工程岗，不把研发工程师当产品经理。",
    "☐ 整理出 5–7 个反复出现的能力要求，并标注出现在哪些职位。",
    "☐ 把目标岗位分成冲刺、主攻、备选三档。",
    "☐ 明确本项目要证明的 3–4 项能力，不试图满足所有 JD。",
]

r += 1
for line in CHECKS:
    doc.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
    c = doc.cell(row=r, column=1, value=line)
    c.font = BODY_FONT
    c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    doc.row_dimensions[r].height = 22
    r += 1

doc.column_dimensions["A"].width = 20
doc.column_dimensions["B"].width = 10
doc.column_dimensions["C"].width = 88
doc.sheet_view.showGridLines = False

wb.calculation.fullCalcOnLoad = True
wb.properties.title = TITLE
wb.save(OUT)
print("saved:", OUT)
