"""测试入口：从项目根目录跑 ``python -m unittest discover -s tests -v``。"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIXTURES = ROOT / "fixtures"
CONFIG_V01 = FIXTURES / "activity_v0.1.yaml"
RULES_V01 = FIXTURES / "rules_v0.1.yaml"
CONFIG_5TIER = FIXTURES / "activity_accumulate_5tiers.yaml"
RULES_5TIER = FIXTURES / "rules_accumulate.yaml"
CONFIG_CROSS = FIXTURES / "activity_cross_table.yaml"
RULES_CROSS = FIXTURES / "rules_cross_table.yaml"
CONFIG_REAL = FIXTURES / "真表_宝可梦数据.xlsx"
RULES_REAL = FIXTURES / "rules_real.yaml"
REAL_CSV = FIXTURES / "real"
