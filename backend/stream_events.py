"""
Real-time SSE event generators for AI analysis operations.
Each generator yields progress, log, and thinking events as analysis progresses.
"""

from __future__ import annotations
import json
import time
from typing import Any, Generator
from sqlalchemy.orm import Session
from openai import OpenAI

from models import Asset, Target, AnalysisRecord
from agent.personality import build_system_prompt

SSE_PADDING = ":" + (" " * 4096) + "\n"


def sse_event(event_type: str, data: dict) -> str:
    """Format an SSE event string."""
    return f"{SSE_PADDING}event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _yield(fn):
    """Decorator to make a function yield its return value as SSE."""
    # Not needed, keeping simple
    pass


def get_setting(db: Session, key: str) -> str:
    from ai_service import get_setting as _gs
    return _gs(db, key)


def _message_content(response) -> str:
    try:
        return response.choices[0].message.content or ""
    except Exception:
        return ""


def _retry_non_stream_text(client: OpenAI, model: str, messages: list[dict]) -> str:
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        stream=False,
    )
    return _message_content(response)


def stream_portfolio_analysis(db: Session) -> Generator[str, None, None]:
    """
    SSE generator for portfolio analysis.
    Yields real progress events as the analysis progresses.
    Uses OpenAI streaming to show real AI thinking.
    """
    api_key = get_setting(db, "openai_api_key")
    if not api_key:
        yield sse_event("error", {"detail": "请先配置 OpenAI API Key"})
        return

    from ai_service import normalize_openai_base_url
    base_url = normalize_openai_base_url(get_setting(db, "openai_base_url"))
    model = get_setting(db, "openai_model") or "gpt-4o-mini"
    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"
    system_prompt = build_system_prompt(personality, report_style)
    client = OpenAI(api_key=api_key, base_url=base_url or None, timeout=300)
    from ai_service import (
        empty_portfolio_analysis_report,
        coerce_ai_report_fields, openai_error_detail, openai_runtime_summary, parse_ai_json_object,
        sanitize_ai_payload, strip_model_thinking, text_report_fallback,
    )
    runtime_summary = openai_runtime_summary(api_key, base_url, model)

    # Stage 1: Load assets (slow start)
    yield sse_event("log", {"message": f"当前 AI 配置：{runtime_summary}", "tag": "配置"})
    yield sse_event("log", {"message": "正在加载资产数据...", "tag": "加载"})
    assets = [a for a in db.query(Asset).all() if (a.shares or 0) > 0]
    yield sse_event("log", {"message": f"已加载 {len(assets)} 项持仓资产", "tag": "加载"})
    yield sse_event("progress", {"progress": 5})

    if not assets:
        report = empty_portfolio_analysis_report()
        record = AnalysisRecord(
            summary=report["summary"],
            detail=report["detail"],
            total_market_value=0,
            total_cost=0,
            total_pnl=0,
            total_pnl_percent=0,
            realized_pnl=0,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        yield sse_event("log", {"message": "当前为空仓，已切换到 AI 建仓模式", "tag": "建仓"})
        yield sse_event("complete", {
            "id": record.id,
            "summary": report["summary"],
            "detail": report["detail"],
            "total_market_value": 0,
            "total_cost": 0,
            "total_pnl": 0,
            "total_pnl_percent": 0,
            "realized_pnl": 0,
            "created_at": record.created_at.isoformat() if hasattr(record.created_at, 'isoformat') else str(record.created_at),
        })
        return

    # Calculate totals
    total_cost = sum(a.shares * a.buy_price for a in assets)
    total_market_value = sum(a.shares * (a.current_price or a.buy_price) for a in assets)
    total_pnl = total_market_value - total_cost

    yield sse_event("log", {"message": f"总市值: ¥{total_market_value:.2f}, 总成本: ¥{total_cost:.2f}", "tag": "计算"})
    yield sse_event("progress", {"progress": 8})

    # Stage 2: Fetch fundamentals
    yield sse_event("progress", {"progress": 10})
    yield sse_event("thinking", {"message": "正在获取实时基本面数据..."})
    yield sse_event("log", {"message": "正在获取各资产基本面数据...", "tag": "基本面"})

    from data_source import get_fundamentals
    providers: dict = {}
    asset_summary = []
    for idx, a in enumerate(assets):
        cost = a.shares * a.buy_price
        mv = a.shares * (a.current_price or a.buy_price)
        pnl = mv - cost
        pct = (pnl / cost * 100) if cost > 0 else 0
        item = {
            "name": a.name or a.code, "code": a.code.strip().upper(),
            "type": a.asset_type, "market": a.market, "platform": a.platform,
            "cost": round(cost, 2), "market_value": round(mv, 2),
            "pnl": round(pnl, 2), "pnl_percent": round(pct, 2),
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

        if (idx + 1) % 2 == 0 or idx == len(assets) - 1:
            progress = 10 + (idx + 1) / len(assets) * 15
            yield sse_event("progress", {"progress": round(progress, 1)})
            yield sse_event("log", {"message": f"已获取 {idx + 1}/{len(assets)} 项资产的基本面数据", "tag": "基本面"})

    # Stage 3: Build prompt
    yield sse_event("thinking", {"message": "正在构建分析提示词..."})
    yield sse_event("progress", {"progress": 28})

    prompt = f"""请根据以下投资组合数据与实时基本面数据，提供一份简洁的资产分析报告。

持仓明细：
{json.dumps(asset_summary, ensure_ascii=False, indent=2)}

总市值：{total_market_value:.2f}
总成本：{total_cost:.2f}
总盈亏：{total_pnl:.2f}

请返回 JSON：
{{"summary": "一句话总结", "detail": "Markdown 格式的详细分析报告，使用 ##/### 标题、项目符号、Markdown 表格和 **重点加粗**，不要返回 HTML"}}

重要约束：
- 所有用户可见内容必须使用中文。
- 不要输出英文推理、内部思考过程、<think> 标签或 reasoning 内容。
- 最终回复只能是 JSON 对象，不要在 JSON 前后添加任何解释。"""

    # Stage 4: Call OpenAI with streaming
    yield sse_event("log", {"message": "正在调用 AI 模型进行分析...", "tag": "AI"})
    yield sse_event("thinking", {"message": "AI 开始分析投资组合..."})
    yield sse_event("progress", {"progress": 30})

    try:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )

        collected = ""
        token_count = 0
        for chunk in response:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                collected += delta.content
                token_count += 1

                if token_count % 20 == 0:
                    # Show real AI content every 20 tokens
                    preview = collected[-80:].replace('\n', ' ') if len(collected) > 80 else collected.replace('\n', ' ')
                    preview = strip_model_thinking(preview) or "AI 正在生成报告..."
                    yield sse_event("thinking", {"message": f"AI 正在生成报告... {preview}"})
                    p = 30 + min(62, token_count * 0.5)
                    yield sse_event("progress", {"progress": round(p, 1)})

        if not collected.strip():
            yield sse_event("log", {"message": "流式响应内容为空，正在改用非流式请求重试...", "tag": "AI"})
            collected = _retry_non_stream_text(client, model, messages)

        # Parse JSON result
        yield sse_event("log", {"message": "AI 响应完成，正在解析结果...", "tag": "AI"})
        yield sse_event("progress", {"progress": 95})

        collected_clean = strip_model_thinking(collected)
        try:
            result = parse_ai_json_object(collected_clean)
        except Exception:
            yield sse_event("log", {"message": "模型返回内容不是严格 JSON，已按文本报告保存", "tag": "AI"})
            result = text_report_fallback(collected_clean, "AI 返回了非 JSON 报告")
        result = sanitize_ai_payload(result)
        summary, detail = coerce_ai_report_fields(result.get("summary", "分析完成"), result.get("detail", ""))
        summary = summary or "分析完成"

        # Save to DB
        record = AnalysisRecord(
            summary=summary, detail=detail,
            total_market_value=total_market_value, total_cost=total_cost,
            total_pnl=total_pnl,
            total_pnl_percent=(total_pnl / total_cost * 100) if total_cost > 0 else 0,
            realized_pnl=0,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

        yield sse_event("log", {"message": "✅ 分析报告已保存", "tag": "AI"})
        yield sse_event("progress", {"progress": 100})
        yield sse_event("complete", {
            "id": record.id,
            "summary": summary,
            "detail": detail,
            "total_market_value": total_market_value,
            "total_cost": total_cost,
            "total_pnl": total_pnl,
            "total_pnl_percent": (total_pnl / total_cost * 100) if total_cost > 0 else 0,
            "realized_pnl": 0,
            "created_at": record.created_at.isoformat() if hasattr(record.created_at, 'isoformat') else str(record.created_at),
        })

    except Exception as e:
        import traceback
        yield sse_event("error", {"detail": f"AI 分析失败: {openai_error_detail(e, runtime_summary)}"})
        yield sse_event("log", {"message": f"❌ 分析出错: {str(e)}", "tag": "AI"})


def stream_target_analysis(db: Session, markets: list[str] = None, asset_types: list[str] = None) -> Generator[str, None, None]:
    """SSE generator for target AI analysis and recommendation persistence."""
    api_key = get_setting(db, "openai_api_key")
    if not api_key:
        yield sse_event("error", {"detail": "请先配置 OpenAI API Key"})
        return

    try:
        from main import ai_analyze_targets
        from schemas import AIRecommendConfig

        yield sse_event("log", {"message": "正在读取推荐范围与已有标的...", "tag": "标的"})
        yield sse_event("progress", {"progress": 10})
        yield sse_event("thinking", {"message": "AI 正在分析现有标的并生成新推荐..."})
        yield sse_event("log", {"message": "正在调用 AI 标的推荐引擎...", "tag": "AI"})
        yield sse_event("progress", {"progress": 35})

        req = AIRecommendConfig(markets=markets or [], asset_types=asset_types or []) if markets or asset_types else None
        response = ai_analyze_targets(req=req, db=db)
        payload = response.model_dump() if hasattr(response, "model_dump") else dict(response)
        report = payload.get("report") or {}
        target_analysis = report.get("target_analysis") or {}
        new_count = len(target_analysis.get("new_recommendations") or [])
        existing_count = len(target_analysis.get("existing_targets_analysis") or [])
        diag = (target_analysis.get("filter_diagnostics")
                or report.get("filter_diagnostics")
                or {})

        if new_count == 0:
            raw_count = int(diag.get("raw_count") or 0)
            missing_code = int(diag.get("missing_code_count") or 0)
            filt_market = int(diag.get("filtered_market_count") or 0)
            filt_type = int(diag.get("filtered_type_count") or 0)
            filt_markets = diag.get("filter_markets") or []
            filt_types = diag.get("filter_asset_types") or []
            if raw_count == 0:
                yield sse_event("log", {
                    "message": "⚠️ AI 未返回任何新标的（可能因数据缺失或被市场/类型限制拒绝）",
                    "tag": "标的过滤",
                })
            else:
                yield sse_event("log", {
                    "message": (
                        f"⚠️ AI 返回 {raw_count} 条候选，"
                        f"因市场/类型限制被过滤 {filt_market + filt_type} 条，"
                        f"无 code {missing_code} 条，最终 0 条入库"
                    ),
                    "tag": "标的过滤",
                })
                if filt_markets or filt_types:
                    yield sse_event("log", {
                        "message": (
                            f"  当前过滤：市场={filt_markets or '未限制'} "
                            f"类型={filt_types or '未限制'}"
                        ),
                        "tag": "标的过滤",
                    })
                yield sse_event("log", {
                    "message": (
                        "  提示：到「设置 → AI 推荐」放宽 市场/类型 范围可让更多推荐入库"
                    ),
                    "tag": "标的过滤",
                })

        yield sse_event("log", {
            "message": (
                f"✅ 标的分析完成，新增 {new_count} 个推荐，更新 {existing_count} 个已有标的"
                if new_count else
                f"⚠️ 标的分析完成，但 0 个新推荐入库（参见上方过滤原因）"
            ),
            "tag": "AI",
        })
        yield sse_event("progress", {"progress": 100})
        yield sse_event("complete", {
            "summary": payload.get("summary") or "标的分析完成",
            "report": report,
            "new_recommendations": target_analysis.get("new_recommendations") or [],
            "existing_targets_analysis": target_analysis.get("existing_targets_analysis") or [],
            "filter_diagnostics": diag,
        })

    except Exception as e:
        detail = getattr(e, "detail", None) or str(e)
        yield sse_event("error", {"detail": f"标的分析失败: {detail}"})


def stream_investment_advice(db: Session, asset_scope: str = "all") -> Generator[str, None, None]:
    """SSE generator for investment advice with real streaming."""
    api_key = get_setting(db, "openai_api_key")
    if not api_key:
        yield sse_event("error", {"detail": "请先配置 OpenAI API Key"})
        return

    from ai_service import normalize_openai_base_url
    base_url = normalize_openai_base_url(get_setting(db, "openai_base_url"))
    model = get_setting(db, "openai_model") or "gpt-4o-mini"
    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"
    system_prompt = build_system_prompt(personality, report_style)

    yield sse_event("log", {"message": "正在读取持仓与额度配置...", "tag": "配置"})

    from main import (
        _load_investment_budgets, _investment_budget_status,
        _candidate_investment_targets, _read_providers,
        _latest_today_asset_analysis, _build_investment_advice_prompt,
        _normalize_asset_scope, _asset_scope_label, _filter_assets_by_scope,
    )
    asset_scope = _normalize_asset_scope(asset_scope, "all")
    budgets = _load_investment_budgets(db)
    if not budgets:
        yield sse_event("error", {"detail": "请先在设置页面配置平台投资额度"})
        return

    all_assets = db.query(Asset).all()
    assets = _filter_assets_by_scope(all_assets, asset_scope)
    providers = _read_providers(db)

    yield sse_event("log", {"message": f"已加载 {len(budgets)} 个平台额度配置", "tag": "配置"})
    yield sse_event("log", {"message": f"本次建议范围：{_asset_scope_label(asset_scope)}，持仓候选 {len(assets)} 项", "tag": "配置"})
    yield sse_event("progress", {"progress": 10})

    budget_status = _investment_budget_status(budgets, all_assets)

    yield sse_event("thinking", {"message": "正在并行获取持仓与标的最新行情..."})
    yield sse_event("progress", {"progress": 13})

    asset_items, target_items = _candidate_investment_targets(db, budgets, assets, providers)
    today_analysis = _latest_today_asset_analysis(db, assets)

    yield sse_event("log", {"message": f"候选持仓: {len(asset_items)}, 候选标的: {len(target_items)}", "tag": "配置"})
    yield sse_event("progress", {"progress": 18})

    yield sse_event("thinking", {"message": "AI 正在分析投资策略..."})
    yield sse_event("progress", {"progress": 25})

    from ai_service import openai_error_detail, openai_runtime_summary, parse_ai_json_object, sanitize_ai_payload, strip_model_thinking
    runtime_summary = openai_runtime_summary(api_key, base_url, model)
    client = OpenAI(api_key=api_key, base_url=base_url or None, timeout=300)
    prompt, market_snapshot = _build_investment_advice_prompt(
        system_prompt,
        budget_status,
        asset_items,
        target_items,
        today_analysis,
        asset_scope,
    )
    yield sse_event("progress", {"progress": 30})

    try:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )

        collected = ""
        token_count = 0
        for chunk in response:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                collected += delta.content
                token_count += 1
                if token_count % 20 == 0:
                    preview = collected[-80:].replace('\n', ' ') if len(collected) > 80 else collected.replace('\n', ' ')
                    preview = strip_model_thinking(preview) or "AI 正在生成建议..."
                    yield sse_event("thinking", {"message": f"AI 正在生成建议... {preview}"})
                    p = 25 + min(67, token_count * 0.5)
                    yield sse_event("progress", {"progress": round(p, 1)})

        if not collected.strip():
            yield sse_event("log", {"message": "流式响应内容为空，正在改用非流式请求重试...", "tag": "AI"})
            collected = _retry_non_stream_text(client, model, messages)

        try:
            raw = parse_ai_json_object(collected)
            raw = sanitize_ai_payload(raw)
        except Exception:
            raw = {
                "summary": "AI 返回了非 JSON 投资建议",
                "advice": [],
            }

        from main import _normalize_investment_advice
        diagnostics: list[dict] = []
        result = _normalize_investment_advice(
            raw, budgets, assets, target_items, budget_status, market_snapshot,
            diagnostics=diagnostics,
            asset_scope=asset_scope,
        )

        final_advice = result.get('advice', []) or []
        if not final_advice and diagnostics:
            from collections import Counter
            category_counts = Counter(d["category"] for d in diagnostics)
            reason_counts = Counter(d["reason"] for d in diagnostics)
            raw_count = len(raw.get("advice") or raw.get("recommendations") or [])
            yield sse_event("log", {
                "message": (
                    f"⚠️ AI 返回 {raw_count} 条原始建议，全部被过滤。"
                    f"共丢弃 {len(diagnostics)} 条。"
                ),
                "tag": "建议过滤",
            })
            for cat, cnt in category_counts.most_common():
                yield sse_event("log", {
                    "message": f"  • {cat}: {cnt} 条",
                    "tag": "建议过滤",
                })
            for reason, cnt in reason_counts.most_common(5):
                yield sse_event("log", {
                    "message": f"  · {reason}（{cnt}）",
                    "tag": "建议过滤",
                })
            top_category, top_count = category_counts.most_common(1)[0]
            top_reason, _ = reason_counts.most_common(1)[0]
            result['summary'] = (
                (result.get('summary') or '暂无符合额度和行情约束的投资建议')
                + f"｜过滤统计: 共 {raw_count} 条，被丢弃 {len(diagnostics)} 条；"
                + f"主要原因 {top_category}（{top_count}）: {top_reason}"
            )

        # Save to DB
        from models import InvestmentAdviceRecord
        record = InvestmentAdviceRecord(
            summary=result.get('summary', ''),
            advice_json=json.dumps(result.get('advice', []), ensure_ascii=False, default=str),
            budget_status_json=json.dumps(result.get('budget_status', []), ensure_ascii=False, default=str),
        )
        db.add(record)
        db.commit()

        yield sse_event("log", {
            "message": (
                f"✅ 共生成 {len(result.get('advice', []))} 条交易建议"
                if result.get('advice') else
                "⚠️ 投资建议已生成 0 条，请查看上方过滤原因或检查 AI 输出"
            ),
            "tag": "AI",
        })
        yield sse_event("progress", {"progress": 100})
        yield sse_event("complete", result)

    except Exception as e:
        yield sse_event("error", {"detail": f"投资建议生成失败: {openai_error_detail(e, runtime_summary)}"})


from datetime import datetime
