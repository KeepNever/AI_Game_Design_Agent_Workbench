"""规则引擎：把「规则」和「数据」分开。

规则写在独立的规则包里（YAML/JSON），每条只有一句条件表达式 + 元信息：
来源（口述 / 工程 / 模拟阈值）、级别、说明。
这样做的理由不是代码洁癖——是因为**「8 条规则全过」不能对外说成「业务规则全对」**。
来源分层必须留在数据结构里，报告才能按层拆开展示。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import expr
from .model import Config

LEVEL_ORDER = ["阻断", "高", "中", "低"]
SOURCE_LABEL = {
    "oral": "口述",
    "eng": "工程假设",
    "infer": "推断",
    "sim": "模拟阈值",
    "oral+sim": "口述+模拟",
}


@dataclass
class RuleResult:
    rule_id: str
    name: str
    level: str
    source: str
    desc: str
    status: str  # 通过 / 违反 / 无法判定
    detail: str = ""

    @property
    def passed(self) -> bool:
        return self.status == "通过"


@dataclass
class RuleReport:
    results: list[RuleResult] = field(default_factory=list)

    @property
    def violations(self) -> list[RuleResult]:
        return [r for r in self.results if r.status == "违反"]

    @property
    def undecidable(self) -> list[RuleResult]:
        return [r for r in self.results if r.status == "无法判定"]

    def by_source(self) -> dict[str, tuple[int, int]]:
        """按来源返回 (通过数, 总数)——报告里必须分层写，不能合成一个 8/8。"""
        out: dict[str, tuple[int, int]] = {}
        for result in self.results:
            label = SOURCE_LABEL.get(result.source, result.source or "未标注")
            passed, total = out.get(label, (0, 0))
            total += 1
            if result.passed:
                passed += 1
            out[label] = (passed, total)
        return out

    def summary(self) -> str:
        total = len(self.results)
        ok = sum(1 for r in self.results if r.passed)
        parts = [f"{ok}/{total} 通过"]
        if self.violations:
            parts.append(f"{len(self.violations)} 条违反")
        if self.undecidable:
            parts.append(f"{len(self.undecidable)} 条无法判定")
        return "，".join(parts)


def normalize(raw: dict[str, Any], index: int) -> dict[str, Any]:
    """把规则包里的单条规则补全成统一结构。"""
    when = raw.get("when")
    if when is None:
        when = raw.get("check")
    if isinstance(when, str):
        conditions = [when]
    elif isinstance(when, list):
        conditions = [str(item) for item in when]
    else:
        conditions = []
    return {
        "id": raw.get("id") or f"RULE-{index:02d}",
        "name": raw.get("name", ""),
        "level": raw.get("level", "中"),
        "source": raw.get("source", ""),
        "desc": raw.get("desc", ""),
        "conditions": conditions,
        "message": raw.get("message", ""),
    }


def run(config: Config, rules: list[dict[str, Any]]) -> RuleReport:
    namespace = config.namespace()
    report = RuleReport()
    for index, raw in enumerate(rules, start=1):
        rule = normalize(raw, index)
        if not rule["conditions"]:
            report.results.append(
                RuleResult(
                    rule_id=rule["id"],
                    name=rule["name"],
                    level=rule["level"],
                    source=rule["source"],
                    desc=rule["desc"],
                    status="无法判定",
                    detail="规则没有写 when 条件",
                )
            )
            continue
        failures: list[str] = []
        error: str | None = None
        for condition in rule["conditions"]:
            try:
                value = expr.evaluate(condition, namespace)
            except expr.ExprError as exc:
                error = f"{condition} → {exc}"
                break
            if not value:
                failures.append(condition)
        if error:
            status, detail = "无法判定", error
        elif failures:
            status = "违反"
            detail = rule["message"] or f"不满足：{' ∧ '.join(failures)}"
        else:
            status, detail = "通过", rule["desc"]
        report.results.append(
            RuleResult(
                rule_id=rule["id"],
                name=rule["name"],
                level=rule["level"],
                source=rule["source"],
                desc=rule["desc"],
                status=status,
                detail=detail,
            )
        )
    return report
