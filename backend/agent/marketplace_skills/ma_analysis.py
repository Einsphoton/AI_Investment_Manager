import json
from ._base import MarketplaceSkill, SkillContext


class MAAnalysisSkill(MarketplaceSkill):
    name = "ma_analysis"
    description = "并购重组事件驱动策略，分析交易结构与协同效应"

    def build_prompt(self, ctx: SkillContext) -> str:
        return """你是一位并购重组分析师。请分析当前市场的并购重组动态。

请返回 JSON：
{
  "market_overview": "并购重组市场总体活跃度",
  "recent_deals": [
    {
      "acquirer": "收购方",
      "target": "标的方",
      "sector": "行业",
      "deal_value": "交易金额",
      "synergy_analysis": "协同效应分析",
      "arbitrage_spread": "套利空间分析"
    }
  ],
  "regulatory_environment": "监管环境分析",
  "strategy": "事件驱动策略建议"
}"""
