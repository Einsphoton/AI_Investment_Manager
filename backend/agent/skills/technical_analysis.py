import json
from ..skill import Skill, SkillContext


class TechnicalAnalysisSkill(Skill):
    name = "technical_analysis"
    description = "对投资标的进行技术面分析，包括趋势、支撑位/阻力位、技术指标等"
    dependencies = ["macro_analysis"]

    def execute(self, ctx: SkillContext) -> dict:
        assets = ctx.data.get("asset_data", [])
        history_map = ctx.data.get("history", {})

        analyses = []
        for asset in assets:
            code = asset.get("code", "")
            code_key = code.strip().upper()
            raw = history_map.get(code_key, [])

            prices = []
            if raw:
                for bar in raw:
                    p = bar.get("price")
                    if p:
                        prices.append(p)

            if not prices:
                prices = [asset.get("current_price", 0)]

            buy_price = asset.get("buy_price", 0)
            current_price = prices[-1] if prices else asset.get("current_price", 0)
            change_pct = ((current_price - buy_price) / buy_price * 100) if buy_price else 0

            price_preview = prices[-30:] if len(prices) > 30 else prices

            prompt = f"""你是一位技术分析师。请对以下标的技术分析。

标的：{asset.get('name', code)} ({code})
最近{len(price_preview)}个交易日收盘价：{price_preview}
买入价：{buy_price}
当前价：{current_price}
涨跌幅：{change_pct:.2f}%

请基于上述真实价格数据进行技术分析。返回 JSON 格式分析：
{{
  "asset_code": "{code}",
  "asset_name": "{asset.get('name', '')}",
  "trend": "趋势判断（上升/下降/震荡）及分析（40字内）",
  "support_level": "关键支撑位",
  "resistance_level": "关键阻力位",
  "momentum": "动量分析（量价关系等，40字内）",
  "technical_score": 0-100之间的技术面评分,
  "technical_signal": "BULLISH/NEUTRAL/BEARISH 之一"
}}"""
            try:
                resp = ctx.client.chat.completions.create(
                    model=ctx.model,
                    messages=[
                        {"role": "system", "content": ctx.system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    response_format={"type": "json_object"},
                )
                analyses.append(json.loads(resp.choices[0].message.content))
            except Exception:
                analyses.append({
                    "asset_code": code,
                    "asset_name": asset.get("name", ""),
                    "trend": "分析暂不可用",
                    "technical_signal": "NEUTRAL",
                    "technical_score": 50,
                })

        return {"analyses": analyses}
