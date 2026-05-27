import json
from ._base import MarketplaceSkill, SkillContext


class ESGAnalysisSkill(MarketplaceSkill):
    name = "esg_analysis"
    description = "环境、社会与治理评分，可持续投资策略分析"

    def build_prompt(self, ctx: SkillContext) -> str:
        assets = ctx.data.get("asset_data", [])
        return f"""你是一位 ESG 投资分析师。请分析以下标的的 ESG 表现。

标的：{json.dumps([{"code": a.get("code"), "name": a.get("name")} for a in assets], ensure_ascii=False)}

请返回 JSON：
{{
  "esg_scores": [
    {{
      "code": "标的代码",
      "environmental": "环境评分 0-100",
      "social": "社会评分 0-100",
      "governance": "治理评分 0-100",
      "esg_rating": "AAA/AA/A/BBB/BB/B/CCC 综合评级",
      "key_issues": ["主要 ESG 议题"],
      "controversies": ["争议事件"]
    }}
  ],
  "esg_trend": "ESG 投资趋势分析",
  "sustainable_opportunities": "可持续投资机会"
}}"""
