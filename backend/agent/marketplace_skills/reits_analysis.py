import json
from ._base import MarketplaceSkill, SkillContext


class REITsAnalysisSkill(MarketplaceSkill):
    name = "reits_analysis"
    description = "不动产投资信托基金估值与分红分析"

    def build_prompt(self, ctx: SkillContext) -> str:
        return """你是一位 REITs 分析师。请分析当前 REITs 市场的投资环境。

请返回 JSON：
{
  "market_environment": "REITs 市场环境分析",
  "yield_analysis": "收益率分析（分红率 vs 无风险利率）",
  "sector_performance": "各类型 REITs 表现（办公/零售/住宅/工业/数据中心等）",
  "valuation": "NAV 估值折溢价分析",
  "interest_rate_sensitivity": "利率敏感性分析",
  "top_picks": ["推荐关注的 REITs"]
}"""
