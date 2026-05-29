from __future__ import annotations
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, date, time as datetime_time, timedelta
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from openai import OpenAI

from database import get_db, init_db, SessionLocal
from models import Asset, AssetTransaction, AnalysisRecord, Settings, Target, InstalledSkill
from schemas import (
    AssetCreate, AssetUpdate, AssetResponse,
    AssetDetailResponse, AssetTransactionCreate, AssetTransactionResponse,
    AssetAnalysisSnippet,
    AnalysisResponse, SettingsUpdate, SettingsResponse,
    DashboardData, TargetCreate, TargetUpdate, TargetResponse,
    AgentAnalysisRequest, AgentAnalysisResponse, AIRecommendConfig,
    InvestmentAdviceAcceptRequest, InvestmentAdviceResponse,
    MarketLookupRequest, MarketLookupResponse,
    MarketQuoteRequest, MarketQuoteResponse,
    MarketSearchRequest, MarketSearchResponse, MarketSearchItem,
    MarketHistoryRequest, MarketHistoryResponse, MarketHistoryItem,
    MarketFundamentalsRequest, MarketFundamentalsResponse,
    OcrParseResponse, OcrAssetItem, AssetsBatchCreate,
)
from ai_service import run_ai_analysis, get_setting, set_setting
from data_source import lookup_name, get_quote, get_history, get_fundamentals, search, PROVIDER_LABELS, STOCK_PROVIDER_OPTIONS, FUND_PROVIDER_OPTIONS
from ocr_service import parse_image
from agent import AgentHarness
from agent.skill import SkillContext
from agent.skills import (
    MacroAnalysisSkill, StockAnalysisSkill, TushareFinanceSkill,
    FundamentalAnalysisSkill, TechnicalAnalysisSkill, RecommendationSkill,
    TargetAnalysisSkill,
)
from skill_store import (get_all_skills, get_skill_by_id, get_installed_skill_names,
                          install_skill, uninstall_skill)
from market_calendar import is_trading_day
from parallel_executor import get_parallel_config, save_parallel_config, ParallelConfig, batch_items, parallel_map
from stream_events import sse_event, stream_portfolio_analysis, stream_target_analysis, stream_investment_advice

scheduler = BackgroundScheduler()


def _get_scheduler_config(db: Session) -> dict:
    enabled = get_setting(db, "auto_analyze_enabled") == "true"
    interval_type = get_setting(db, "auto_analyze_interval_type") or "hours"
    interval_value = int(get_setting(db, "auto_analyze_interval_value") or "1")
    daily_time = get_setting(db, "auto_analyze_time") or "09:00"
    markets_str = get_setting(db, "auto_analyze_markets") or ""
    markets = [m.strip() for m in markets_str.split(",") if m.strip()] if markets_str else []
    include_targets = get_setting(db, "auto_analyze_include_targets") == "true"
    return {
        "enabled": enabled,
        "interval_type": interval_type,
        "interval_value": interval_value,
        "daily_time": daily_time,
        "markets": markets,
        "include_targets": include_targets,
    }


def scheduled_analysis():
    db = SessionLocal()
    try:
        cfg = _get_scheduler_config(db)
        if not cfg["enabled"]:
            return
        if db.query(Asset).count() == 0:
            return
        if cfg["markets"] and not is_trading_day(cfg["markets"]):
            return
        run_ai_analysis(db)
        if cfg["include_targets"]:
            _run_scheduled_target_analysis(db)
    finally:
        db.close()


def _run_scheduled_target_analysis(db: Session):
    try:
        api_key = get_setting(db, "openai_api_key")
        base_url = get_setting(db, "openai_base_url")
        model = get_setting(db, "openai_model") or "gpt-4o-mini"
        personality = get_setting(db, "ai_personality") or "balanced"
        report_style = get_setting(db, "ai_report_style") or "professional"
        if not api_key:
            return
        # Read saved AI recommend config
        markets_str = get_setting(db, "ai_recommend_markets") or ""
        asset_types_str = get_setting(db, "ai_recommend_asset_types") or ""
        markets = [m.strip() for m in markets_str.split(",") if m.strip()]
        asset_types = [t.strip() for t in asset_types_str.split(",") if t.strip()]

        all_targets = db.query(Target).filter(Target.status == "active").all()
        targets = [t for t in all_targets
                   if (not markets or t.market in markets)
                   and (not asset_types or t.asset_type in asset_types)]
        if not targets:
            return

        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url or None, timeout=120)

        target_data = []
        providers = _read_providers(db)
        for t in targets:
            quote = None
            try:
                quote = get_quote(t.code.strip().upper(), t.market, t.asset_type, providers)
            except Exception:
                pass
            item = {
                "code": t.code, "name": t.name, "market": t.market,
                "asset_type": t.asset_type, "source": t.source,
                "priority": t.priority, "risk_level": t.risk_level,
            }
            if quote:
                item["current_price"] = quote.get("current_price")
                item["change_pct"] = quote.get("change_pct")
            target_data.append(item)

        ctx = SkillContext(
            api_key=api_key, base_url=base_url, model=model,
            db_session=db, data={"target_data": target_data},
            personality=personality, report_style=report_style,
        )
        ctx.client = client

        # Step 1: macro context
        ctx.data["macro_analysis"] = MacroAnalysisSkill().execute(ctx)

        # Step 2: target analysis
        target_result = TargetAnalysisSkill().execute(ctx)
        new_recs = target_result.get("new_recommendations") or []
        # Filter new recommendations by saved config
        new_recs = [rec for rec in new_recs
                    if isinstance(rec, dict)
                    and (not markets or rec.get("market") in markets)
                    and (not asset_types or rec.get("asset_type") in asset_types)]
        target_result["new_recommendations"] = new_recs
        existing_analysis = target_result.get("existing_targets_analysis") or []

        # Process new recommendations FIRST so removal logic below takes final effect
        for rec in new_recs:
            if not isinstance(rec, dict) or not rec.get("code"):
                continue
            code = str(rec.get("code", ""))
            existing = db.query(Target).filter(
                Target.code == code,
                Target.source == "ai_recommended",
            ).first()
            if existing:
                existing.reason = str(rec.get("reason") or existing.reason or "")
                existing.priority = str(rec.get("priority") or existing.priority or "MEDIUM")
                existing.expected_return = str(rec.get("expected_return") or existing.expected_return or "")
                existing.risk_level = str(rec.get("risk_level") or existing.risk_level or "MEDIUM")
                existing.status = "active"
                try:
                    existing.ai_analysis = json.dumps(rec, ensure_ascii=False, default=str)
                except Exception:
                    pass
            else:
                rec_price = None
                try:
                    q = get_quote(code.strip().upper(), str(rec.get("market") or "A"), str(rec.get("asset_type") or "stock"), providers)
                    if q:
                        rec_price = q.get("current_price")
                except Exception:
                    pass
                if rec_price is not None:
                    rec["recommended_price"] = rec_price
                db.add(Target(
                    code=code,
                    name=str(rec.get("name") or code),
                    market=str(rec.get("market") or "A"),
                    asset_type=str(rec.get("asset_type") or "stock"),
                    source="ai_recommended",
                    reason=str(rec.get("reason") or ""),
                    priority=str(rec.get("priority") or "MEDIUM"),
                    risk_level=str(rec.get("risk_level") or "MEDIUM"),
                    expected_return=str(rec.get("expected_return") or ""),
                    status="active",
                    ai_analysis=json.dumps(rec, ensure_ascii=False, default=str),
                ))

        # Process existing targets analysis LAST so removals take final effect
        price_map = {}
        for td in ctx.data.get("target_data", []):
            if td.get("code") and td.get("current_price") is not None:
                price_map[td["code"]] = td["current_price"]

        for item in existing_analysis:
            if not isinstance(item, dict):
                continue
            t = db.query(Target).filter(
                Target.code == (item.get("code") or ""),
                Target.status == "active",
            ).first()
            if t:
                if item.get("keep") is False:
                    db.delete(t)
                else:
                    rec_price = price_map.get(t.code)
                    if rec_price is not None:
                        item["recommended_price"] = rec_price
                    try:
                        t.ai_analysis = json.dumps(item, ensure_ascii=False, default=str)
                    except Exception:
                        t.ai_analysis = "{}"
                    t.last_analyzed_at = datetime.utcnow().isoformat()

        db.commit()
    except Exception:
        import traceback
        traceback.print_exc()


def _build_trigger(cfg: dict):
    t = cfg["interval_type"]
    if t == "daily":
        try:
            h, m = cfg["daily_time"].split(":")
            return CronTrigger(hour=int(h), minute=int(m))
        except Exception:
            return CronTrigger(hour=9, minute=0)
    elif t == "minutes":
        return IntervalTrigger(minutes=max(1, cfg["interval_value"]))
    else:
        return IntervalTrigger(hours=max(1, cfg["interval_value"]))


def setup_scheduler():
    if scheduler.get_jobs():
        return
    db = SessionLocal()
    try:
        cfg = _get_scheduler_config(db)
        trigger = _build_trigger(cfg)
        scheduler.add_job(scheduled_analysis, trigger, id="auto_analysis", replace_existing=True)
    finally:
        db.close()
    scheduler.start()


