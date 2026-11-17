"""Game Design Workbench · 设计配置变更影响分析。

v0.1 的边界：只沿**已登记**的引用关系推导影响面，不做语义猜测，
不覆盖公告文案里手写的数字。边界写在 README 里，不藏在代码注释里。
"""

__version__ = "0.1.0"

from .deps import Analysis, analyze, build_index, impacted  # noqa: F401
from .model import Config, ConfigError  # noqa: F401
from .rules import RuleReport, run  # noqa: F401

__all__ = [
    "Analysis",
    "Config",
    "ConfigError",
    "RuleReport",
    "analyze",
    "build_index",
    "impacted",
    "run",
]
