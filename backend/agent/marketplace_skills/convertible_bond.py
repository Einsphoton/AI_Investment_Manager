import json
from ._base import MarketplaceSkill, SkillContext


class ConvertibleBondSkill(MarketplaceSkill):
    name = "convertible_bond"
    description = "可转债定价、溢价率分析、转股套利机会识别"

    def build_prompt(self, ctx: SkillContext) -> str:
        return """你是一位可转债分析师。请分析当前可转债市场的投资机会。

请返回 JSON：
{
  "market_overview": "可转债市场整体状况",
  "valuation": "估值水平分析（溢价率、纯债价值等）",
  "arbitrage_opportunities": "潜在的转股套利机会",
  "risk_metrics": "风险指标（到期收益率、久期等）",
  "strategy": "当前可转债投资策略建议"
}"""