def reschedule_analysis(db: Session):
    cfg = _get_scheduler_config(db)
    trigger = _build_trigger(cfg)
    job = scheduler.get_job("auto_analysis")
    if job:
        job.reschedule(trigger=trigger)
    else:
        scheduler.add_job(scheduled_analysis, trigger, id="auto_analysis", replace_existing=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    setup_scheduler()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="AI 投资分析平台", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/dashboard", response_model=DashboardData)
def get_dashboard(db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    total_cost = sum(a.shares * a.buy_price for a in assets)
    total_market_value = sum(a.shares * (a.current_price if a.current_price is not None and a.current_price > 0 else a.buy_price) for a in assets)
    total_pnl = total_market_value - total_cost
    total_pnl_percent = (total_pnl / total_cost * 100) if total_cost > 0 else 0

    latest_analysis = db.query(AnalysisRecord).order_by(AnalysisRecord.created_at.desc()).first()
    realized = latest_analysis.realized_pnl if latest_analysis else 0

    return DashboardData(
        total_market_value=round(total_market_value, 2),
        total_cost=round(total_cost, 2),
        total_pnl=round(total_pnl, 2),
        total_pnl_percent=round(total_pnl_percent, 2),
        realized_pnl=round(realized, 2),
        assets_count=len(assets),
        analysis_summary=latest_analysis.summary if latest_analysis else "暂无分析报告",
    )


@app.get("/api/assets", response_model=list[AssetResponse])
def list_assets(
    asset_type: Optional[str] = Query(None),
    market: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Asset)
    if asset_type:
        query = query.filter(Asset.asset_type == asset_type)
    if market:
        query = query.filter(Asset.market == market)
    return query.order_by(Asset.created_at.desc()).all()


def _find_latest_asset_analysis(db: Session, asset: Asset) -> AnalysisRecord | None:
    records = db.query(AnalysisRecord).filter(
        AnalysisRecord.asset_id == asset.id
    ).order_by(AnalysisRecord.created_at.desc()).limit(20).all()
    for record in records:
        text = f"{record.summary or ''}\n{record.detail or ''}"
        if "Test action for" in text or "Test summary for" in text or "Test analysis for" in text:
            continue
        return record
    return None


def _effective_asset_price(asset: Asset) -> float:
    return asset.current_price if asset.current_price is not None and asset.current_price > 0 else asset.buy_price


def _asset_analysis_data(asset: Asset) -> dict:
    current_price = _effective_asset_price(asset)
    market_value = current_price * asset.shares
    total_cost = asset.buy_price * asset.shares
    total_pnl = market_value - total_cost
    return {
        "id": asset.id,
        "code": asset.code,
        "name": asset.name or asset.code,
        "market": asset.market,
        "asset_type": asset.asset_type,
        "platform": asset.platform,
        "shares": asset.shares,
        "buy_price": asset.buy_price,
        "current_price": current_price,
        "buy_date": asset.buy_date,
        "note": asset.note,
        "market_value": market_value,
        "total_cost": total_cost,
        "total_pnl": total_pnl,
        "total_pnl_percent": (total_pnl / total_cost * 100) if total_cost else 0,
    }


def _fetch_asset_market_context(asset_data: list[dict], providers: dict) -> tuple[dict, dict]:
    fundamentals_map: dict[str, dict] = {}
    history_map: dict[str, list[dict]] = {}

    def fetch_one(item: dict):
        code_key = item["code"].strip().upper()
        market = item.get("market", "A")
        asset_type = item.get("asset_type", "stock")
        fundamentals = None
        history = None
        try:
            fundamentals = get_fundamentals(code_key, market, asset_type, providers)
        except Exception as e:
            print(f"[AgentRun:fundamentals] {code_key}: {e}")
        try:
            history = get_history(code_key, market, asset_type, providers)
        except Exception as e:
            print(f"[AgentRun:history] {code_key}: {e}")
        return code_key, fundamentals, history

    if not asset_data:
        return fundamentals_map, history_map

    max_workers = min(4, len(asset_data))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(fetch_one, item) for item in asset_data]
        for future in as_completed(futures):
            code_key, fundamentals, history = future.result()
            if fundamentals:
                fundamentals_map[code_key] = fundamentals
            if history:
                history_map[code_key] = history[-90:]

    return fundamentals_map, history_map


def _compact_asset_context(asset_data: list[dict], fundamentals_map: dict, history_map: dict) -> list[dict]:
    compact = []
    for item in asset_data:
        code_key = item["code"].strip().upper()
        history = history_map.get(code_key, [])
        prices = [bar.get("price") for bar in history[-30:] if bar.get("price") is not None]
        compact.append({
            **item,
            "fundamentals": fundamentals_map.get(code_key, {}),
            "recent_prices": prices,
            "history_points": len(history),
        })
    return compact


def _normalize_ai_number(value, default=0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _analysis_code_key(code: str) -> str:
    value = (code or "").strip().upper()
    for suffix in (".OF", ".SH", ".SZ", ".SS", ".HK"):
        if value.endswith(suffix):
            return value[:-len(suffix)]
    return value


def _fallback_asset_recommendation(asset: dict, reason: str = "") -> dict:
    current_price = _normalize_ai_number(asset.get("current_price"))
    buy_price = _normalize_ai_number(asset.get("buy_price"))
    pnl_pct = ((current_price - buy_price) / buy_price * 100) if buy_price else 0
    return {
        "asset_id": asset.get("id"),
        "asset_code": asset.get("code", ""),
        "asset_name": asset.get("name", ""),
        "final_suggestion": "HOLD",
        "suggested_action": "暂不做交易操作，等待更充分的行情和基本面数据确认。",
        "suggested_quantity": 0,
        "target_price": current_price,
        "stop_loss": round(buy_price * 0.92, 4) if buy_price else current_price,
        "time_horizon": "MEDIUM",
        "confidence_score": 35,
        "summary": f"当前浮动盈亏约 {pnl_pct:.2f}%，建议先持有观察。",
        "macro_impact": "宏观分析暂不可用，需结合利率、流动性和市场风险偏好继续跟踪。",
        "micro_factors": "暂未获得足够微观信息，优先关注规模、费率、持仓结构、管理人稳定性和资金流向。",
        "fundamentals_analysis": "实时基本面数据不足，暂不编造估值或财务指标。",
        "technical_analysis": "价格历史数据不足，仅能基于买入价和当前价判断持仓盈亏状态。",
        "risk_warning": "数据源或 AI 分析暂不可用时，操作建议可信度较低。",
        "data_quality": reason or "fallback",
    }


def _normalize_asset_ai_report(raw: dict, asset_data: list[dict]) -> dict:
    if not isinstance(raw, dict):
        raw = {}

    by_code = {_analysis_code_key(a["code"]): a for a in asset_data}
    by_name = {a["name"]: a for a in asset_data}
    raw_items = raw.get("asset_analyses") or raw.get("asset_recommendations") or []
    normalized_items = []

    for item in raw_items:
        if not isinstance(item, dict):
            continue
        code = _analysis_code_key(item.get("asset_code") or item.get("code") or "")
        asset = by_code.get(code) or by_name.get(item.get("asset_name") or item.get("name") or "")
        if not asset:
            continue
        normalized = {
            **_fallback_asset_recommendation(asset),
            **item,
            "asset_id": asset["id"],
            "asset_code": asset["code"],
            "asset_name": asset["name"],
            "suggested_quantity": _normalize_ai_number(item.get("suggested_quantity"), 0),
            "target_price": _normalize_ai_number(item.get("target_price"), asset.get("current_price", 0)),
            "stop_loss": _normalize_ai_number(item.get("stop_loss"), asset.get("buy_price", 0) * 0.92),
            "confidence_score": int(_normalize_ai_number(item.get("confidence_score"), 50)),
        }
        normalized_items.append(normalized)

    seen_codes = {_analysis_code_key(item["asset_code"]) for item in normalized_items}
    for asset in asset_data:
        if _analysis_code_key(asset["code"]) not in seen_codes:
            normalized_items.append(_fallback_asset_recommendation(asset, "AI 未返回该资产的单项分析"))

    overall = raw.get("overall_strategy") or raw.get("recommendations", {}).get("overall_strategy") or {}
    if not isinstance(overall, dict):
        overall = {"overall_strategy": str(overall)}

    summary = raw.get("summary") or overall.get("overall_strategy") or "AI 分析完成"
    return {
        "goal": raw.get("goal", ""),
        "macro_analysis": raw.get("macro_analysis", {}),
        "asset_analyses": normalized_items,
        "recommendations": {
            "asset_recommendations": normalized_items,
            "overall_strategy": overall,
        },
        "summary": summary,
    }


def _run_compact_asset_ai_analysis(
    *,
    api_key: str,
    base_url: str,
    model: str,
    personality: str,
    report_style: str,
    goal: str,
    asset_data: list[dict],
    fundamentals_map: dict,
    history_map: dict,
) -> dict:
    ctx = SkillContext(
        api_key=api_key,
        base_url=base_url,
        model=model,
        personality=personality,
        report_style=report_style,
    )
    client = OpenAI(api_key=api_key, base_url=base_url or None, timeout=90)
    compact_assets = _compact_asset_context(asset_data, fundamentals_map, history_map)
    prompt = f"""{ctx.system_prompt}

请基于用户当前持仓，生成完整的资产 AI 分析报告。

分析目标：{goal}

资产与市场数据：
{json.dumps(compact_assets, ensure_ascii=False, default=str)}

要求：
1. 必须只分析上面列出的资产，不要加入未列出的标的。
2. 对每一项资产都给出完整报告，覆盖宏观影响、微观因素、基本面数据、技术面走势、风险提示和具体交易建议。
3. 数据不足时直接说明“数据不足”，不要编造不存在的财务指标。
4. suggested_quantity 必须是数字；不建议操作时返回 0。

请只返回 JSON，格式如下：
{{
  "summary": "整体结论，120字以内",
  "macro_analysis": {{
    "global_overview": "全球/市场环境概述",
    "china_economy": "中国市场相关判断",
    "impact_assessment": "对当前持仓的影响"
  }},
  "asset_analyses": [
    {{
      "asset_code": "代码",
      "asset_name": "名称",
      "final_suggestion": "BUY/SELL/HOLD/ADD/REDUCE 之一",
      "suggested_action": "具体操作建议，120字以内",
      "suggested_quantity": 0,
      "target_price": 0,
      "stop_loss": 0,
      "time_horizon": "SHORT/MEDIUM/LONG 之一",
      "confidence_score": 0,
      "summary": "该资产一句话结论",
      "macro_impact": "宏观影响分析",
      "micro_factors": "微观因素分析",
      "fundamentals_analysis": "基本面数据分析",
      "technical_analysis": "技术面走势分析",
      "risk_warning": "风险提示",
      "data_quality": "使用了哪些数据，以及缺失哪些数据"
    }}
  ],
  "overall_strategy": {{
    "overall_strategy": "组合策略建议",
    "risk_level": "LOW/MEDIUM/HIGH",
    "suggested_cash_ratio": 0,
    "key_focus": "后续重点关注",
    "market_outlook": "市场展望"
  }}
}}"""

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": ctx.system_prompt},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        raw = json.loads(resp.choices[0].message.content)
    except Exception as e:
        raw = {
            "summary": "AI 分析暂不可用，已生成基于持仓数据的保守报告。",
            "asset_analyses": [_fallback_asset_recommendation(asset, str(e)) for asset in asset_data],
            "overall_strategy": {
                "overall_strategy": "暂时维持当前仓位，待 AI 服务和市场数据恢复后再更新决策。",
                "risk_level": "MEDIUM",
                "suggested_cash_ratio": 30,
                "key_focus": "数据质量、回撤控制、单资产仓位集中度",
                "market_outlook": "暂不判断",
            },
        }

    raw["goal"] = goal
    return _normalize_asset_ai_report(raw, asset_data)


def _safe_json_loads(value: str, default):
    try:
        data = json.loads(value or "")
        return data if data is not None else default
    except Exception:
        return default


def _market_currency(market: str) -> str:
    return {"A": "CNY", "HK": "HKD", "US": "USD"}.get(market, "CNY")


def _asset_type_label(asset_type: str) -> str:
    return {"stock": "股票", "onshore_fund": "场内基金", "offshore_fund": "场外基金"}.get(asset_type, asset_type)


def _market_label(market: str) -> str:
    return {"A": "A 股", "HK": "港股", "US": "美股"}.get(market, market)


def _currency_label(currency: str) -> str:
    return {"CNY": "人民币", "HKD": "港元", "USD": "美元"}.get(currency, currency)


def _load_investment_budgets(db: Session) -> list[dict]:
    raw_items = _safe_json_loads(get_setting(db, "investment_budget_configs"), [])
    if not isinstance(raw_items, list):
        return []
    budgets = []
    for idx, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        platform = str(item.get("platform") or "").strip()
        amount = _normalize_ai_number(item.get("amount"), 0)
        currency = str(item.get("currency") or "CNY").strip().upper()
        asset_types = [str(v) for v in item.get("asset_types", []) if v]
        markets = [str(v) for v in item.get("markets", []) if v]
        if not platform or amount <= 0 or not asset_types or not markets:
            continue
        budgets.append({
            "id": str(item.get("id") or f"budget-{idx + 1}"),
            "platform": platform,
            "amount": amount,
            "currency": currency,
            "asset_types": asset_types,
            "markets": markets,
        })
    return budgets


def _budget_matches_asset(budget: dict, asset_or_target: dict) -> bool:
    market = asset_or_target.get("market")
    asset_type = asset_or_target.get("asset_type")
    return (
        market in (budget.get("markets") or [])
        and asset_type in (budget.get("asset_types") or [])
        and _market_currency(market) == budget.get("currency")
    )


def _investment_budget_status(budgets: list[dict], assets: list[Asset]) -> list[dict]:
    status = []
    for budget in budgets:
        used = 0.0
        for asset in assets:
            item = {"market": asset.market, "asset_type": asset.asset_type}
            if asset.platform == budget["platform"] and _budget_matches_asset(budget, item):
                used += (asset.current_price if asset.current_price and asset.current_price > 0 else asset.buy_price) * (asset.shares or 0)
        remaining = max(0.0, budget["amount"] - used)
        status.append({
            **budget,
            "used_amount": used,
            "remaining_amount": remaining,
            "currency_label": _currency_label(budget["currency"]),
            "asset_type_labels": [_asset_type_label(v) for v in budget["asset_types"]],
            "market_labels": [_market_label(v) for v in budget["markets"]],
        })
    return status


def _latest_today_asset_analysis(db: Session, assets: list[Asset]) -> dict:
    start = datetime.combine(date.today(), datetime_time.min)
    result = {}
    for asset in assets:
        record = db.query(AnalysisRecord).filter(
            AnalysisRecord.asset_id == asset.id,
            AnalysisRecord.created_at >= start,
        ).order_by(AnalysisRecord.created_at.desc()).first()
        if record:
            result[asset.code.strip().upper()] = {
                "summary": record.summary,
                "detail": _safe_json_loads(record.detail, record.detail),
                "created_at": record.created_at.isoformat() if record.created_at else "",
            }
    return result


def _quote_for_investment_item(item: dict, providers: dict) -> dict:
    code = str(item.get("code") or "").strip().upper()
    market = item.get("market") or "A"
    asset_type = item.get("asset_type") or "stock"
    quote = {}
    try:
        quote = get_quote(code, market, asset_type, providers) or {}
    except Exception as e:
        print(f"[InvestmentAdvice:quote] {code}: {e}")
    current_price = quote.get("current_price")
    if current_price is None:
        current_price = item.get("current_price") or item.get("buy_price")
    return {
        "current_price": current_price,
        "prev_close": quote.get("prev_close"),
        "change": quote.get("change"),
        "change_pct": quote.get("change_pct"),
        "source": quote.get("source"),
    }


def _candidate_investment_targets(db: Session, budgets: list[dict], assets: list[Asset], providers: dict) -> tuple[list[dict], list[dict]]:
    from parallel_executor import parallel_map

    # Build asset items
    asset_items = []
    for asset in assets:
        item = _asset_analysis_data(asset)
        item["currency"] = _market_currency(asset.market)
        asset_items.append(item)

    # Fetch quotes for all assets in parallel
    if asset_items:
        asset_quotes = parallel_map(
            lambda item: _quote_for_investment_item(item, providers),
            asset_items,
            max_workers=5, timeout=15,
        )
        for item, quote in zip(asset_items, asset_quotes):
            item["quote"] = quote if quote else {}

    # Build target items (skip duplicate codes already held)
    targets = db.query(Target).filter(Target.status == "active").all()
    target_items = []
    seen_asset_codes = {(_analysis_code_key(a.code), a.market, a.asset_type) for a in assets}
    for target in targets:
        item = {
            "code": target.code,
            "name": target.name or target.code,
            "market": target.market,
            "asset_type": target.asset_type,
            "source": target.source,
            "priority": target.priority,
            "risk_level": target.risk_level,
            "reason": target.reason,
            "expected_return": target.expected_return,
            "ai_analysis": _safe_json_loads(target.ai_analysis, {}),
            "currency": _market_currency(target.market),
        }
        if not any(_budget_matches_asset(budget, item) for budget in budgets):
            continue
        if (_analysis_code_key(target.code), target.market, target.asset_type) in seen_asset_codes:
            continue
        target_items.append(item)

    # Only fetch quotes for targets not already covered by asset quotes
    asset_quote_map = {}
    for a in asset_items:
        key = (_analysis_code_key(a.get("code", "")), a.get("market"), a.get("asset_type"))
        asset_quote_map[key] = a.get("quote", {})

    targets_needing_quote = []
    for item in target_items:
        key = (_analysis_code_key(item.get("code", "")), item.get("market"), item.get("asset_type"))
        cached = asset_quote_map.get(key)
        if cached:
            item["quote"] = cached
        else:
            targets_needing_quote.append(item)

    if targets_needing_quote:
        target_quotes = parallel_map(
            lambda item: _quote_for_investment_item(item, providers),
            targets_needing_quote,
            max_workers=5, timeout=15,
        )
        for item, quote in zip(targets_needing_quote, target_quotes):
            item["quote"] = quote if quote else {}

    return asset_items, target_items


def _find_budget(status: list[dict], budget_id: str | None, platform: str, market: str, asset_type: str) -> dict | None:
    if budget_id:
        for budget in status:
            if budget.get("id") == budget_id:
                return budget
    item = {"market": market, "asset_type": asset_type}
    for budget in status:
        if budget.get("platform") == platform and _budget_matches_asset(budget, item):
            return budget
    return None


def _normalize_investment_advice(raw: dict, budgets: list[dict], assets: list[Asset], targets: list[dict], budget_status: list[dict]) -> dict:
    if not isinstance(raw, dict):
        raw = {}
    raw_items = raw.get("advice") or raw.get("recommendations") or []
    if not isinstance(raw_items, list):
        raw_items = []

    assets_by_key = {
        (_analysis_code_key(a.code), a.market, a.asset_type): a
        for a in assets
    }
    targets_by_key = {
        (_analysis_code_key(t.get("code")), t.get("market"), t.get("asset_type")): t
        for t in targets
    }
    remaining_by_budget = {b["id"]: _normalize_ai_number(b.get("remaining_amount"), 0) for b in budget_status}
    normalized = []

    for idx, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        trade_type = str(item.get("trade_type") or item.get("action") or "").strip().upper()
        if trade_type in {"BUY", "买入"}:
            trade_type = "BUY"
        elif trade_type in {"SELL", "卖出"}:
            trade_type = "SELL"
        else:
            continue

        code = _analysis_code_key(item.get("code") or item.get("asset_code") or "")
        market = str(item.get("market") or "A").strip().upper()
        asset_type = str(item.get("asset_type") or "stock").strip()
        key = (code, market, asset_type)
        existing_asset = assets_by_key.get(key)
        candidate = targets_by_key.get(key) or {}
        name = item.get("name") or item.get("asset_name") or (existing_asset.name if existing_asset else candidate.get("name")) or code
        platform = str(item.get("platform") or "").strip()
        budget = _find_budget(budget_status, item.get("budget_id"), platform, market, asset_type)
        if not budget:
            continue

        price = _normalize_ai_number(item.get("price") or item.get("current_price"), 0)
        if price <= 0 and existing_asset:
            price = _effective_asset_price(existing_asset)
        if price <= 0 and candidate:
            price = _normalize_ai_number((candidate.get("quote") or {}).get("current_price"), 0)
        shares = _normalize_ai_number(item.get("shares") or item.get("quantity"), 0)
        if price <= 0 or shares <= 0:
            continue

        if trade_type == "BUY":
            if not _budget_matches_asset(budget, {"market": market, "asset_type": asset_type}):
                continue
            available = remaining_by_budget.get(budget["id"], 0)
            if available <= 0:
                continue
            max_amount = available * 0.7
            estimated = shares * price
            if estimated > max_amount:
                shares = max(0, max_amount / price)
                estimated = shares * price
            if shares <= 0 or estimated <= 0:
                continue
            remaining_by_budget[budget["id"]] = max(0, available - estimated)
        else:
            if not existing_asset or shares > (existing_asset.shares or 0):
                continue
            estimated = shares * price

        normalized.append({
            "id": f"advice-{idx + 1}",
            "budget_id": budget["id"],
            "platform": budget["platform"],
            "currency": budget["currency"],
            "currency_label": _currency_label(budget["currency"]),
            "market": market,
            "market_label": _market_label(market),
            "asset_type": asset_type,
            "asset_type_label": _asset_type_label(asset_type),
            "code": code,
            "name": name,
            "trade_type": trade_type,
            "trade_type_label": "买入" if trade_type == "BUY" else "卖出",
            "shares": round(shares, 4),
            "price": round(price, 4),
            "estimated_amount": round(estimated, 2),
            "reason": str(item.get("reason") or item.get("suggested_action") or "AI 建议").strip(),
            "confidence_score": int(_normalize_ai_number(item.get("confidence_score"), 50)),
            "risk_note": str(item.get("risk_note") or item.get("risk_warning") or "").strip(),
            "source": "holding" if existing_asset else "target",
            "asset_id": existing_asset.id if existing_asset else None,
        })

    summary = raw.get("summary") or ("已生成投资建议" if normalized else "暂无符合额度和行情约束的投资建议")
    return {"summary": summary, "advice": normalized, "budget_status": budget_status}


def _fallback_investment_advice(budget_status: list[dict], targets: list[dict]) -> dict:
    advice = []
    for budget in budget_status:
        if budget.get("remaining_amount", 0) <= 0:
            continue
        target = next((t for t in targets if _budget_matches_asset(budget, t) and _normalize_ai_number((t.get("quote") or {}).get("current_price"), 0) > 0), None)
        if not target:
            continue
        price = _normalize_ai_number((target.get("quote") or {}).get("current_price"), 0)
        amount = budget["remaining_amount"] * 0.25
        shares = amount / price if price else 0
        if shares <= 0:
            continue
        advice.append({
            "budget_id": budget["id"],
            "platform": budget["platform"],
            "currency": budget["currency"],
            "market": target["market"],
            "asset_type": target["asset_type"],
            "code": target["code"],
            "name": target["name"],
            "trade_type": "BUY",
            "shares": shares,
            "price": price,
            "reason": "AI 服务暂不可用，基于标的池与剩余额度给出小比例试探性配置。",
            "confidence_score": 30,
        })
        break
    return {"summary": "AI 服务暂不可用，已生成保守的备用建议。", "advice": advice}


@app.get("/api/assets/{asset_id}/detail", response_model=AssetDetailResponse)
def get_asset_detail(asset_id: int, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")

    providers = _read_providers(db)
    history = []
    fundamentals = {}
    try:
        history = get_history(asset.code.strip().upper(), asset.market, asset.asset_type, providers) or []
    except Exception as e:
        print(f"[AssetDetail:history] {asset.code}: {e}")
    try:
        fundamentals = get_fundamentals(asset.code.strip().upper(), asset.market, asset.asset_type, providers) or {}
    except Exception as e:
        print(f"[AssetDetail:fundamentals] {asset.code}: {e}")

    transactions = (
        db.query(AssetTransaction)
        .filter(AssetTransaction.asset_id == asset_id)
        .order_by(AssetTransaction.trade_date.desc(), AssetTransaction.created_at.desc())
        .all()
    )
    latest_record = _find_latest_asset_analysis(db, asset)
    latest_analysis = AssetAnalysisSnippet.model_validate(latest_record) if latest_record else None

    return AssetDetailResponse(
        asset=asset,
        history=history,
        fundamentals=fundamentals,
        transactions=transactions,
        latest_analysis=latest_analysis,
    )


@app.post("/api/assets", response_model=AssetResponse)
def create_asset(asset: AssetCreate, db: Session = Depends(get_db)):
    db_asset = Asset(**asset.model_dump())
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)
    return db_asset


@app.put("/api/assets/{asset_id}", response_model=AssetResponse)
def update_asset(asset_id: int, asset: AssetUpdate, db: Session = Depends(get_db)):
    db_asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    update_data = asset.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_asset, key, value)
    db.commit()
    db.refresh(db_asset)
    return db_asset


@app.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db)):
    db_asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="资产不存在")
    db.query(AssetTransaction).filter(AssetTransaction.asset_id == asset_id).delete(synchronize_session=False)
    db.delete(db_asset)
    db.commit()
    return {"message": "删除成功"}


