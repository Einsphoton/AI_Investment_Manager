import json
from ._base import MarketplaceSkill, SkillContext


class IPOAnalysisSkill(MarketplaceSkill):
    name = "ipo_analysis"
    description = "新股招股书解读、估值对比、打新策略建议"

    def build_prompt(self, ctx: SkillContext) -> str:
        return """你是一位新股分析师。请分析当前新股市场的投资机会。

请返回 JSON：
{
  "market_conditions": "当前新股市场环境",
  "recent_ipos": [
    {
      "name": "公司名称",
      "code": "代码",
      "sector": "行业",
      "valuation": "估值分析",
      "subscription_rating": "申购评级 STRONG/NEUTRAL/AVOID",
      "expected_return": "预期上市涨幅"
    }
  ],
  "subscription_strategy": "打新策略建议",
  "risks": "新股投资风险提示"
}"""
