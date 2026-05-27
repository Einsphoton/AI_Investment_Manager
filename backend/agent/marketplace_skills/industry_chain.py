import json
from ._base import MarketplaceSkill, SkillContext


class IndustryChainSkill(MarketplaceSkill):
    name = "industry_chain"
    description = "深度分析产业链上下游关系，挖掘产业链投资机会"

    def build_prompt(self, ctx: SkillContext) -> str:
        assets = ctx.data.get("asset_data", [])
        return f"""你是一位产业链分析师。请分析以下持仓标的所处的产业链位置和机会。

标的：{json.dumps([{"code": a.get("code"), "name": a.get("name"), "market": a.get("market")} for a in assets], ensure_ascii=False)}

请返回 JSON：
{{
  "chain_analysis": [
    {{
      "code": "标的代码",
      "chain_position": "在产业链中的位置",
      "upstream": "上游关键环节",
      "downstream": "下游关键环节",
      "bargaining_power": "上下游议价能力分析",
      "chain_opportunity": "产业链投资机会"
    }}
  ]
}}"""