@app.post("/api/assets/batch-delete")
def batch_delete_assets(ids: list[int], db: Session = Depends(get_db)):
    db.query(AssetTransaction).filter(AssetTransaction.asset_id.in_(ids)).delete(synchronize_session=False)
    db.query(Asset).filter(Asset.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"message": "批量删除成功"}


@app.post("/api/assets/{asset_id}/transactions", response_model=AssetTransactionResponse)
def create_asset_transaction(asset_id: int, transaction: AssetTransactionCreate, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")

    trade_type = transaction.trade_type.strip().lower()
    if trade_type not in {"buy", "sell"}:
        raise HTTPException(status_code=400, detail="交易类型只能是买入或卖出")
    if transaction.shares <= 0 or transaction.price <= 0:
        raise HTTPException(status_code=400, detail="份额和价格必须大于 0")
    if transaction.fee < 0:
        raise HTTPException(status_code=400, detail="手续费不能为负数")
    if trade_type == "sell" and transaction.shares > (asset.shares or 0):
        raise HTTPException(status_code=400, detail="卖出份额不能超过当前持仓")

    existing_count = db.query(AssetTransaction).filter(AssetTransaction.asset_id == asset_id).count()
    if existing_count == 0 and (asset.shares or 0) > 0 and (asset.buy_price or 0) > 0:
        db.add(AssetTransaction(
            asset_id=asset_id,
            trade_type="buy",
            trade_date=asset.buy_date,
            shares=asset.shares,
            price=asset.buy_price,
            fee=0,
            note="初始买入",
        ))

    db_transaction = AssetTransaction(
        asset_id=asset_id,
        trade_type=trade_type,
        trade_date=transaction.trade_date,
        shares=transaction.shares,
        price=transaction.price,
        fee=transaction.fee,
        note=transaction.note,
    )
    db.add(db_transaction)

    if trade_type == "buy":
        old_shares = asset.shares or 0
        new_shares = old_shares + transaction.shares
        old_cost = old_shares * (asset.buy_price or 0)
        new_cost = transaction.shares * transaction.price + transaction.fee
        asset.shares = new_shares
        asset.buy_price = (old_cost + new_cost) / new_shares if new_shares > 0 else asset.buy_price
    else:
        asset.shares = max(0, (asset.shares or 0) - transaction.shares)

    asset.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_transaction)
    return db_transaction


