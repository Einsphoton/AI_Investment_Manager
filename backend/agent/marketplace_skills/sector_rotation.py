import json
from ._base import MarketplaceSkill, SkillContext


class SectorRotationSkill(MarketplaceSkill):
    name = "sector_rotation"
    description = "识别市场风格切换与行业轮动周期，捕捉结构性机会"

    def build_prompt(self, ctx: SkillContext) -> str:
        assets = ctx.data.get("asset_data", [])
        return f"""你是一位行业轮动策略分析师。请分析当前行业轮动状况。

当前持仓行业分布：{json.dumps([{"code": a.get("code"), "name": a.get("name")} for a in assets], ensure_ascii=False)}

请返回 JSON：
{{
  "current_cycle_phase": "当前经济周期阶段",
  "leading_sectors": ["领涨行业"],
  "lagging_sectors": ["滞后行业"],
  "rotation_signal": "轮动信号 EARLY/MID/LATE",
  "sector_allocation": [
    {{"sector": "行业名称", "allocation": "超配/标配/低配", "reason": "理由"}}
  ],
  "style_preference": "市值风格偏好 LARGE/MID/SMALL/MIXED"
}}"""
