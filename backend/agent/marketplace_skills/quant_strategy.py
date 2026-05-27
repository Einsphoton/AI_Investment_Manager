import json
from ._base import MarketplaceSkill, SkillContext


class QuantStrategySkill(MarketplaceSkill):
    name = "quant_strategy"
    description = "提供多因子模型、趋势跟踪等量化策略的历史回测与优化"

    def build_prompt(self, ctx: SkillContext) -> str:
        assets = ctx.data.get("asset_data", [])
        return f"""你是一位量化策略分析师。请基于量化分析框架评估持仓标的。

标的：{json.dumps([a.get("code") for a in assets], ensure_ascii=False)}

请返回 JSON：
{{
  "strategy_signals": [
    {{
      "code": "标的代码",
      "momentum_score": "动量因子评分 0-100",
      "value_score": "价值因子评分 0-100",
      "quality_score": "质量因子评分 0-100",
      "volatility_score": "波动率评分 0-100",
      "composite_signal": "综合信号 STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL",
      "suggested_position": "建议仓位比例"
    }}
  ],
  "portfolio_metrics": {{
    "sharpe_ratio": "估算夏普比率",
    "max_drawdown": "估算最大回撤",
    "beta": "组合 Beta"
  }}
}}"""