@app.post("/api/assets/refresh-prices", response_model=list[AssetResponse])
def refresh_asset_prices(db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    providers = _read_providers(db)
    updated = []
    for asset in assets:
        try:
            quote = get_quote(asset.code.strip().upper(), asset.market, asset.asset_type, providers)
            if quote and quote.get('current_price') is not None:
                asset.current_price = quote['current_price']
                asset.price_updated_at = datetime.now().strftime('%Y-%m-%d %H:%M')
                updated.append(asset)
                db.flush()
            time.sleep(0.35)
        except Exception as e:
            print(f"[Refresh] {asset.code}: {e}")
            continue
    db.commit()
    for asset in updated:
        db.refresh(asset)
    return updated


@app.post("/api/analysis/run", response_model=AnalysisResponse)
def trigger_analysis(include_targets: bool = Query(False), db: Session = Depends(get_db)):
    record = run_ai_analysis(db)
    if include_targets:
        _run_scheduled_target_analysis(db)
    return record


@app.post("/api/analysis/parallel-run")
def trigger_parallel_analysis(db: Session = Depends(get_db)):
    """
    Run portfolio analysis and optional target analysis in parallel.
    """
    api_key = get_setting(db, "openai_api_key")
    if not api_key:
        raise HTTPException(status_code=400, detail="请先在设置页面配置 OpenAI API Key")

    pcfg = get_parallel_config(db)
    max_workers = max(1, min(pcfg.max_workers, 4))

    results = {}
    tasks = []

    def run_portfolio():
        return ("portfolio", run_ai_analysis(db))

    def run_targets_wrapper():
        try:
            resp = ai_analyze_targets(req=None, db=db)
            return ("targets", resp)
        except Exception as e:
            return ("targets", {"error": str(e)})

    def run_advice_wrapper():
        try:
            resp = run_investment_advice(db=db)
            return ("advice", resp)
        except Exception as e:
            return ("advice", {"error": str(e)})

    tasks.append(run_portfolio)

    from models import Target
    if db.query(Target).filter(Target.status == "active").count() > 0:
        tasks.append(run_targets_wrapper)

    # Check if investment budgets are configured
    budget_str = get_setting(db, "investment_budget_configs")
    if budget_str:
        try:
            budgets = json.loads(budget_str)
            if isinstance(budgets, list) and len(budgets) > 0:
                tasks.append(run_advice_wrapper)
        except json.JSONDecodeError:
            pass

    if len(tasks) > 1 and pcfg.enabled and max_workers > 1:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=min(max_workers, len(tasks))) as executor:
            futures = {executor.submit(t): t for t in tasks}
            for future in as_completed(futures):
                try:
                    key, result = future.result()
                    results[key] = result
                except Exception as e:
                    print(f"[ParallelRun] Task failed: {e}")
    else:
        for t in tasks:
            try:
                key, result = t()
                results[key] = result
            except Exception as e:
                print(f"[ParallelRun] Task failed: {e}")

    return {
        "portfolio_analysis": results.get("portfolio", {}),
        "target_analysis": results.get("targets", {}),
        "investment_advice": results.get("advice", {}),
        "status": "complete" if len(results) == len(tasks) else "partial",
    }


