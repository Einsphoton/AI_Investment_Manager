import json
from ..skill import Skill, SkillContext


class RecommendationSkill(Skill):
    name = "recommendation"
    description = "基于所有分析结果，生成最终的投资建议和操作策略"
    dependencies = ["macro_analysis", "fundamental_analysis", "technical_analysis", "stock_analysis"]

    def execute(self, ctx: SkillContext) -> dict:
        assets = ctx.data.get("asset_data", [])
        macro = ctx.data.get("macro_analysis", {})
        stock_analysis = ctx.data.get("stock_analysis", {}).get("analyses", [])
        fundamental = ctx.data.get("fundamental_analysis", {}).get("analyses", [])
        technical = ctx.data.get("technical_analysis", {}).get("analyses", [])

        asset_analyses = []
        for asset in assets:
            code = asset.get("code", "")
            sa = next((a for a in stock_analysis if a.get("asset_code") == code), {})
            fa = next((a for a in fundamental if a.get("asset_code") == code), {})
            ta = next((a for a in technical if a.get("asset_code") == code), {})

            prompt = f"""你是一位首席投资顾问。基于以下多维分析数据，为标的生成最终投资建议。

标的：{asset.get('name', code)} ({code})
市场：{asset.get('market', '')}
买入价：{asset.get('buy_price', 0)}
当前价：{asset.get('current_price', 0)}
持有份额：{asset.get('shares', 0)}
持有成本：{asset.get('buy_price', 0) * asset.get('shares', 0):.2f}
当前市值：{asset.get('current_price', 0) * asset.get('shares', 0):.2f}
浮动盈亏：{(asset.get('current_price', 0) - asset.get('buy_price', 0)) * asset.get('shares', 0):.2f}

AI 综合分析：
- 主观判断：{sa.get('ai_opinion', '暂无')}
- 建议：{sa.get('suggestion', 'HOLD')}
- 基本面评级：{fa.get('fundamental_rating', '暂无')}（评分：{fa.get('fundamental_score', 0)}）
- 技术信号：{ta.get('technical_signal', 'NEUTRAL')}（评分：{ta.get('technical_score', 0)}）

请综合所有信息，生成最终投资建议，返回 JSON：
{{
  "asset_code": "{code}",
  "asset_name": "{asset.get('name', '')}",
  "final_suggestion": "BUY/SELL/HOLD/ADD/REDUCE 之一",
  "suggested_action": "具体的操作建议描述（80字内）",
  "suggested_quantity": "建议操作数量（0表示不操作）",
  "target_price": "目标价位",
  "stop_loss": "止损价位",
  "time_horizon": "SHORT/MEDIUM/LONG 之一",
  "confidence_score": 0-100的最终信心评分,
  "summary": "一句话总结（30字内）"
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
                asset_analyses.append(json.loads(resp.choices[0].message.content))
            except Exception:
                asset_analyses.append({
                    "asset_code": code,
                    "asset_name": asset.get("name", ""),
                    "final_suggestion": "HOLD",
                    "summary": "建议暂不可用，保持持有",
                    "confidence_score": 0,
                })

        prompt_summary = f"""基于以下所有资产的分析结果和宏观环境，生成整体投资策略建议。

宏观概况：{json.dumps(macro, ensure_ascii=False)[:200]}
分析结果：{json.dumps(asset_analyses, ensure_ascii=False)[:500]}

返回 JSON：
{{
  "overall_strategy": "整体投资策略（60字内）",
  "risk_level": "当前建议的风险敞口水平（LOW/MEDIUM/HIGH 之一）",
  "suggested_cash_ratio": "建议现金比例（百分比数字）",
  "key_focus": "当前应重点关注的投资方向（60字内）",
  "assets": {json.dumps([a["asset_code"] for a in asset_analyses], ensure_ascii=False)},
  "market_outlook": "市场展望（40字内）"
}}"""

        overall = {}
        try:
            resp = ctx.client.chat.completions.create(
                model=ctx.model,
                messages=[
                    {"role": "system", "content": ctx.system_prompt},
                    {"role": "user", "content": prompt_summary},
                ],
                response_format={"type": "json_object"},
            )
            overall = json.loads(resp.choices[0].message.content)
        except Exception:
            overall = {"overall_strategy": "建议保持当前仓位", "risk_level": "MEDIUM", "suggested_cash_ratio": 30}

        return {
            "asset_recommendations": asset_analyses,
            "overall_strategy": overall,
        }
