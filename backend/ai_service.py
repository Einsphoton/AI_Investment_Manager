from __future__ import annotations

import json
import hashlib
import re
from openai import OpenAI
from fastapi import HTTPException
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


def safe_key_fingerprint(api_key: str) -> dict:
    value = api_key or ""
    return {
        "length": len(value),
        "prefix": value[:6],
        "suffix": value[-4:] if value else "",
        "sha12": hashlib.sha256(value.encode()).hexdigest()[:12] if value else "",
    }


def openai_runtime_summary(api_key: str, base_url: str, model: str) -> str:
    fp = safe_key_fingerprint(api_key)
    key_label = f"{fp['prefix']}...{fp['suffix']} len={fp['length']} sha12={fp['sha12']}" if fp["length"] else "未配置"
    return f"base_url={normalize_openai_base_url(base_url) or 'https://api.openai.com/v1'}, model={model}, key={key_label}"


def normalize_openai_base_url(base_url: str | None) -> str | None:
    """Normalize user-entered OpenAI-compatible API roots.

    The OpenAI SDK expects a base API root, not the full chat/completions path.
    In deployments it is easy to copy a provider URL with an endpoint suffix,
    which commonly turns into a confusing 404 during analysis.
    """
    url = (base_url or "").strip()
    if not url:
        return None

    url = url.rstrip("/")
    for suffix in ("/chat/completions", "/completions", "/responses", "/models"):
        if url.endswith(suffix):
            url = url[: -len(suffix)].rstrip("/")
            break

    if "api.openai.com" in url and not re.search(r"/v\d+$", url):
        url = f"{url}/v1"

    return url


def openai_error_detail(exc: Exception, runtime_summary: str) -> str:
    message = str(exc)
    hint = ""
    if "404" in message or "Not Found" in message:
        hint = (
            "；提示：404 通常表示 Base URL 或模型名不匹配。请在设置页确认 Base URL 是服务商的 "
            "OpenAI 兼容 API 根路径，例如 https://api.openai.com/v1，而不是网页地址或完整的 "
            "/chat/completions 路径"
        )
    return f"{message}{hint}；当前使用配置：{runtime_summary}"


_THINK_BLOCK_RE = re.compile(r"<think\b[^>]*>.*?</think>", re.IGNORECASE | re.DOTALL)
_THINK_TAG_RE = re.compile(r"</?think\b[^>]*>", re.IGNORECASE)
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_REASONING_HINT_RE = re.compile(
    r"\b(the user|user wants|let me|we need|portfolio overview|mutual funds?|etfs?|"
    r"analy[sz]e|analysis|thinking|reasoning)\b",
    re.IGNORECASE,
)


def strip_model_thinking(content: str) -> str:
    """Remove model reasoning tags and obvious leading chain-of-thought prose."""
    text = str(content or "")
    if not text:
        return ""
    lower_text = text.lower()
    has_unclosed_think = "<think" in lower_text and "</think" not in lower_text

    for _ in range(4):
        cleaned = _THINK_BLOCK_RE.sub("", text)
        if cleaned == text:
            break
        text = cleaned
    text = _THINK_TAG_RE.sub("", text)
    text = text.lstrip()
    if has_unclosed_think and _REASONING_HINT_RE.search(text[:1000]):
        answer_marker = re.search(r"(?:^|\n)#{1,4}\s*[\u4e00-\u9fff]", text)
        if answer_marker:
            text = text[answer_marker.start():].lstrip()
        else:
            return ""
    if text.startswith(("{", "[")):
        return text.strip()

    lines = text.splitlines()
    while lines and not _CJK_RE.search(lines[0]) and _REASONING_HINT_RE.search(lines[0]):
        lines.pop(0)
    text = "\n".join(lines).lstrip()

    first_cjk = _CJK_RE.search(text)
    if first_cjk and first_cjk.start() > 20:
        prefix = text[:first_cjk.start()]
        if _REASONING_HINT_RE.search(prefix):
            text = text[first_cjk.start():].lstrip()

    return text.strip()


def sanitize_ai_payload(value):
    if isinstance(value, str):
        return strip_model_thinking(value)
    if isinstance(value, list):
        return [sanitize_ai_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_ai_payload(item) for key, item in value.items()}
    return value


def coerce_ai_report_fields(summary: str, detail: str = "") -> tuple[str, str]:
    """Unwrap reports that were saved as a fenced/full JSON blob."""
    cleaned_summary = strip_model_thinking(summary or "")
    cleaned_detail = strip_model_thinking(detail or "")

    for candidate in (cleaned_summary, cleaned_detail):
        if not candidate or ("{" not in candidate and "```" not in candidate):
            continue
        try:
            parsed = sanitize_ai_payload(parse_ai_json_object(candidate))
        except Exception:
            continue
        if not isinstance(parsed, dict):
            continue

        nested_summary = strip_model_thinking(parsed.get("summary") or "")
        nested_detail = strip_model_thinking(parsed.get("detail") or "")
        if nested_summary or nested_detail:
            return nested_summary or cleaned_summary, nested_detail or cleaned_detail

    return cleaned_summary, cleaned_detail


def parse_ai_json_object(content: str) -> dict:
    text = strip_model_thinking(content)
    if not text:
        raise ValueError("模型返回空内容")

    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()
    if text.lower().startswith("json\n"):
        text = text.split("\n", 1)[-1].strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


def text_report_fallback(content: str, default_summary: str = "AI 分析完成") -> dict:
    text = strip_model_thinking(content)
    if not text:
        text = "模型未返回可解析内容。请检查当前模型是否支持 Chat Completions、streaming，以及是否会按提示返回 JSON。"
    first_line = next((line.strip("#* -") for line in text.splitlines() if line.strip()), "")
    summary = first_line[:80] if first_line else default_summary
    return {"summary": summary or default_summary, "detail": text}


def run_ai_analysis(db: Session) -> AnalysisRecord:
    api_key = get_setting(db, "openai_api_key")
    base_url = normalize_openai_base_url(get_setting(db, "openai_base_url"))
    model = get_setting(db, "openai_model") or "gpt-4o-mini"
    personality = get_setting(db, "ai_personality") or "balanced"
    report_style = get_setting(db, "ai_report_style") or "professional"

    if not api_key:
        raise HTTPException(status_code=400, detail="请先在设置页面配置 OpenAI API Key")

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
  "detail": "Markdown 格式的详细分析报告（使用 ##/### 标题、项目符号、Markdown 表格和 **重点加粗**；包括市场回顾、各资产表现（引用真实PE/PB）、风险提示和操作建议，200-500字）"
}}

重要约束：
- 所有用户可见内容必须使用中文。
- 不要输出英文推理、内部思考过程、<think> 标签或 reasoning 内容。
- 最终回复只能是 JSON 对象，不要在 JSON 前后添加任何解释。"""

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
        try:
            result = parse_ai_json_object(content)
        except Exception:
            result = text_report_fallback(content, "AI 返回了非 JSON 报告")
        result = sanitize_ai_payload(result)
        summary, detail = coerce_ai_report_fields(result.get("summary", "分析完成"), result.get("detail", ""))
        summary = summary or "分析完成"
    except Exception as e:
        runtime = openai_runtime_summary(api_key, base_url, model)
        raise HTTPException(status_code=502, detail=f"AI 分析失败: {openai_error_detail(e, runtime)}")

    record = AnalysisRecord(
        summary=summary, detail=detail,
        total_market_value=total_market_value, total_cost=total_cost,
        total_pnl=total_pnl, total_pnl_percent=total_pnl_percent, realized_pnl=0,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
