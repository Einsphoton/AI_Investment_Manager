import json
from ._base import MarketplaceSkill, SkillContext


class GlobalMarketsSkill(MarketplaceSkill):
    name = "global_markets"
    description = "追踪全球主要股指、商品、汇率、债券市场的联动变化"

    def build_prompt(self, ctx: SkillContext) -> str:
        return """你是一位全球市场分析师。请分析当前全球主要市场的表现和联动关系。

请返回 JSON：
{
  "major_indices": {
    "us": "美股市场表现及展望",
    "china": "A 股/港股表现及展望",
    "europe": "欧洲市场表现及展望",
    "japan": "日本市场表现及展望",
    "emerging": "新兴市场表现及展望"
  },
  "commodities": "大宗商品市场动向",
  "forex": "主要汇率走势",
  "cross_market_correlation": "跨市场相关性分析",
  "global_liquidity": "全球流动性状况",
  "impact_on_portfolio": "对投资组合的潜在影响"
}"""
