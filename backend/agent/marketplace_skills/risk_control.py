import json
from ._base import MarketplaceSkill, SkillContext


class RiskControlSkill(MarketplaceSkill):
    name = "risk_control"
    description = "VaR 计算、压力测试、尾部风险建模等风控能力"

    def build_prompt(self, ctx: SkillContext) -> str:
        assets = ctx.data.get("asset_data", [])
        return f"""你是一位风险控制专家。请分析投资组合的风险状况。

组合详情：{json.dumps([{"code": a.get("code"), "name": a.get("name"), "value": a.get("current_price", 0) * a.get("shares", 0)} for a in assets], ensure_ascii=False)}

请返回 JSON：
{{
  "var_95": "95% VaR 估算值",
  "var_99": "99% VaR 估算值",
  "max_drawdown_estimate": "最大回撤估算",
  "concentration_risk": "集中度风险评估",
  "correlation_risk": "相关性风险",
  "tail_risk": "尾部风险评估",
  "suggested_hedges": ["建议的对冲策略"]
}}"""
