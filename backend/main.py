from __future__ import annotations
import json
import os
import time
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

from database import get_db, init_db, SessionLocal
from models import Asset, AssetTransaction, AnalysisRecord, Settings, Target, InstalledSkill
from schemas import (
    AssetCreate, AssetUpdate, AssetResponse,
    AssetDetailResponse, AssetTransactionCreate, AssetTransactionResponse,
    AssetAnalysisSnippet,
    AnalysisResponse, SettingsUpdate, SettingsResponse,
    DashboardData, TargetCreate, TargetUpdate, TargetResponse,
    AgentAnalysisRequest, AgentAnalysisResponse, AIRecommendConfig,
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
    total_market_value = sum(a.shares * (a.current_price or a.buy_price) for a in assets)
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
    code = (asset.code or "").strip().lower()
    name = (asset.name or "").strip().lower()
    asset_id_token = f'"id": {asset.id}'
    records = db.query(AnalysisRecord).order_by(AnalysisRecord.created_at.desc()).limit(50).all()
    for record in records:
        detail = (record.detail or "").lower()
        if (code and code in detail) or (name and name in detail) or asset_id_token in detail:
            return record
    return None


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


@app.get("/api/analysis/latest", response_model=AnalysisResponse)
def get_latest_analysis(db: Session = Depends(get_db)):
    record = db.query(AnalysisRecord).order_by(AnalysisRecord.created_at.desc()).first()
    if not record:
        raise HTTPException(status_code=404, detail="暂无分析记录")
    return record


@app.get("/api/analysis/history", response_model=list[AnalysisResponse])
def get_analysis_history(db: Session = Depends(get_db)):
    return db.query(AnalysisRecord).order_by(AnalysisRecord.created_at.desc()).limit(50).all()


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

    asset_data = [
        {
            "id": a.id, "code": a.code, "name": a.name or a.code,
            "market": a.market, "asset_type": a.asset_type,
            "platform": a.platform, "shares": a.shares,
            "buy_price": a.buy_price, "current_price": a.current_price or a.buy_price,
            "buy_date": a.buy_date, "note": a.note,
        }
        for a in assets
    ] if req.asset_ids else [
        {
            "id": a.id, "code": a.code, "name": a.name or a.code,
            "market": a.market, "asset_type": a.asset_type,
            "platform": a.platform, "shares": a.shares,
            "buy_price": a.buy_price, "current_price": a.current_price or a.buy_price,
            "buy_date": a.buy_date, "note": a.note,
        }
        for a in assets_query.all()
    ]

    providers = _read_providers(db)
    fundamentals_map = {}
    history_map = {}
    for item in asset_data:
        code_key = item["code"].strip().upper()
        market = item.get("market", "A")
        asset_type = item.get("asset_type", "stock")
        try:
            f = get_fundamentals(code_key, market, asset_type, providers)
            if f:
                fundamentals_map[code_key] = f
        except Exception:
            pass
        try:
            h = get_history(code_key, market, asset_type, providers)
            if h:
                history_map[code_key] = h
        except Exception:
            pass

    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"

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
    db.commit()

    return AgentAnalysisResponse(summary=result.get("summary", "分析完成"), report=result)


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
