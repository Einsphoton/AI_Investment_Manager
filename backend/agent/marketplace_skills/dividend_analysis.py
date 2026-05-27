import json
from ._base import MarketplaceSkill, SkillContext


class DividendAnalysisSkill(MarketplaceSkill):
    name = "dividend_analysis"
    description = "分析上市公司分红政策、股息率、除权除息日历"

    def build_prompt(self, ctx: SkillContext) -> str:
        assets = ctx.data.get("asset_data", [])
        return f"""你是一位红利策略分析师。请分析以下标的的分红情况。

标的：{json.dumps([{"code": a.get("code"), "name": a.get("name"), "price": a.get("current_price", 0)} for a in assets], ensure_ascii=False)}

请返回 JSON：
{{
  "dividend_analysis": [
    {{
      "code": "标的代码",
      "estimated_dividend_yield": "估算股息率",
      "payout_ratio": "派息比率分析",
      "dividend_growth": "分红增长趋势",
      "sustainability": "分红可持续性 HIGH/MEDIUM/LOW",
      "ex_dividend_date": "预计除权除息时间"
    }}
  ],
  "divident_strategy": "红利策略建议"
}}"""
