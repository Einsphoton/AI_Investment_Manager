from __future__ import annotations
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Optional

from openai import OpenAI

from parallel_executor import get_parallel_config
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

    def _get_skill_deps(self) -> dict[str, set[str]]:
        """Get a set of dependencies for each skill."""
        deps: dict[str, set[str]] = {}
        for name, skill in self.skills.items():
            deps[name] = set(skill.dependencies)
        return deps

    def execute(self, goal: str, asset_data: list[dict] | None = None) -> dict:
        """Execute analysis plan, optionally with parallel skill execution."""
        self.results = {"goal": goal, "asset_data": asset_data or [], "steps": []}
        plan = self.plan_analysis(goal, asset_data)
        self.ctx.data["asset_data"] = asset_data or []
        self.ctx.data["goal"] = goal

        # Check if parallel execution is enabled
        parallel_enabled = False
        try:
            if self.ctx.db_session:
                pcfg = get_parallel_config(self.ctx.db_session)
                parallel_enabled = pcfg.enabled and pcfg.parallel_skills and pcfg.max_workers > 1
        except Exception:
            pass

        if parallel_enabled:
            self._execute_parallel(plan)
        else:
            self._execute_sequential(plan)

        return self._compile_report()

    def _execute_sequential(self, plan: AnalysisPlan):
        """Execute skills sequentially in plan order."""
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

    def _execute_parallel(self, plan: AnalysisPlan):
        """
        Execute skills in parallel levels based on dependency analysis.
        Skills that only depend on already-completed skills run concurrently.
        """
        # Only consider skills that are in the plan
        active_skills = {name: self.skills[name] for name in plan.steps if name in self.skills}

        if not active_skills:
            return

        # Get execution levels based on dependencies
        deps = {name: set(s.dependencies) & set(active_skills.keys())
                for name, s in active_skills.items()}
        levels: list[list[str]] = []
        remaining = set(active_skills.keys())
        processed: set[str] = set()

        while remaining:
            current_level = [
                name for name in remaining
                if deps[name].issubset(processed)
            ]
            if not current_level:
                current_level = list(remaining)
                break
            levels.append(current_level)
            processed.update(current_level)
            remaining -= set(current_level)

        max_workers = 3
        try:
            if self.ctx.db_session:
                pcfg = get_parallel_config(self.ctx.db_session)
                max_workers = min(pcfg.max_workers, 6)
        except Exception:
            pass

        # Execute level by level
        for level in levels:
            if len(level) <= 1:
                # Single skill - execute directly
                name = level[0]
                skill = active_skills[name]
                for dep in skill.dependencies:
                    dep_result = self.results.get(dep)
                    if dep_result:
                        self.ctx.data[dep] = dep_result
                try:
                    self.results[name] = skill.execute(self.ctx)
                except Exception as e:
                    self.results[name] = {"error": str(e), "fallback": True}
                self.results["steps"].append(name)
                self.ctx.data[name] = self.results[name]
            else:
                # Multiple skills at same level - execute in parallel
                with ThreadPoolExecutor(max_workers=min(max_workers, len(level))) as executor:
                    def run_skill(skill_name: str) -> tuple[str, dict]:
                        s = active_skills[skill_name]
                        for dep in s.dependencies:
                            dep_result = self.results.get(dep)
                            if dep_result:
                                self.ctx.data[dep] = dep_result
                        try:
                            return skill_name, s.execute(self.ctx)
                        except Exception as e:
                            return skill_name, {"error": str(e), "fallback": True}

                    futures = {executor.submit(run_skill, name): name for name in level}
                    for future in as_completed(futures):
                        name, result = future.result()
                        self.results[name] = result
                        self.results["steps"].append(name)
                        self.ctx.data[name] = result

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
