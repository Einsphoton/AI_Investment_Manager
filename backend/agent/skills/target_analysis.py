from ..skill import Skill, SkillContext
from ai_service import parse_ai_json_object, sanitize_ai_payload


def _fmt(v, suffix=""):
    if v is None:
        return "暂无"
    if isinstance(v, float):
        return f"{v:.2f}{suffix}"
    return f"{v}{suffix}"


class TargetAnalysisSkill(Skill):
    name = "target_analysis"
    description = "AI 标的分析与推荐引擎：结合基本面、技术面、宏观微观信息深度分析并推荐标的"
    dependencies = ["macro_analysis"]

    def _normalize_result(self, raw) -> dict:
        raw = sanitize_ai_payload(raw if isinstance(raw, dict) else {})
        existing = raw.get("existing_targets_analysis") or raw.get("existing_analysis") or []
        recommendations = (
            raw.get("new_recommendations")
            or raw.get("recommendations")
            or raw.get("recommended_targets")
            or raw.get("targets")
            or []
        )
        if isinstance(recommendations, dict):
            recommendations = (
                recommendations.get("items")
                or recommendations.get("targets")
                or recommendations.get("new_recommendations")
                or recommendations.get("asset_recommendations")
                or []
            )
        if not isinstance(existing, list):
            existing = []
        if not isinstance(recommendations, list):
            recommendations = []
        return {
            **raw,
            "existing_targets_analysis": existing,
            "new_recommendations": [item for item in recommendations if isinstance(item, dict)],
            "market_insight": raw.get("market_insight") or raw.get("summary") or "标的分析完成",
            "source": "ai",
        }

    def execute(self, ctx: SkillContext) -> dict:
        user_targets = ctx.data.get("target_data", [])
        macro = ctx.data.get("macro_analysis", {})
        import json
        macro_json = json.dumps(macro, ensure_ascii=False)[:800] if macro else "{}"
        allowed_markets = ctx.data.get("recommend_markets") or ["A", "HK", "US"]
        allowed_asset_types = ctx.data.get("recommend_asset_types") or ["stock", "onshore_fund", "offshore_fund"]

        # Build a concise fundamental-data table for the AI to reference
        target_table = []
        for t in user_targets:
            f = t.get("fundamentals") or {}
            row = {
                "code": t.get("code", ""),
                "name": t.get("name", ""),
                "market": t.get("market", ""),
                "price": t.get("current_price"),
                "change_pct": t.get("change_pct"),
                "PE": f.get("trailing_pe"),
                "forward_PE": f.get("forward_pe"),
                "PB": f.get("price_to_book"),
                "market_cap_亿": round(f["market_cap"] / 1e8, 2) if f.get("market_cap") else None,
                "dividend_yield": _fmt(f.get("dividend_yield") * 100, "%") if f.get("dividend_yield") else None,
                "dividend_rate": _fmt(f.get("dividend_rate"), "元"),
                "EPS": _fmt(f.get("eps")),
                "ROE": _fmt(f.get("return_on_equity") * 100, "%") if f.get("return_on_equity") else None,
                "revenue_growth": _fmt(f.get("revenue_growth") * 100, "%") if f.get("revenue_growth") else None,
                "book_value": _fmt(f.get("book_value")),
            }
            target_table.append(row)

        prompt = f"""你是一位专业的 AI 投资标的分析推荐引擎，擅长从基本面、技术面、宏观和微观信息多个维度综合分析投资标的。

当前宏观环境：
{macro_json}

以下是用户关注的每个标的的**实时基本面数据**（从数据源直接获取），请基于这些真实数据进行分析，不要编造数字：
{json.dumps(target_table, ensure_ascii=False, indent=2)}

本次允许推荐的市场：{", ".join(allowed_markets)}
本次允许推荐的资产类型：{", ".join(allowed_asset_types)}

请执行以下任务：

1. **分析现有标的**：对每个标的进行全面深度评估，判断是否还值得继续关注
2. **推荐新标的**：基于当前市场环境，推荐 3-5 个新的投资标的
3. **更新理由**：说明为什么要新增或移除某些标的

要求：
- **所有基本面数据必须基于上面提供的真实数据**，不可编造
- 对每个标的的分析请包含：基本面（引用真实 PE/PB/ROE 等）、技术面（基于当前价格和涨跌幅推断）、宏观影响、催化剂、核心投资逻辑
- 基本面分析部分请明确引用实时数据（如"当前PE为xx倍，PB为xx倍"）
- 对“推荐新标的”，上表没有实时基本面数据时，不得写具体 PE、PB、股息率、分红率、营收增速、ROE 等数字；只能写“需以后端实时数据验证”或使用不含数字的定性描述。
- 不得使用训练记忆或常识补全财务数字；缺失字段必须写“暂无实时数据”，不要估算。
- 推荐新标的时，market 只能使用 A/HK/US；asset_type 只能使用 stock/onshore_fund/offshore_fund。
- 推荐新标的时，如能给出目标价，请在 target_price 写纯数字；如依据不足请写 null，不要把百分比或文字放进该字段。
- 即使当前关注标的为空，也必须基于宏观环境和允许范围推荐 3-5 个新标的。

返回 JSON 格式（请确保返回的 JSON 严格符合以下结构）：
{{
  "existing_targets_analysis": [
    {{
      "code": "标的代码",
      "name": "标的名称",
      "market": "市场",
      "keep": true/false,
      "reason": "保留/移除理由（30字内）",
      "priority": "HIGH/MEDIUM/LOW",
      "analysis": {{
        "fundamental": "基本面分析，必须引用上表中的真实PE/PB/ROE等数据（100-200字）",
        "technical": "技术面分析，包括趋势、动量、关键价位等（80-150字）",
        "macro_impact": "宏观环境影响分析（80-150字）",
        "micro_catalysts": "微观催化剂/事件驱动因素（80-150字）",
        "investment_thesis": "核心投资逻辑与结论，说明现在是否应该投资及理由（80-150字）"
      }}
    }}
  ],
  "new_recommendations": [
    {{
      "code": "推荐标的代码",
      "name": "推荐标的名称",
      "market": "A/HK/US",
      "asset_type": "stock/offshore_fund/onshore_fund",
      "reason": "推荐理由（50字内）",
      "expected_return": "预期收益区间",
      "target_price": 123.45,
      "risk_level": "LOW/MEDIUM/HIGH",
      "priority": "HIGH/MEDIUM/LOW",
      "analysis": {{
        "fundamental": "该标的基本面分析（80-150字）",
        "technical": "该标的技术面分析（80-150字）",
        "macro_impact": "宏观环境影响（50-100字）",
        "micro_catalysts": "催化剂/事件（50-100字）",
        "investment_thesis": "为什么现在推荐投资这个标的（100-200字）"
      }}
    }}
  ],
  "market_insight": "当前市场环境下标的配置建议（100字内）"
}}

重要约束：
- 所有用户可见内容必须使用中文。
- 不要输出英文推理、内部思考过程、<think> 标签或 reasoning 内容。
- 最终回复只能是 JSON 对象，不要在 JSON 前后添加任何解释。"""

        try:
            resp = ctx.client.chat.completions.create(
                model=ctx.model,
                messages=[
                    {"role": "system", "content": ctx.system_prompt},
                    {"role": "user", "content": prompt},
                ],
            )
            result = parse_ai_json_object(resp.choices[0].message.content)
            return self._normalize_result(result)
        except Exception as e:
            return {
                "existing_targets_analysis": [],
                "new_recommendations": [],
                "market_insight": "AI 标的分析暂不可用",
                "error": str(e),
                "fallback": True,
            }
