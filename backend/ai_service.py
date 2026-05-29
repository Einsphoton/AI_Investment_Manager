import json
from openai import OpenAI
from models import Asset, Settings, AnalysisRecord
from sqlalchemy.orm import Session
from datetime import datetime


def get_setting(db: Session, key: str) -> str:
    setting = db.query(Settings).filter(Settings.key == key).first()
    return setting.value if setting else ""


def set_setting(db: Session, key: str, value: str):
    setting = db.query(Settings).filter(Settings.key == key).first()
    if setting:
        setting.value = value
    else:
        setting = Settings(key=key, value=value)
        db.add(setting)
    db.commit()


def run_ai_analysis(db: Session) -> AnalysisRecord:
    api_key = get_setting(db, "openai_api_key")
    base_url = get_setting(db, "openai_base_url")
    model = get_setting(db, "openai_model") or "gpt-4o-mini"
    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"

    if not api_key:
        record = AnalysisRecord(
            summary="AI 分析暂不可用",
            detail="请先在设置页面配置 OpenAI API Key",
            total_market_value=0, total_cost=0, total_pnl=0,
            total_pnl_percent=0, realized_pnl=0,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    from agent.personality import build_system_prompt
    system_prompt = build_system_prompt(personality, report_style)

    assets = db.query(Asset).all()
    total_cost = sum(a.shares * a.buy_price for a in assets)
    total_market_value = sum(a.shares * (a.current_price or a.buy_price) for a in assets)
    total_pnl = total_market_value - total_cost
    total_pnl_percent = (total_pnl / total_cost * 100) if total_cost > 0 else 0

    from data_source import get_fundamentals
    providers = {}

    asset_summary = []
    for a in assets:
        cost = a.shares * a.buy_price
        mv = a.shares * (a.current_price or a.buy_price)
        pnl = mv - cost
        pct = (pnl / cost * 100) if cost > 0 else 0
        item = {
            "name": a.name or a.code,
            "code": a.code.strip().upper(),
            "type": a.asset_type,
            "market": a.market,
            "platform": a.platform,
            "cost": round(cost, 2),
            "market_value": round(mv, 2),
            "pnl": round(pnl, 2),
            "pnl_percent": round(pct, 2),
        }
        try:
            f = get_fundamentals(item["code"], a.market, a.asset_type, providers)
            if f:
                item["PE"] = f.get("trailing_pe")
                item["PB"] = f.get("price_to_book")
                item["market_cap"] = round(f["market_cap"] / 1e8, 2) if f.get("market_cap") else None
                item["dividend_yield"] = round(f["dividend_yield"] * 100, 2) if f.get("dividend_yield") else None
                item["EPS"] = f.get("eps")
                item["ROE"] = round(f["return_on_equity"] * 100, 2) if f.get("return_on_equity") else None
        except Exception:
            pass
        asset_summary.append(item)

    prompt = f"""请根据以下投资组合数据与实时基本面数据，提供一份简洁的资产分析报告。

投资组合概览：
- 总市值：{total_market_value:.2f}
- 总成本：{total_cost:.2f}
- 总盈亏：{total_pnl:.2f} ({total_pnl_percent:.2f}%)

持仓明细（含实时基本面数据——请基于这些数据进行分析，不可编造）：
{json.dumps(asset_summary, ensure_ascii=False, indent=2)}

请返回 JSON 格式：
{{
  "summary": "一句话总结（50字以内）",
  "detail": "详细分析报告（包括市场回顾、各资产表现（引用真实PE/PB）、风险提示和操作建议，200-500字）"
}}"""

    client = OpenAI(api_key=api_key, base_url=base_url or None)
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        result = json.loads(content)
        summary = result.get("summary", "分析完成")
        detail = result.get("detail", "")
    except Exception as e:
        summary = "AI 分析失败"
        detail = f"错误信息：{str(e)}"

    record = AnalysisRecord(
        summary=summary, detail=detail,
        total_market_value=total_market_value, total_cost=total_cost,
        total_pnl=total_pnl, total_pnl_percent=total_pnl_percent, realized_pnl=0,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
