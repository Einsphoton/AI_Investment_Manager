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


def sse_event(event_type: str, data: dict) -> str:
    """Format an SSE event string."""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _yield(fn):
    """Decorator to make a function yield its return value as SSE."""
    # Not needed, keeping simple
    pass


def get_setting(db: Session, key: str) -> str:
    from ai_service import get_setting as _gs
    return _gs(db, key)


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

    base_url = get_setting(db, "openai_base_url")
    model = get_setting(db, "openai_model") or "gpt-4o-mini"
    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"
    system_prompt = build_system_prompt(personality, report_style)
    client = OpenAI(api_key=api_key, base_url=base_url or None, timeout=90)
    from ai_service import openai_runtime_summary
    runtime_summary = openai_runtime_summary(api_key, base_url, model)

    # Stage 1: Load assets (slow start)
    yield sse_event("log", {"message": f"当前 AI 配置：{runtime_summary}", "tag": "配置"})
    yield sse_event("log", {"message": "正在加载资产数据...", "tag": "加载"})
    assets = db.query(Asset).all()
    yield sse_event("log", {"message": f"已加载 {len(assets)} 项持仓资产", "tag": "加载"})
    yield sse_event("progress", {"progress": 5})

    if not assets:
        yield sse_event("log", {"message": "没有资产需要分析", "tag": "加载"})
        yield sse_event("complete", {"summary": "无资产", "detail": "暂无持仓数据"})
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
{{"summary": "一句话总结", "detail": "Markdown 格式的详细分析报告，使用 ##/### 标题、项目符号、Markdown 表格和 **重点加粗**，不要返回 HTML"}}"""

    # Stage 4: Call OpenAI with streaming
    yield sse_event("log", {"message": "正在调用 AI 模型进行分析...", "tag": "AI"})
    yield sse_event("thinking", {"message": "AI 开始分析投资组合..."})
    yield sse_event("progress", {"progress": 30})

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            stream=True,
        )

        collected = ""
        token_count = 0
        for chunk in response:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                collected += delta.content
                token_count += 1

                if token_count % 20 == 0:
                    # Show real AI content every 20 tokens
                    preview = collected[-80:].replace('\n', ' ') if len(collected) > 80 else collected.replace('\n', ' ')
                    yield sse_event("thinking", {"message": f"AI 正在生成报告... {preview}"})
                    p = 30 + min(62, token_count * 0.5)
                    yield sse_event("progress", {"progress": round(p, 1)})

        # Parse JSON result
        yield sse_event("log", {"message": "AI 响应完成，正在解析结果...", "tag": "AI"})
        yield sse_event("progress", {"progress": 95})

        collected_clean = collected.strip()
        if collected_clean.startswith("```"):
            collected_clean = collected_clean.split("\n", 1)[-1]
            if collected_clean.endswith("```"):
                collected_clean = collected_clean.rsplit("```", 1)[0]
            collected_clean = collected_clean.strip()

        result = json.loads(collected_clean)
        summary = result.get("summary", "分析完成")
        detail = result.get("detail", "")

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
        yield sse_event("error", {"detail": f"AI 分析失败: {str(e)}；当前使用配置：{runtime_summary}"})
        yield sse_event("log", {"message": f"❌ 分析出错: {str(e)}", "tag": "AI"})


def stream_target_analysis(db: Session, markets: list[str] = None, asset_types: list[str] = None) -> Generator[str, None, None]:
    """SSE generator for target AI analysis with real streaming."""
    api_key = get_setting(db, "openai_api_key")
    if not api_key:
        yield sse_event("error", {"detail": "请先配置 OpenAI API Key"})
        return

    base_url = get_setting(db, "openai_base_url")
    model = get_setting(db, "openai_model") or "gpt-4o-mini"
    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"
    system_prompt = build_system_prompt(personality, report_style)
    client = OpenAI(api_key=api_key, base_url=base_url or None)

    yield sse_event("log", {"message": "正在加载标的列表...", "tag": "标的"})
    targets = db.query(Target).filter(Target.status == "active").all()

    if markets:
        targets = [t for t in targets if t.market in markets]
    if asset_types:
        targets = [t for t in targets if t.asset_type in asset_types]

    yield sse_event("log", {"message": f"已加载 {len(targets)} 个活跃标的", "tag": "标的"})
    yield sse_event("progress", {"progress": 10})

    if not targets:
        yield sse_event("complete", {"summary": "暂无活跃标的"})
        return

    # Fetch quotes for all targets in parallel
    yield sse_event("thinking", {"message": "正在并行获取标的最新行情..."})
    from data_source import get_quote
    from main import _read_providers
    from parallel_executor import parallel_map
    providers = _read_providers(db)

    target_data = []
    for t in targets:
        item = {
            "code": t.code, "name": t.name, "market": t.market,
            "asset_type": t.asset_type, "source": t.source,
            "priority": t.priority, "risk_level": t.risk_level,
            "reason": t.reason or "",
        }
        target_data.append(item)

    if target_data:
        def fetch_quote(item):
            try:
                quote = get_quote(item["code"].strip().upper(), item["market"], item["asset_type"], providers)
                if quote:
                    item["current_price"] = quote.get("current_price")
                    item["change_pct"] = quote.get("change_pct")
            except Exception:
                pass
            return item

        results = parallel_map(fetch_quote, target_data, max_workers=5, timeout=15)
        target_data = list(results)

    yield sse_event("progress", {"progress": 28})
    yield sse_event("log", {"message": f"已获取 {len(targets)} 个标的行情", "tag": "标的"})
    yield sse_event("thinking", {"message": "AI 正在分析标的..."})
    yield sse_event("progress", {"progress": 32})

    # Build prompt
    prompt = f"""{system_prompt}

