import json
from ..skill import Skill, SkillContext


def _fmt(v, suffix=""):
    if v is None:
        return "暂无"
    if isinstance(v, float):
        return f"{v:.2f}{suffix}"
    return f"{v}{suffix}"


class FundamentalAnalysisSkill(Skill):
    name = "fundamental_analysis"
    description = "对投资标的进行基本面分析，包括财务报表、估值指标、成长性等"
    dependencies = ["macro_analysis"]

    def execute(self, ctx: SkillContext) -> dict:
        assets = ctx.data.get("asset_data", [])
        macro = ctx.data.get("macro_analysis", {})
        fundamentals_map = ctx.data.get("fundamentals", {})

        macro_context = json.dumps(macro, ensure_ascii=False)[:200] if macro else ""

        analyses = []
        for asset in assets:
            code = asset.get("code", "")
            code_key = code.strip().upper()
            f = fundamentals_map.get(code_key, {})

            fund_table = (
                f"实时基本面数据（来自数据源）：\n"
                f"- 市盈率 PE(TTM)：{_fmt(f.get('trailing_pe'))}\n"
                f"- 市净率 PB：{_fmt(f.get('price_to_book'))}\n"
                f"- 市值：{_fmt(round(f.get('market_cap', 0) / 1e8, 2), '亿') if f.get('market_cap') else '暂无'}\n"
                f"- 股息率：{_fmt(f.get('dividend_yield') * 100, '%') if f.get('dividend_yield') else '暂无'}\n"
                f"- 每股收益 EPS：{_fmt(f.get('eps'))}\n"
                f"- 净资产收益率 ROE：{_fmt(f.get('return_on_equity') * 100, '%') if f.get('return_on_equity') else '暂无'}\n"
                f"- 每股净资产：{_fmt(f.get('book_value'))}\n"
                f"- 营收增长率：{_fmt(f.get('revenue_growth') * 100, '%') if f.get('revenue_growth') else '暂无'}"
                if f
                else "暂无实时基本面数据"
            )

            prompt = f"""你是一位基本面分析师。请对以下标的进行基本面分析。

标的：{asset.get('name', code)} ({code}, {asset.get('market', '')})
当前价格：{asset.get('current_price', 0)}
买入价格：{asset.get('buy_price', 0)}

宏观环境参考：{macro_context}

{fund_table}

请基于上述真实基本面数据进行评估，不可编造数字。返回 JSON 格式分析：
{{
  "asset_code": "{code}",
  "asset_name": "{asset.get('name', '')}",
  "financial_health": "财务状况分析，引用真实营收/利润/现金流等数据（60字内）",
  "valuation": "估值分析，引用真实PE/PB数据（50字内）",
  "growth": "成长性分析，引用真实增长率数据（50字内）",
  "competitive_advantage": "护城河与竞争优势（40字内）",
  "fundamental_score": 0-100之间的基本面评分,
  "fundamental_rating": "EXCELLENT/GOOD/FAVERAGE/POOR 之一"
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
                    "fundamental_rating": "FAVERAGE",
                    "fundamental_score": 50,
                })

        return {"analyses": analyses}
