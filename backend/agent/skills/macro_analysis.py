import json
from ..skill import Skill, SkillContext


class MacroAnalysisSkill(Skill):
    name = "macro_analysis"
    description = "分析当前全球及主要经济体的政治经济宏观环境，包括政策动向、经济数据、地缘政治等"
    dependencies = []

    def execute(self, ctx: SkillContext) -> dict:
        prompt = """你是一位资深宏观经济分析师。请基于当前（2026年5月）已知的全球经济政治形势，提供一份宏观环境分析报告。

请分析以下维度并返回 JSON：
{
  "global_overview": "全球经济总体形势概述（100字内）",
  "us_economy": "美国经济形势，包括美联储政策、通胀、就业等（80字内）",
  "china_economy": "中国经济形势，包括政策导向、经济数据、市场改革等（80字内）",
  "hk_economy": "香港金融市场形势（50字内）",
  "geopolitical_risks": "主要地缘政治风险（50字内）",
  "market_sentiment": "当前市场整体情绪判断（30字内）",
  "key_events": "近期可能影响市场的重大事件列表",
  "impact_assessment": "对各类资产（股票/基金）的潜在影响评估（80字内）"
}"""

        try:
            resp = ctx.client.chat.completions.create(
                model=ctx.model,
                messages=[
                    {"role": "system", "content": ctx.system_prompt},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
            )
            return json.loads(resp.choices[0].message.content)
        except Exception as e:
            return {
                "global_overview": "AI 宏观分析暂不可用",
                "error": str(e),
                "fallback": True,
            }