@app.post("/api/analysis/run-stream")
def stream_analysis(db: Session = Depends(get_db)):
    """SSE streaming endpoint for portfolio analysis. Yields real progress events."""
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        stream_portfolio_analysis(db),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/analysis/run-stream-mock")
def stream_analysis_mock():
    """Test SSE endpoint with fake data for frontend development."""
    import time
    def mock_events():
        for i in range(1, 21):
            yield sse_event("progress", {"progress": i * 5})
            yield sse_event("log", {"message": f"模拟步骤 {i}/20...", "tag": "模拟"})
            time.sleep(0.3)
        yield sse_event("thinking", {"message": "AI 正在生成报告..."})
        yield sse_event("complete", {"summary": "模拟完成", "detail": "这是模拟数据"})
    from fastapi.responses import StreamingResponse
    return StreamingResponse(mock_events(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@app.get("/api/analysis/latest", response_model=AnalysisResponse)
def get_latest_analysis(db: Session = Depends(get_db)):
    record = db.query(AnalysisRecord).order_by(AnalysisRecord.created_at.desc()).first()
    if not record:
        raise HTTPException(status_code=404, detail="暂无分析记录")
    return record


@app.get("/api/analysis/history", response_model=list[AnalysisResponse])
def get_analysis_history(db: Session = Depends(get_db)):
    return db.query(AnalysisRecord).order_by(AnalysisRecord.created_at.desc()).limit(50).all()


@app.get("/api/settings/parallel-config")
def get_parallel_config_endpoint(db: Session = Depends(get_db)):
    """Get current parallel execution configuration."""
    config = get_parallel_config(db)
    return config.to_dict()

@app.post("/api/settings/parallel-config")
def save_parallel_config_endpoint(data: dict, db: Session = Depends(get_db)):
    """Save parallel execution configuration."""
    config = ParallelConfig.from_dict(data)
    save_parallel_config(db, config)
    return {"message": "并行配置已保存", "config": config.to_dict()}


@app.get("/api/settings/{key}", response_model=SettingsResponse)
def get_settings(key: str, db: Session = Depends(get_db)):
    value = get_setting(db, key)
    return SettingsResponse(key=key, value=value)


@app.put("/api/settings/{key}", response_model=SettingsResponse)
def update_settings(key: str, data: SettingsUpdate, db: Session = Depends(get_db)):
    set_setting(db, key, data.value)
    scheduler_keys = {
        "auto_analyze_enabled", "auto_analyze_interval_type",
        "auto_analyze_interval_value", "auto_analyze_time",
        "auto_analyze_markets", "auto_analyze_include_targets",
    }
    if key in scheduler_keys:
        reschedule_analysis(db)
    return SettingsResponse(key=key, value=data.value)


from pydantic import BaseModel as PydanticBaseModel

class CheckModelsBody(PydanticBaseModel):
    api_key: str
    base_url: str = ""


@app.post("/api/settings/check-models")
def check_models(body: CheckModelsBody, db: Session = Depends(get_db)):
    try:
        from openai import OpenAI
        client = OpenAI(api_key=body.api_key, base_url=body.base_url or None)
        models = client.models.list()
        ids = sorted({
            model_id for model_id in (getattr(m, "id", "") for m in models)
            if isinstance(model_id, str) and model_id and not model_id.startswith("ft:")
        })
        return {"models": ids}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"获取模型列表失败: {str(e)}")


@app.get("/api/scheduler/config")
def get_scheduler_config(db: Session = Depends(get_db)):
    return _get_scheduler_config(db)



def _read_providers(db: Session) -> dict:
    providers: dict = {'stock': {}, 'fund': {}}
    for key in ['datasource_stock_A', 'datasource_stock_HK', 'datasource_stock_US']:
        val = get_setting(db, key)
        if val:
            market = key.split('_')[-1]
            providers['stock'][market] = val
    for key in ['datasource_fund_A', 'datasource_fund_HK', 'datasource_fund_US']:
        val = get_setting(db, key)
        if val:
            market = key.split('_')[-1]
            providers['fund'][market] = val
    return providers


@app.post("/api/market/lookup", response_model=MarketLookupResponse)
def market_lookup(req: MarketLookupRequest, db: Session = Depends(get_db)):
    providers = _read_providers(db)
    name = lookup_name(req.code.strip().upper(), req.market, req.asset_type, providers)
    return MarketLookupResponse(name=name, code=req.code, market=req.market)


@app.post("/api/market/quote", response_model=MarketQuoteResponse)
def market_quote(req: MarketQuoteRequest, db: Session = Depends(get_db)):
    providers = _read_providers(db)
    result = get_quote(req.code.strip().upper(), req.market, req.asset_type, providers)
    if not result:
        raise HTTPException(status_code=404, detail="无法获取行情数据")
    return MarketQuoteResponse(
        name=result.get('name'),
        code=result.get('code', req.code),
        market=result.get('market', req.market),
        current_price=result.get('current_price'),
        prev_close=result.get('prev_close'),
        change=result.get('change'),
        change_pct=result.get('change_pct'),
        source=result.get('source'),
    )


@app.post("/api/market/search", response_model=MarketSearchResponse)
def market_search(req: MarketSearchRequest, db: Session = Depends(get_db)):
    results = search(req.keyword.strip().upper(), req.market, req.asset_type)
    items = [MarketSearchItem(code=r['code'], name=r['name'], market=r['market']) for r in results]
    return MarketSearchResponse(results=items)


@app.post("/api/market/history", response_model=MarketHistoryResponse)
def market_history(req: MarketHistoryRequest, db: Session = Depends(get_db)):
    providers = _read_providers(db)
    history = get_history(req.code.strip().upper(), req.market, req.asset_type, providers)
    return MarketHistoryResponse(
        code=req.code,
        market=req.market,
        history=history or [],
    )


@app.post("/api/market/fundamentals", response_model=MarketFundamentalsResponse)
def market_fundamentals(req: MarketFundamentalsRequest, db: Session = Depends(get_db)):
    providers = _read_providers(db)
    fundamentals = get_fundamentals(req.code.strip().upper(), req.market, req.asset_type, providers)
    return MarketFundamentalsResponse(
        code=req.code,
        market=req.market,
        fundamentals=fundamentals or {},
    )


@app.get("/api/market/providers")
def get_providers_info():
    return {
        'labels': PROVIDER_LABELS,
        'stock_options': STOCK_PROVIDER_OPTIONS,
        'fund_options': FUND_PROVIDER_OPTIONS,
    }


@app.post("/api/ocr/parse", response_model=OcrParseResponse)
async def ocr_parse(file: UploadFile = File(...), db: Session = Depends(get_db)):
    contents = await file.read()
    try:
        assets = parse_image(contents, file.filename or "image.png", db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR 识别失败: {str(e)}")
    items = [OcrAssetItem(**a) for a in assets]
    return OcrParseResponse(assets=items)


@app.post("/api/assets/batch-create", response_model=list[AssetResponse])
def batch_create_assets(data: AssetsBatchCreate, db: Session = Depends(get_db)):
    created = []
    for a in data.assets:
        db_asset = Asset(**a.model_dump())
        db.add(db_asset)
        db.flush()
        db.refresh(db_asset)
        created.append(db_asset)
    db.commit()
    return created


@app.post("/api/backup/export")
def export_backup(db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    settings = db.query(Settings).all()
    backup = {
        "version": "1.0",
        "exported_at": datetime.utcnow().isoformat(),
        "assets": [
            {
                "asset_type": a.asset_type,
                "market": a.market,
                "platform": a.platform,
                "code": a.code,
                "name": a.name,
                "shares": a.shares,
                "buy_price": a.buy_price,
                "buy_date": a.buy_date,
                "current_price": a.current_price,
                "price_updated_at": a.price_updated_at,
                "note": a.note,
            }
            for a in assets
        ],
        "settings": {s.key: s.value for s in settings},
    }
    return backup


@app.post("/api/backup/import")
def import_backup(data: dict, db: Session = Depends(get_db)):
    if "assets" in data:
        db.query(Asset).delete()
        for a in data["assets"]:
            asset = Asset(**a)
            db.add(asset)
    if "settings" in data:
        db.query(Settings).delete()
        for key, value in data["settings"].items():
            setting = Settings(key=key, value=value)
            db.add(setting)
    db.commit()
    return {"message": "数据恢复成功"}


@app.post("/api/backup/download")
def download_backup(db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    settings = db.query(Settings).all()
    backup = {
        "version": "1.0",
        "exported_at": datetime.utcnow().isoformat(),
        "assets": [
            {
                "asset_type": a.asset_type,
                "market": a.market,
                "platform": a.platform,
                "code": a.code,
                "name": a.name,
                "shares": a.shares,
                "buy_price": a.buy_price,
                "buy_date": a.buy_date,
                "current_price": a.current_price,
                "note": a.note,
            }
            for a in assets
        ],
        "settings": {s.key: s.value for s in settings},
    }
    json_str = json.dumps(backup, ensure_ascii=False, indent=2)
    return StreamingResponse(
        iter([json_str]),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=investment_backup.json"},
    )


@app.post("/api/data/clear")
def clear_all_data(db: Session = Depends(get_db)):
    try:
        db.query(AnalysisRecord).delete()
        db.query(Asset).delete()
        db.query(Target).delete()
        db.query(Settings).delete()
        db.query(InstalledSkill).delete()
        db.commit()
        return {"message": "所有数据已清空"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"清空数据失败: {str(e)}")


@app.get("/api/targets", response_model=list[TargetResponse])
def list_targets(
    source: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Target)
    if source:
        query = query.filter(Target.source == source)
    if status:
        query = query.filter(Target.status == status)
    return query.order_by(Target.created_at.desc()).all()


@app.post("/api/targets", response_model=TargetResponse)
def create_target(target: TargetCreate, db: Session = Depends(get_db)):
    db_target = Target(**target.model_dump())
    db.add(db_target)
    db.commit()
    db.refresh(db_target)
    return db_target


@app.put("/api/targets/{target_id}", response_model=TargetResponse)
def update_target(target_id: int, data: TargetUpdate, db: Session = Depends(get_db)):
    db_target = db.query(Target).filter(Target.id == target_id).first()
    if not db_target:
        raise HTTPException(status_code=404, detail="标的不存在")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_target, key, value)
    db.commit()
    db.refresh(db_target)
    return db_target


@app.delete("/api/targets/{target_id}")
def delete_target(target_id: int, db: Session = Depends(get_db)):
    db_target = db.query(Target).filter(Target.id == target_id).first()
    if not db_target:
        raise HTTPException(status_code=404, detail="标的不存在")
    db.delete(db_target)
    db.commit()
    return {"message": "删除成功"}


@app.post("/api/targets/clear-all")
def clear_all_targets(db: Session = Depends(get_db)):
    try:
        db.query(Target).delete()
        db.commit()
        return {"message": "所有标的已清空"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"清空标的失败: {str(e)}")


@app.post("/api/targets/ai-analyze-stream")
def ai_analyze_targets_stream(db: Session = Depends(get_db)):
    """SSE streaming endpoint for target AI analysis."""
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        stream_target_analysis(db),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@app.get("/api/investment-advice/check")
def advice_check(db: Session = Depends(get_db)):
    """Quick check if investment advice is configured (budgets exist)."""
    budgets = _load_investment_budgets(db)
    return {"configured": len(budgets) > 0, "budget_count": len(budgets)}


@app.post("/api/investment-advice/run-stream")
def advice_run_stream(db: Session = Depends(get_db)):
    """SSE streaming endpoint for investment advice."""
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        stream_investment_advice(db),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@app.post("/api/targets/ai-analyze", response_model=AgentAnalysisResponse)
def ai_analyze_targets(req: Optional[AIRecommendConfig] = None, db: Session = Depends(get_db)):
    try:
        api_key = get_setting(db, "openai_api_key")
        base_url = get_setting(db, "openai_base_url")
        model = get_setting(db, "openai_model") or "gpt-4o-mini"

        if not api_key:
            raise HTTPException(status_code=400, detail="请先在设置页面配置 OpenAI API Key")

        personality = get_setting(db, "ai_personality") or "balanced"
        report_style = get_setting(db, "ai_report_style") or "professional"

        # Persist AI recommend config for scheduled tasks
        if req:
            if req.markets:
                set_setting(db, "ai_recommend_markets", ",".join(req.markets))
            if req.asset_types:
                set_setting(db, "ai_recommend_asset_types", ",".join(req.asset_types))

        # Read effective filter (from request or from saved settings)
        markets = req.markets if req and req.markets else []
        asset_types = req.asset_types if req and req.asset_types else []
        if not markets:
            markets_str = get_setting(db, "ai_recommend_markets") or ""
            markets = [m.strip() for m in markets_str.split(",") if m.strip()]
        if not asset_types:
            types_str = get_setting(db, "ai_recommend_asset_types") or ""
            asset_types = [t.strip() for t in types_str.split(",") if t.strip()]

        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url or None, timeout=120)

        all_targets = db.query(Target).filter(Target.status == "active").all()
        # Apply AI recommend filter
        targets = [t for t in all_targets
                   if (not markets or t.market in markets)
                   and (not asset_types or t.asset_type in asset_types)]

        # Build target_data with real-time market quotes AND fundamentals
        target_data = []
        providers = _read_providers(db)
        for t in targets:
            code_key = t.code.strip().upper()
            item = {
                "code": t.code, "name": t.name, "market": t.market,
                "asset_type": t.asset_type, "source": t.source,
                "priority": t.priority, "risk_level": t.risk_level,
            }
            try:
                quote = get_quote(code_key, t.market, t.asset_type, providers)
                if quote:
                    item["current_price"] = quote.get("current_price")
                    item["change_pct"] = quote.get("change_pct")
                    item["prev_close"] = quote.get("prev_close")
            except Exception:
                pass
            try:
                fundamentals = get_fundamentals(code_key, t.market, t.asset_type, providers)
                if fundamentals:
                    item["fundamentals"] = fundamentals
            except Exception:
                pass
            target_data.append(item)

        ctx = SkillContext(
            api_key=api_key, base_url=base_url, model=model,
            db_session=db,
            data={"target_data": target_data},
            personality=personality, report_style=report_style,
        )
        ctx.client = client

        try:
            macro_result = MacroAnalysisSkill().execute(ctx)
            ctx.data["macro_analysis"] = macro_result
        except Exception:
            ctx.data["macro_analysis"] = {"fallback": True}

        target_result = {"existing_targets_analysis": [], "new_recommendations": []}
        market_insight = "标的分析完成"
        try:
            target_result = TargetAnalysisSkill().execute(ctx)
            market_insight = target_result.get("market_insight") or "标的分析完成"
        except Exception:
            pass

        def safe_str(v, default=""):
            return str(v) if v is not None else default

        price_map = {}
        fundamentals_map = {}
        for td in target_data:
            if td.get("code") and td.get("current_price") is not None:
                price_map[td["code"]] = td["current_price"]
            if td.get("code") and td.get("fundamentals"):
                fundamentals_map[td["code"]] = td["fundamentals"]

        def attach_realtime_market_data(payload: dict, fallback_market: str = "A", fallback_type: str = "stock"):
            code_value = safe_str(payload.get("code")).strip().upper()
            market_value = safe_str(payload.get("market")) or fallback_market
            type_value = safe_str(payload.get("asset_type")) or fallback_type
            market_data = {}
            try:
                q = get_quote(code_value, market_value, type_value, providers)
                if q:
                    market_data["quote"] = {
                        "current_price": q.get("current_price"),
                        "prev_close": q.get("prev_close"),
                        "change": q.get("change"),
                        "change_pct": q.get("change_pct"),
                        "source": q.get("source"),
                    }
                    if q.get("current_price") is not None:
                        payload["recommended_price"] = q.get("current_price")
            except Exception:
                pass
            try:
                f = get_fundamentals(code_value, market_value, type_value, providers)
                if f:
                    market_data["fundamentals"] = f
            except Exception:
                pass
            if market_data:
                payload["market_data"] = market_data

        # Filter new recommendations by AI recommend config
        filtered_recs = []
        for rec in (target_result.get("new_recommendations") or []):
            if not isinstance(rec, dict):
                continue
            rec_market = rec.get("market", "")
            rec_type = rec.get("asset_type", "")
            if markets and rec_market not in markets:
                continue
            if asset_types and rec_type not in asset_types:
                continue
            filtered_recs.append(rec)
        target_result["new_recommendations"] = filtered_recs

        # Process new recommendations FIRST so removal logic below takes final effect
        for rec in (target_result.get("new_recommendations") or []):
            if not isinstance(rec, dict):
                continue
            code = safe_str(rec.get("code"))
            if not code:
                continue
            attach_realtime_market_data(rec, safe_str(rec.get("market")) or "A", safe_str(rec.get("asset_type")) or "stock")
            existing = db.query(Target).filter(
                Target.code == code,
                Target.source == "ai_recommended",
            ).first()
            if existing:
                existing.reason = safe_str(rec.get("reason"), existing.reason or "")
                existing.priority = safe_str(rec.get("priority"), existing.priority or "MEDIUM")
                existing.expected_return = safe_str(rec.get("expected_return"), existing.expected_return or "")
                existing.risk_level = safe_str(rec.get("risk_level"), existing.risk_level or "MEDIUM")
                existing.status = "active"
                try:
                    existing.ai_analysis = json.dumps(rec, ensure_ascii=False, default=str)
                except Exception:
                    pass
            else:
                db.add(Target(
                    code=code,
                    name=safe_str(rec.get("name")) or code,
                    market=safe_str(rec.get("market")) or "A",
                    asset_type=safe_str(rec.get("asset_type")) or "stock",
                    source="ai_recommended",
                    reason=safe_str(rec.get("reason")),
                    priority=safe_str(rec.get("priority")) or "MEDIUM",
                    risk_level=safe_str(rec.get("risk_level")) or "MEDIUM",
                    expected_return=safe_str(rec.get("expected_return")),
                    status="active",
                    ai_analysis=json.dumps(rec, ensure_ascii=False, default=str),
                ))

        # Process existing targets analysis LAST so removals take final effect
        for item in (target_result.get("existing_targets_analysis") or []):
            if not isinstance(item, dict):
                continue
            t = db.query(Target).filter(
                Target.code == safe_str(item.get("code")),
                Target.status == "active",
            ).first()
            if t:
                if item.get("keep") is False:
                    db.delete(t)
                else:
                    rec_price = price_map.get(t.code)
                    if rec_price is not None:
                        item["recommended_price"] = rec_price
                    if fundamentals_map.get(t.code):
                        item["market_data"] = item.get("market_data") or {}
                        item["market_data"]["fundamentals"] = fundamentals_map[t.code]
                    try:
                        t.ai_analysis = json.dumps(item, ensure_ascii=False, default=str)
                    except Exception:
                        t.ai_analysis = "{}"
                    t.last_analyzed_at = datetime.utcnow().isoformat()

        db.commit()

        return AgentAnalysisResponse(
            summary=market_insight,
            report={
                "macro_analysis": ctx.data.get("macro_analysis", {}),
                "target_analysis": target_result,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"分析异常: {str(e)}")


@app.post("/api/analysis/agent-run", response_model=AgentAnalysisResponse)
def agent_analysis_run(req: AgentAnalysisRequest, db: Session = Depends(get_db)):
    api_key = get_setting(db, "openai_api_key")
    base_url = get_setting(db, "openai_base_url")
    model = get_setting(db, "openai_model") or "gpt-4o-mini"

    if not api_key:
        raise HTTPException(status_code=400, detail="请先在设置页面配置 OpenAI API Key")

    assets_query = db.query(Asset)
    if req.asset_ids:
        assets_query = assets_query.filter(Asset.id.in_(req.asset_ids))
    assets = assets_query.all()

    targets = db.query(Target).filter(Target.status == "active").all()
    target_data = [] if not req.target_ids else [
        {"code": t.code, "name": t.name, "market": t.market,
         "asset_type": t.asset_type, "source": t.source}
        for t in targets
    ]

    asset_data = [_asset_analysis_data(a) for a in assets]

    providers = _read_providers(db)
    fundamentals_map, history_map = _fetch_asset_market_context(asset_data, providers)

    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"

    if asset_data:
        result = _run_compact_asset_ai_analysis(
            api_key=api_key,
            base_url=base_url,
            model=model,
            personality=personality,
            report_style=report_style,
            goal=req.goal,
            asset_data=asset_data,
            fundamentals_map=fundamentals_map,
            history_map=history_map,
            db_session=db,
        )

        total_market_value = sum(a.get("market_value", 0) for a in asset_data)
        total_cost = sum(a.get("total_cost", 0) for a in asset_data)
        total_pnl = sum(a.get("total_pnl", 0) for a in asset_data)
        total_pnl_percent = (total_pnl / total_cost * 100) if total_cost else 0

        record = AnalysisRecord(
            summary=result.get("summary", "AI 分析完成"),
            detail=json.dumps(result, ensure_ascii=False, default=str),
            total_market_value=total_market_value,
            total_cost=total_cost,
            total_pnl=total_pnl,
            total_pnl_percent=total_pnl_percent,
        )
        db.add(record)

        asset_by_id = {a.id: a for a in assets}
        for rec in result.get("asset_analyses", []):
            asset_id = rec.get("asset_id")
            asset = asset_by_id.get(asset_id)
            if not asset:
                continue
            current_price = _effective_asset_price(asset)
            market_value = asset.shares * current_price
            total_cost_asset = asset.shares * asset.buy_price
            total_pnl_asset = market_value - total_cost_asset
            asset_rec = AnalysisRecord(
                summary=rec.get("summary") or rec.get("suggested_action") or "AI 资产分析完成",
                detail=json.dumps(rec, ensure_ascii=False, default=str),
                asset_id=asset.id,
                total_market_value=market_value,
                total_cost=total_cost_asset,
                total_pnl=total_pnl_asset,
                total_pnl_percent=(total_pnl_asset / total_cost_asset * 100) if total_cost_asset else 0,
            )
            db.add(asset_rec)

        db.commit()
        return AgentAnalysisResponse(summary=result.get("summary", "分析完成"), report=result)

    ctx = SkillContext(
        api_key=api_key, base_url=base_url, model=model, db_session=db,
        personality=personality, report_style=report_style,
    )
    ctx.data["asset_data"] = asset_data
    ctx.data["target_data"] = target_data
    ctx.data["fundamentals"] = fundamentals_map
    ctx.data["history"] = history_map

    installed_ids = get_installed_skill_names(db)
    harness = AgentHarness(ctx)
    harness.load_skills(installed_skill_ids=installed_ids)

    result = harness.execute(goal=req.goal, asset_data=asset_data)

    record = AnalysisRecord(
        summary=result.get("summary", "AI 代理分析完成"),
        detail=json.dumps(result, ensure_ascii=False),
        total_market_value=sum(a.get("current_price", 0) * a.get("shares", 0) for a in asset_data),
        total_cost=sum(a.get("buy_price", 0) * a.get("shares", 0) for a in asset_data),
        total_pnl=sum((a.get("current_price", 0) - a.get("buy_price", 0)) * a.get("shares", 0) for a in asset_data),
    )
    db.add(record)

    asset_by_code = {_analysis_code_key(a.code): a for a in assets}
    for rec in (result.get("recommendations", {}).get("asset_recommendations", [])):
        code = _analysis_code_key(rec.get("asset_code") or "")
        asset = asset_by_code.get(code)
        if not asset:
            continue
        asset_rec = AnalysisRecord(
            summary=rec.get("summary", ""),
            detail=json.dumps(rec, ensure_ascii=False),
            asset_id=asset.id,
            total_market_value=asset.shares * _effective_asset_price(asset),
            total_cost=asset.shares * asset.buy_price,
            total_pnl=asset.shares * (_effective_asset_price(asset) - asset.buy_price),
        )
        db.add(asset_rec)

    db.commit()

    return AgentAnalysisResponse(summary=result.get("summary", "分析完成"), report=result)


@app.post("/api/investment-advice/run", response_model=InvestmentAdviceResponse)
def run_investment_advice(db: Session = Depends(get_db)):
    api_key = get_setting(db, "openai_api_key")
    base_url = get_setting(db, "openai_base_url")
    model = get_setting(db, "openai_model") or "gpt-4o-mini"
    if not api_key:
        raise HTTPException(status_code=400, detail="请先在设置页面配置 OpenAI API Key")

    budgets = _load_investment_budgets(db)
    if not budgets:
        raise HTTPException(status_code=400, detail="请先在设置页面配置平台投资额度")

    assets = db.query(Asset).all()
    providers = _read_providers(db)
    budget_status = _investment_budget_status(budgets, assets)
    asset_items, target_items = _candidate_investment_targets(db, budgets, assets, providers)
    today_analysis = _latest_today_asset_analysis(db, assets)
    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"

    ctx = SkillContext(
        api_key=api_key,
        base_url=base_url,
        model=model,
        personality=personality,
        report_style=report_style,
    )
    client = OpenAI(api_key=api_key, base_url=base_url or None, timeout=90)

    prompt = f"""{ctx.system_prompt}

请生成“AI 投资建议”交易清单。你需要结合投资性格、平台剩余额度、我的标的、我的持仓、今天已经生成过的资产 AI 分析结果，以及最新行情，给出可执行但克制的交易建议。

平台额度状态：
{json.dumps(budget_status, ensure_ascii=False, default=str)}

当前持仓及最新行情：
{json.dumps(asset_items, ensure_ascii=False, default=str)[:12000]}

我的标的池及最新行情：
{json.dumps(target_items[:40], ensure_ascii=False, default=str)[:12000]}

今天的资产 AI 分析结果（如果为空，表示今天还没有跑过资产 AI 分析）：
{json.dumps(today_analysis, ensure_ascii=False, default=str)[:12000]}

约束：
1. 买入建议必须来自当前持仓或我的标的池，卖出建议必须来自当前持仓。
2. 买入建议必须符合对应平台的 currency、asset_types、markets 配置，且总金额不能超过 remaining_amount。
3. 不要建议把某个平台剩余额度一次性全部花完；除非行情信号非常明确，否则单个平台建议使用 20%-60% 剩余额度。
4. 不要过于保守；若有可用额度且标的池中存在较清晰机会，应给出至少一条小到中等仓位的买入建议。
5. 如果行情/分析信号不足，可以给出少量卖出、减风险或不超过 25% 剩余额度的试探性买入建议。
6. shares 必须是数字；price 使用最新行情价；trade_type 只能是 BUY 或 SELL。

请只返回 JSON：
{{
  "summary": "整体交易建议摘要，120字以内",
  "advice": [
    {{
      "budget_id": "平台额度 id",
      "platform": "平台名称",
      "market": "A/HK/US",
      "asset_type": "stock/onshore_fund/offshore_fund",
      "code": "交易代码",
      "name": "交易对象名称",
      "trade_type": "BUY/SELL",
      "shares": 0,
      "price": 0,
      "reason": "交易理由，说明依据了性格、额度、标的/资产分析和行情",
      "confidence_score": 0,
      "risk_note": "主要风险"
    }}
  ]
}}"""

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": ctx.system_prompt},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        raw = json.loads(resp.choices[0].message.content)
    except Exception as e:
        print(f"[InvestmentAdvice] AI failed: {e}")
        raw = _fallback_investment_advice(budget_status, target_items)

    result = _normalize_investment_advice(raw, budgets, assets, target_items, budget_status)
    # 持久化投资建议到数据库
    from models import InvestmentAdviceRecord
    record = InvestmentAdviceRecord(
        summary=result.get('summary', ''),
        advice_json=json.dumps(result.get('advice', []), ensure_ascii=False, default=str),
        budget_status_json=json.dumps(result.get('budget_status', []), ensure_ascii=False, default=str),
    )
    db.add(record)
    db.commit()
    return InvestmentAdviceResponse(**result)


@app.get('/api/investment-advice/latest')
def get_latest_investment_advice(db: Session = Depends(get_db)):
    from models import InvestmentAdviceRecord
    record = db.query(InvestmentAdviceRecord).order_by(InvestmentAdviceRecord.created_at.desc()).first()
    if not record:
        raise HTTPException(status_code=404, detail='暂无投资建议记录')
    return {
        'summary': record.summary or '',
        'advice': json.loads(record.advice_json or '[]'),
        'budget_status': json.loads(record.budget_status_json or '[]'),
    }


def _find_asset_for_advice(db: Session, advice: dict) -> Asset | None:
    asset_id = advice.get("asset_id")
    if asset_id:
        asset = db.query(Asset).filter(Asset.id == asset_id).first()
        if asset:
            return asset
    code = _analysis_code_key(advice.get("code") or "")
    platform = str(advice.get("platform") or "").strip()
    market = str(advice.get("market") or "").strip().upper()
    asset_type = str(advice.get("asset_type") or "").strip()
    assets = db.query(Asset).filter(
        Asset.platform == platform,
        Asset.market == market,
        Asset.asset_type == asset_type,
    ).all()
    return next((asset for asset in assets if _analysis_code_key(asset.code) == code), None)


@app.post("/api/investment-advice/accept")
def accept_investment_advice(req: InvestmentAdviceAcceptRequest, db: Session = Depends(get_db)):
    advice = req.advice or {}
    trade_type = str(advice.get("trade_type") or "").strip().upper()
    if trade_type not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="交易操作只能是买入或卖出")

    shares = _normalize_ai_number(advice.get("shares"), 0)
    price = _normalize_ai_number(advice.get("price"), 0)
    if shares <= 0 or price <= 0:
        raise HTTPException(status_code=400, detail="交易份额和价格必须大于 0")

    budgets = _load_investment_budgets(db)
    assets = db.query(Asset).all()
    budget_status = _investment_budget_status(budgets, assets)
    budget = _find_budget(
        budget_status,
        advice.get("budget_id"),
        str(advice.get("platform") or "").strip(),
        str(advice.get("market") or "").strip().upper(),
        str(advice.get("asset_type") or "").strip(),
    )
    if not budget:
        raise HTTPException(status_code=400, detail="未找到匹配的平台额度配置")

    providers = _read_providers(db)
    quote = _quote_for_investment_item(advice, providers)
    live_price = _normalize_ai_number(quote.get("current_price"), price)
    if live_price > 0:
        price = live_price

    trade_date = date.today().isoformat()
    note = f"采纳 AI 投资建议：{advice.get('reason') or ''}".strip()
    asset = _find_asset_for_advice(db, advice)

    if trade_type == "BUY":
        estimated_amount = shares * price
        if estimated_amount > _normalize_ai_number(budget.get("remaining_amount"), 0) + 1e-6:
            raise HTTPException(status_code=400, detail="该建议已超过平台剩余额度，请重新生成建议")
        if not asset:
            code = str(advice.get("code") or "").strip()
            name = str(advice.get("name") or code).strip() or code
            asset = Asset(
                asset_type=str(advice.get("asset_type") or "stock").strip(),
                market=str(advice.get("market") or "A").strip().upper(),
                platform=str(advice.get("platform") or budget.get("platform") or "").strip(),
                code=code,
                name=name,
                shares=shares,
                buy_price=price,
                buy_date=trade_date,
                current_price=price,
                price_updated_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
                note="由 AI 投资建议采纳创建",
            )
            db.add(asset)
            db.flush()
        else:
            existing_count = db.query(AssetTransaction).filter(AssetTransaction.asset_id == asset.id).count()
            if existing_count == 0 and (asset.shares or 0) > 0 and (asset.buy_price or 0) > 0:
                db.add(AssetTransaction(
                    asset_id=asset.id,
                    trade_type="buy",
                    trade_date=asset.buy_date,
                    shares=asset.shares,
                    price=asset.buy_price,
                    fee=0,
                    note="初始买入",
                ))
            old_shares = asset.shares or 0
            new_shares = old_shares + shares
            old_cost = old_shares * (asset.buy_price or 0)
            new_cost = shares * price
            asset.shares = new_shares
            asset.buy_price = (old_cost + new_cost) / new_shares if new_shares > 0 else asset.buy_price
            asset.current_price = price
            asset.price_updated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
            asset.updated_at = datetime.utcnow()
    else:
        if not asset:
            raise HTTPException(status_code=404, detail="卖出建议对应资产不存在")
        if shares > (asset.shares or 0):
            raise HTTPException(status_code=400, detail="卖出份额不能超过当前持仓")
        existing_count = db.query(AssetTransaction).filter(AssetTransaction.asset_id == asset.id).count()
        if existing_count == 0 and (asset.shares or 0) > 0 and (asset.buy_price or 0) > 0:
            db.add(AssetTransaction(
                asset_id=asset.id,
                trade_type="buy",
                trade_date=asset.buy_date,
                shares=asset.shares,
                price=asset.buy_price,
                fee=0,
                note="初始买入",
            ))
        asset.shares = max(0, (asset.shares or 0) - shares)
        asset.current_price = price
        asset.price_updated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
        asset.updated_at = datetime.utcnow()

    db_transaction = AssetTransaction(
        asset_id=asset.id,
        trade_type="buy" if trade_type == "BUY" else "sell",
        trade_date=trade_date,
        shares=shares,
        price=price,
        fee=0,
        note=note,
    )
    db.add(db_transaction)
    db.commit()
    db.refresh(asset)
    db.refresh(db_transaction)

    return {
        "message": "已采纳投资建议并写入交易",
        "asset": AssetResponse.model_validate(asset),
        "transaction": AssetTransactionResponse.model_validate(db_transaction),
    }


@app.get("/api/skills/market")
def list_marketplace_skills():
    return get_all_skills()


@app.get("/api/skills/installed")
def list_installed_skills(db: Session = Depends(get_db)):
    installed_names = get_installed_skill_names(db)
    all_skills = get_all_skills()
    return [
        {**s, "installed": s["id"] in installed_names}
        for s in all_skills
    ]


@app.post("/api/skills/install")
def install_marketplace_skill(data: dict, db: Session = Depends(get_db)):
    skill_id = data.get("skill_id", "")
    skill = get_skill_by_id(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    success = install_skill(db, skill_id)
    return {"message": f"Skill '{skill['name']}' 安装成功" if success else "安装失败"}


@app.post("/api/skills/uninstall")
def uninstall_marketplace_skill(data: dict, db: Session = Depends(get_db)):
    skill_id = data.get("skill_id", "")
    success = uninstall_skill(db, skill_id)
    return {"message": "卸载成功" if success else "核心 Skill 不可卸载"}


STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")


    @app.get("/")
    async def serve_root():
        index_path = os.path.join(STATIC_DIR, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        return {"detail": "Not Found"}

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            return {"detail": "Not Found"}
        index_path = os.path.join(STATIC_DIR, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        return {"detail": "Not Found"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
