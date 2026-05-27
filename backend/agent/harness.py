from __future__ import annotations
import json
from dataclasses import dataclass, field
from typing import Any, Optional

from openai import OpenAI

from .skill import Skill, SkillContext
from .skills import (
    MacroAnalysisSkill, StockAnalysisSkill, TushareFinanceSkill,
    FundamentalAnalysisSkill, TechnicalAnalysisSkill, RecommendationSkill,
    TargetAnalysisSkill,
)
from .marketplace_skills import get_marketplace_skill_class


CORE_SKILL_CLASSES = {
    "macro_analysis": MacroAnalysisSkill,
    "stock_analysis": StockAnalysisSkill,
    "tushare_finance": TushareFinanceSkill,
    "fundamental_analysis": FundamentalAnalysisSkill,
    "technical_analysis": TechnicalAnalysisSkill,
    "recommendation": RecommendationSkill,
    "target_analysis": TargetAnalysisSkill,
}


@dataclass
class AnalysisPlan:
    steps: list[str] = field(default_factory=list)
    context: dict = field(default_factory=dict)


class AgentHarness:
    def __init__(self, ctx: SkillContext):
        self.ctx = ctx
        self.skills: dict[str, Skill] = {}
        self.results: dict[str, Any] = {}
        self.client = OpenAI(api_key=ctx.api_key, base_url=ctx.base_url or None)
        ctx.client = self.client

    def register_skill(self, skill: Skill):
        self.skills[skill.name] = skill
        for dep in skill.dependencies:
            if dep not in self.skills and dep not in CORE_SKILL_CLASSES:
                continue

    def load_skills(self, installed_skill_ids: set[str] | None = None):
        for sid, cls in CORE_SKILL_CLASSES.items():
            if sid not in self.skills:
                self.register_skill(cls())

        if installed_skill_ids:
            for sid in installed_skill_ids:
                if sid in self.skills or sid in CORE_SKILL_CLASSES:
                    continue
                cls = get_marketplace_skill_class(sid)
                if cls:
                    try:
                        self.register_skill(cls())
                    except Exception:
                        pass

    def plan_analysis(self, goal: str, asset_data: list[dict] | None = None) -> AnalysisPlan:
        prompt = f"""{self.ctx.system_prompt}

作为 AI 投资分析系统的规划器，请为以下分析目标制定执行计划。

分析目标：{goal}

可用技能：
{chr(10).join(f'- {n}: {s.description}' for n, s in self.skills.items())}

请返回 JSON 格式的计划：
{{
  "steps": ["技能名称列表，按执行顺序排列"],
  "context": {{ "额外的上下文信息" }}
}}"""

        try:
            resp = self.client.chat.completions.create(
                model=self.ctx.model,
                messages=[
                    {"role": "system", "content": self.ctx.system_prompt},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
            )
            plan_data = json.loads(resp.choices[0].message.content)
            return AnalysisPlan(
                steps=plan_data.get("steps", []),
                context=plan_data.get("context", {}),
            )
        except Exception:
            return AnalysisPlan(steps=list(self.skills.keys()))

    def execute(self, goal: str, asset_data: list[dict] | None = None) -> dict:
        self.results = {"goal": goal, "asset_data": asset_data or [], "steps": []}
        plan = self.plan_analysis(goal, asset_data)
        self.ctx.data["asset_data"] = asset_data or []
        self.ctx.data["goal"] = goal

        for step_name in plan.steps:
            if step_name not in self.skills:
                continue
            skill = self.skills[step_name]
            for dep in skill.dependencies:
                if dep in self.results.get("steps", []):
                    dep_result = self.results.get(dep)
                    if dep_result:
                        self.ctx.data[dep] = dep_result

            try:
                result = skill.execute(self.ctx)
            except Exception as e:
                result = {"error": str(e), "fallback": True}

            self.results[step_name] = result
            self.results["steps"].append(step_name)
            self.ctx.data[step_name] = result

        return self._compile_report()

    def _compile_report(self) -> dict:
        report = {
            "goal": self.results.get("goal", ""),
            "macro_analysis": self.results.get("macro_analysis", {}),
            "asset_analyses": [],
            "recommendations": self.results.get("recommendation", {}),
            "summary": "",
        }

        for step_name, result in self.results.items():
            if step_name.startswith("analyze_") and isinstance(result, dict):
                report["asset_analyses"].append(result)

        try:
            steps_summary = "\n".join(
                f"## {s}\n{json.dumps(self.results.get(s, {}), ensure_ascii=False, indent=2)[:500]}"
                for s in self.results.get("steps", [])
                if s in self.results
            )
            prompt = f"""基于以下所有分析步骤的结果，生成一份完整的投资分析报告摘要（200字以内）。

{steps_summary}

请用中文返回 JSON：
{{"summary": "报告摘要"}}"""

            resp = self.client.chat.completions.create(
                model=self.ctx.model,
                messages=[
                    {"role": "system", "content": self.ctx.system_prompt},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
            )
            summary_data = json.loads(resp.choices[0].message.content)
            report["summary"] = summary_data.get("summary", "")
        except Exception:
            report["summary"] = "分析完成"

        return report