请对以下投资标的进行深度分析，给出关注理由和操作建议。

标的列表：
{json.dumps(target_data, ensure_ascii=False, indent=2)[:8000]}

请返回 JSON：
{{
  "summary": "总体分析结论",
  "targets": [
    {{
      "code": "代码",
      "name": "名称",
      "analysis": "分析结论",
      "suggestion": "买入/卖出/持有",
      "confidence": "高/中/低"
    }}
  ]
}}"""

    yield sse_event("log", {"message": "正在调用 AI 模型分析标的...", "tag": "AI"})
    yield sse_event("progress", {"progress": 35})

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            stream=True,
        )

        collected = ""
        token_count = 0
        for chunk in response:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                collected += delta.content
                token_count += 1
                if token_count % 20 == 0:
                    preview = collected[-80:].replace('\n', ' ') if len(collected) > 80 else collected.replace('\n', ' ')
                    yield sse_event("thinking", {"message": f"AI 正在分析标的... {preview}"})
                    p = 30 + min(62, token_count * 0.5)
                    yield sse_event("progress", {"progress": round(p, 1)})

        collected_clean = collected.strip()
        if collected_clean.startswith("```"):
            collected_clean = collected_clean.split("\n", 1)[-1]
            if collected_clean.endswith("```"):
                collected_clean = collected_clean.rsplit("```", 1)[0]
            collected_clean = collected_clean.strip()

        result = json.loads(collected_clean)

        # Update targets with AI analysis
        for t in targets:
            t.ai_analysis = json.dumps(result, ensure_ascii=False)
            t.last_analyzed_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        db.commit()

        yield sse_event("log", {"message": "✅ 标的分析完成，结果已保存", "tag": "AI"})
        yield sse_event("progress", {"progress": 100})
        yield sse_event("complete", result)

    except Exception as e:
        yield sse_event("error", {"detail": f"标的分析失败: {str(e)}"})


def stream_investment_advice(db: Session) -> Generator[str, None, None]:
    """SSE generator for investment advice with real streaming."""
    api_key = get_setting(db, "openai_api_key")
    if not api_key:
        yield sse_event("error", {"detail": "请先配置 OpenAI API Key"})
        return

    base_url = get_setting(db, "openai_base_url")
    model = get_setting(db, "openai_model") or "gpt-4o-mini"
    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"
    system_prompt = build_system_prompt(personality, report_style)

    yield sse_event("log", {"message": "正在读取持仓与额度配置...", "tag": "配置"})

    from main import (
        _load_investment_budgets, _investment_budget_status,
        _candidate_investment_targets, _read_providers,
        _latest_today_asset_analysis, _build_investment_advice_prompt,
    )
    budgets = _load_investment_budgets(db)
    if not budgets:
        yield sse_event("error", {"detail": "请先在设置页面配置平台投资额度"})
        return

    assets = db.query(Asset).all()
    providers = _read_providers(db)

    yield sse_event("log", {"message": f"已加载 {len(budgets)} 个平台额度配置", "tag": "配置"})
    yield sse_event("progress", {"progress": 10})

    budget_status = _investment_budget_status(budgets, assets)

    yield sse_event("thinking", {"message": "正在并行获取持仓与标的最新行情..."})
    yield sse_event("progress", {"progress": 13})

    asset_items, target_items = _candidate_investment_targets(db, budgets, assets, providers)
    today_analysis = _latest_today_asset_analysis(db, assets)

    yield sse_event("log", {"message": f"候选持仓: {len(asset_items)}, 候选标的: {len(target_items)}", "tag": "配置"})
    yield sse_event("progress", {"progress": 18})

    yield sse_event("thinking", {"message": "AI 正在分析投资策略..."})
    yield sse_event("progress", {"progress": 25})

    client = OpenAI(api_key=api_key, base_url=base_url or None, timeout=120)
    prompt, market_snapshot = _build_investment_advice_prompt(
        system_prompt,
        budget_status,
        asset_items,
        target_items,
        today_analysis,
    )
    yield sse_event("progress", {"progress": 30})

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            stream=True,
        )

        collected = ""
        token_count = 0
        for chunk in response:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                collected += delta.content
                token_count += 1
                if token_count % 20 == 0:
                    preview = collected[-80:].replace('\n', ' ') if len(collected) > 80 else collected.replace('\n', ' ')
                    yield sse_event("thinking", {"message": f"AI 正在生成建议... {preview}"})
                    p = 25 + min(67, token_count * 0.5)
                    yield sse_event("progress", {"progress": round(p, 1)})

        collected_clean = collected.strip()
        if collected_clean.startswith("```"):
            collected_clean = collected_clean.split("\n", 1)[-1]
            if collected_clean.endswith("```"):
                collected_clean = collected_clean.rsplit("```", 1)[0]
            collected_clean = collected_clean.strip()

        raw = json.loads(collected_clean)

        from main import _normalize_investment_advice
        result = _normalize_investment_advice(raw, budgets, assets, target_items, budget_status, market_snapshot)

        # Save to DB
        from models import InvestmentAdviceRecord
        record = InvestmentAdviceRecord(
            summary=result.get('summary', ''),
            advice_json=json.dumps(result.get('advice', []), ensure_ascii=False, default=str),
            budget_status_json=json.dumps(result.get('budget_status', []), ensure_ascii=False, default=str),
        )
        db.add(record)
        db.commit()

        yield sse_event("log", {"message": f"✅ 共生成 {len(result.get('advice', []))} 条交易建议", "tag": "AI"})
        yield sse_event("progress", {"progress": 100})
        yield sse_event("complete", result)

    except Exception as e:
        yield sse_event("error", {"detail": f"投资建议生成失败: {str(e)}"})


from datetime import datetime
