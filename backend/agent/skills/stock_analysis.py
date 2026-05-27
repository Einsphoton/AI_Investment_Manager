import json
from ..skill import Skill, SkillContext


def _fmt(v, suffix=""):
    if v is None:
        return "暂无"
    if isinstance(v, float):
        return f"{v:.2f}{suffix}"
    return f"{v}{suffix}"


class StockAnalysisSkill(Skill):
    name = "stock_analysis"
    description = "对个股/基金进行深度分析，结合市场数据和公司基本面"
    dependencies = ["macro_analysis"]

    def execute(self, ctx: SkillContext) -> dict:
        assets = ctx.data.get("asset_data", [])
        macro = ctx.data.get("macro_analysis", {})
        fundamentals_map = ctx.data.get("fundamentals", {})
        macro_summary = json.dumps(macro, ensure_ascii=False)[:300] if macro else "暂无宏观数据"

        analyses = []
        for asset in assets:
            code_key = asset.get("code", "").strip().upper()
            f = fundamentals_map.get(code_key, {})
            fund_line = (
                f"PE(TTM)={_fmt(f.get('trailing_pe'))}, PB={_fmt(f.get('price_to_book'))}, "
                f"市值={_fmt(round(f.get('market_cap', 0) / 1e8, 2), '亿') if f.get('market_cap') else 'N/A'}"
                if f
                else "暂无实时基本面数据"
            )

            prompt = f"""你是一位专业证券分析师。请对以下投资标的进行分析。

标的名称：{asset.get('name', asset.get('code', '未知'))}
代码：{asset.get('code', '')}
市场：{asset.get('market', '')}
类型：{asset.get('asset_type', '')}
买入价格：{asset.get('buy_price', 0)}
当前价格：{asset.get('current_price', 0)}
持有份额：{asset.get('shares', 0)}
实时基本面：{fund_line}

当前宏观环境参考：
{macro_summary}

请基于上述真实基本面数据进行评估，不可编造数字。返回 JSON：
{{
  "asset_code": "{asset.get('code', '')}",
  "asset_name": "{asset.get('name', '')}",
  "market_overview": "该标的市场环境分析（50字内）",
  "industry_position": "行业地位与竞争力分析（50字内）",
  "business_analysis": "业务模式与增长动力分析（50字内）",
  "risk_warning": "主要风险提示（50字内）",
  "ai_opinion": "AI 综合主观判断（80字内）",
  "suggestion": "BUY/HOLD/SELL 之一",
  "suggestion_reason": "建议理由（50字内）",
  "confidence": 0-100之间的信心分数
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
                result = json.loads(resp.choices[0].message.content)
                result["buy_price"] = asset.get("buy_price", 0)
                result["current_price"] = asset.get("current_price", 0)
                result["shares"] = asset.get("shares", 0)
                analyses.append(result)
            except Exception:
                analyses.append({
                    "asset_code": asset.get("code", ""),
                    "asset_name": asset.get("name", ""),
                    "ai_opinion": "AI 分析暂不可用",
                    "suggestion": "HOLD",
                    "confidence": 0,
                })

        return {"analyses": analyses}
