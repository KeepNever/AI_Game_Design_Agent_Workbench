# -*- coding: utf-8 -*-
"""生成一份「故意难看」的活动配置表，用来压测 loader。

难看点全是真实世界里见过的：
1. 合并单元格当大标题（表头不在第一行）
2. 数字存成文本（"1200"），还带前后空格（" 1200 "）
3. 表头中英文混排（档位ID / ratio / 产出比）
4. 多余的空列、空的间隔行、写在最后一列的备注
5. 引用字段里分隔符混用（顿号 / 分号 / 逗号）
6. 一个没有 id 列的 junk sheet（运营的临时备注）
7. id 一边是数字一边是文本（Excel 里太常见）
"""

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

_HEAD = Font(bold=True, color="FFFFFF")
_FILL = PatternFill("solid", fgColor="17365D")


def _head(ws, row=1):
    for cell in ws[row]:
        if cell.value:
            cell.font = _HEAD
            cell.fill = _FILL


def build(path: str) -> str:
    wb = Workbook()

    # ---- activity：合并标题 + 备注列 + 文本数字 + 空行 ----
    ws = wb.active
    ws.title = "activity"
    ws.merge_cells("A1:C1")
    ws["A1"] = "活动配置 v3（运营填，数值组勿动）"
    ws["A2"], ws["B2"], ws["C2"] = "字段", "值", "备注（系统请忽略）"
    _head(ws, 2)
    for row in [
        ("id", "ACT-DIRTY-01", ""),
        ("name", "霜月祭（脏表版）", ""),
        ("server_open_days", "45", "文本格式的数字"),
        ("open_day_min", 30, ""),
        ("server_population", " 1200 ", "前后带空格"),
        ("", "", ""),  # 空行
        ("duration_days", 7, ""),
        ("lead_time_days", 30, "节庆提前一个月，别改"),
    ]:
        ws.append(row)

    # ---- tiers：表头第二行 + 中文表头 + 文本数字 + 空列 ----
    ws = wb.create_sheet("tiers")
    ws.merge_cells("A1:F1")
    ws["A1"] = "档位配置"
    ws.append(["档位ID", "名称", "产出比", "数量", "取值方式", "声明值", "占比下限", "占比上限", "人数占比", ""])
    _head(ws, 2)
    ws.append(["T_HIGH", "高档", "100", 1, "fixed", "", "", "", "", ""])
    ws.append(["T_MID", "中档", "10", 5, "fixed", 5, "0.003", "0.006", "", "顺手写的"])
    ws.append(["T_LOW", "低档", "1", 120, "ratio_of_population", "", "", "", "0.1", ""])

    # ---- downstream：引用分隔符混用 ----
    ws = wb.create_sheet("downstream")
    ws.append(["对象ID", "对象名称", "类型", "负责人", "引用字段"])
    _head(ws, 1)
    for row in [
        ("OBJ_RANK", "排行榜奖励展示", "UI / 榜单", "系统策划", "tiers.T_HIGH.count、tiers.T_MID.count"),
        ("OBJ_MAIL", "发奖邮件模板", "文案 / 发放", "运营", "tiers.T_LOW.count; tiers.T_MID.count"),
        ("OBJ_ANNOUNCE", "活动公告文案", "文案", "运营", "tiers.T_MID.ratio, items.10086.name"),
        ("OBJ_TOOLTIP", "道具浮窗", "UI", "客户端", "items.10086.name、items.10086.max_stack"),
    ]:
        ws.append(row)

    # ---- items：id 列叫「道具ID」，其它列全是中文（refs 就得用中文路径）----
    ws = wb.create_sheet("items")
    ws.append(["道具ID", "名称", "堆叠上限", "售价"])
    _head(ws, 1)
    ws.append([10086, "霜月结晶", 999, "10"])  # id 是数字，售价是文本
    ws.append(["10087", "霜月徽记", 99, 50])   # id 是文本

    # ---- drops：英文表头 + item_id 链接 ----
    ws = wb.create_sheet("drops")
    ws.append(["id", "name", "item_id", "weight"])
    _head(ws, 1)
    ws.append(["5001", "常规掉落组", "10086", 30])
    ws.append(["5002", "头奖掉落组", "10087", 5])

    # ---- links ----
    ws = wb.create_sheet("links")
    ws.append(["from", "to", "说明"])
    _head(ws, 1)
    ws.append(["drops.item_id", "items", "掉落组绑定道具"])

    # ---- junk：没有 id 列，loader 应该跳过而不是崩 ----
    ws = wb.create_sheet("临时备注")
    ws.append(["时间", "谁写的", "写了什么"])
    ws.append(["2026-11-10", "运营小王", "老板说高档奖励要显眼一点"])

    wb.save(path)
    return path


if __name__ == "__main__":
    import sys

    print(build(sys.argv[1] if len(sys.argv) > 1 else "fixtures/脏表_真实形态.xlsx"))
