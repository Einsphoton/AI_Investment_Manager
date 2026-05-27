from __future__ import annotations
import json
from ..skill import Skill, SkillContext


class TushareFinanceSkill(Skill):
    name = "tushare_finance"
    description = "集成 Tushare Finance 数据接口，获取实时行情、财务数据、市场数据等 (skillhub.cloud.tencent.com)"
    dependencies = []

    def execute(self, ctx: SkillContext) -> dict:
        assets = ctx.data.get("asset_data", [])

        try:
            import requests
            skillhub_token = ctx.data.get("skillhub_token", "")
            headers = {"Authorization": f"Bearer {skillhub_token}"} if skillhub_token else {}

            market_data = []
            for asset in ctx.data.get("asset_data", []):
                code = asset.get("code", "")
                market = asset.get("market", "A")
                
                ts_code = code
                if market == "A":
                    suffix = ".SZ" if code.startswith(("0", "3")) else ".SH"
                    ts_code = f"{code}{suffix}"
                elif market == "HK":
                    ts_code = f"{code}.HK"
                elif market == "US":
                    ts_code = code

                try:
                    resp = requests.get(
                        "https://skillhub.cloud.tencent.com/api/tushare/daily",
                        params={"ts_code": ts_code, "limit": 5},
                        headers=headers,
                        timeout=5,
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        market_data.append({
                            "code": code,
                            "market": market,
                            "data": data,
                            "source": "tushare",
                        })
                        continue
                except Exception:
                    pass

                try:
                    resp = requests.get(
                        f"https://skillhub.cloud.tencent.com/api/stock/quote",
                        params={"code": code, "market": market},
                        headers=headers,
                        timeout=5,
                    )
                    if resp.status_code == 200:
                        market_data.append({
                            "code": code,
                            "market": market,
                            "data": resp.json(),
                            "source": "stock_analysis",
                        })
                        continue
                except Exception:
                    pass

                market_data.append({
                    "code": code,
                    "market": market,
                    "data": {},
                    "source": "ai_estimated",
                })
        except ImportError:
            market_data = [
                {"code": a.get("code", ""), "market": a.get("market", ""), "data": {}, "source": "ai_estimated"}
                for a in assets
            ]

        if all(not md.get("data") for md in market_data):
            return self._ai_estimate(assets, ctx)

        return {"market_data": market_data}

    def _ai_estimate(self, assets: list[dict], ctx: SkillContext) -> dict:
        if not assets:
            return {"market_data": [], "note": "无资产数据"}

        prompt = f"""基于以下投资标的，请模拟生成近期的市场行情数据。

标的列表：{json.dumps([{ "code": a.get("code"), "market": a.get("market"), "name": a.get("name") } for a in assets], ensure_ascii=False)}

请为每个标的生成 JSON 数据（模拟最近5个交易日的行情）：
{{
  "market_data": [
    {{
      "code": "标的代码",
      "market": "市场",
      "estimated": true,
      "recent_prices": [最近5日收盘价],
      "volume": "平均成交量",
      "pe_ratio": "市盈率（如有）",
      "market_cap": "市值（如有）"
    }}
  ]
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
            return json.loads(resp.choices[0].message.content)
        except Exception as e:
            return {"market_data": [], "error": str(e)}
