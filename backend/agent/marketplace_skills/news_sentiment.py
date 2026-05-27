import json
from ._base import MarketplaceSkill, SkillContext


class NewsSentimentSkill(MarketplaceSkill):
    name = "news_sentiment"
    description = "基于财经新闻与社交媒体的情感分析，判断市场情绪走向"

    def build_prompt(self, ctx: SkillContext) -> str:
        assets = ctx.data.get("asset_data", [])
        return f"""你是一位市场情绪分析师。基于当前财经新闻和社交媒体信息，分析市场情绪。

持仓标的：{json.dumps([{"code": a.get("code"), "name": a.get("name")} for a in assets], ensure_ascii=False)}

请返回 JSON：
{{
  "overall_sentiment": "BULLISH/NEUTRAL/BEARISH 整体市场情绪",
  "sentiment_score": 0-100 情绪分数,
  "key_narratives": ["当前市场主要叙事"],
  "fear_greed_index": "恐慌贪婪指数判断",
  "asset_sentiments": [
    {{"code": "标的代码", "sentiment": "正面/中性/负面", "reason": "原因"}}
  ]
}}"""
