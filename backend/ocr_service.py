from __future__ import annotations

import base64
import json
import re
from typing import Any, Optional

from openai import OpenAI


SYSTEM_PROMPT = """你是一个投资资产截图 OCR 和结构化抽取助手。

你要从券商、银行、基金、支付宝、微信理财通、港美股交易 App 的持仓/资产截图中抽取可录入资产。
截图可能包含中文、英文、港股代码、美股代码、A 股代码、公募基金代码、ETF/LOF、成本价、持仓份额、持仓市值、收益等字段。

请只使用截图中可见信息，不要编造。买入单价优先取“成本价/持仓成本/买入均价/成本净值/平均成本”，不要把“现价/最新价/净值/市值/收益”当成买入单价。
份额优先取“持有份额/持仓数量/可用份额/数量/持有股数”，不要把市值、收益金额、累计收益当成份额。

字段定义：
- asset_type: "stock" | "offshore_fund" | "onshore_fund"
  - 股票含 A 股、港股、美股普通股票。
  - 场内基金/ETF/LOF 用 onshore_fund。
  - 银行、支付宝、天天基金等平台持有的场外基金用 offshore_fund。
- market: "A" | "HK" | "US"。如果无法判断则留空。
- platform: 购买平台/券商/银行名称。无法判断留空。
- code: 股票/基金代码。A 股和基金通常 6 位，港股通常 5 位，美股通常字母代码。
- name: 资产名称。
- shares: 持有份额/数量，数字；看不清则 null。
- buy_price: 买入单价/成本价，数字；看不清则 null。
- buy_date: 买入日期 YYYY-MM-DD；截图没有则空字符串。
- confidence: 0 到 1，表示该条记录整体可信度。
- warnings: 中文字符串数组，说明哪些字段需要人工复核。
- evidence: 简短说明你从截图哪些文字判断出来。

输出必须是严格 JSON，不要 Markdown，不要解释文字：
{
  "assets": [
    {
      "asset_type": "stock",
      "market": "A",
      "platform": "招商证券",
      "code": "000001",
      "name": "平安银行",
      "shares": 100,
      "buy_price": 10.5,
      "buy_date": "",
      "confidence": 0.86,
      "warnings": [],
      "evidence": "持仓数量 100，成本价 10.50"
    }
  ],
  "image_notes": "可选：整体截图质量、遮挡、字段缺失说明"
}
"""

REPAIR_PROMPT = """请把下面模型输出修复为严格 JSON。
只能输出 JSON，格式为 {"assets": [...], "image_notes": "..."}。
不要补充截图里没有的信息；无法确认的字段保留为空字符串或 null。
"""

VALID_ASSET_TYPES = {"stock", "offshore_fund", "onshore_fund"}
VALID_MARKETS = {"A", "HK", "US"}
IMAGE_EXTENSIONS = {
    "jpg": "jpeg",
    "jpeg": "jpeg",
    "png": "png",
    "webp": "webp",
}


def _get_llm_config(db_session) -> dict:
    from ai_service import get_setting, normalize_openai_base_url

    use_same = get_setting(db_session, "ocr_use_same_as_ai") != "false"
    if use_same:
        api_key = get_setting(db_session, "openai_api_key")
        base_url = get_setting(db_session, "openai_base_url")
        model = get_setting(db_session, "openai_model") or "gpt-4o-mini"
    else:
        api_key = get_setting(db_session, "ocr_api_key") or get_setting(
            db_session, "openai_api_key"
        )
        base_url = get_setting(db_session, "ocr_base_url") or get_setting(
            db_session, "openai_base_url"
        )
        model = get_setting(db_session, "ocr_model") or "gpt-4o-mini"
    return {"api_key": api_key, "base_url": normalize_openai_base_url(base_url) or "", "model": model}


def _build_messages(data_url: str, filename: str, use_detail: bool) -> list[dict[str, Any]]:
    image_url: dict[str, Any] = {"url": data_url}
    if use_detail:
        image_url["detail"] = "high"

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"请识别文件 {filename} 中所有可录入的投资资产持仓。"
                        "如果同一截图中有多只资产，请逐条返回。"
                        "请特别区分成本价、现价、市值、收益和份额。"
                    ),
                },
                {"type": "image_url", "image_url": image_url},
            ],
        },
    ]


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or ""))
            else:
                parts.append(str(item))
        return "\n".join(p for p in parts if p)
    return str(content or "")


def _chat(client: OpenAI, **kwargs) -> str:
    response = client.chat.completions.create(**kwargs)
    return _message_text(response.choices[0].message.content)


def _try_vision(client: OpenAI, model: str, data_url: str, filename: str) -> str:
    strategies = [
        {"response_format": {"type": "json_object"}, "use_detail": True},
        {"response_format": {"type": "json_object"}, "use_detail": False},
        {"use_detail": True},
        {"use_detail": False},
    ]

    errors = []
    for strategy in strategies:
        use_detail = bool(strategy.pop("use_detail"))
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": _build_messages(data_url, filename, use_detail),
            "max_tokens": 4096,
        }
        kwargs.update(strategy)
        try:
            content = _chat(client, **kwargs)
            if content.strip():
                return content
            errors.append("模型返回空内容")
        except Exception as e:
            errors.append(str(e))

    raise RuntimeError("\n".join(errors[-2:]) or "模型调用失败")


def _repair_json(client: OpenAI, model: str, content: str) -> str:
    return _chat(
        client,
        model=model,
        messages=[
            {"role": "system", "content": REPAIR_PROMPT},
            {"role": "user", "content": content[:12000]},
        ],
        response_format={"type": "json_object"},
        max_tokens=4096,
    )


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?", "", stripped, flags=re.IGNORECASE).strip()
        stripped = re.sub(r"```$", "", stripped).strip()
    return stripped


def _loads_json(text: str) -> Any:
    text = _strip_code_fence(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for match in re.finditer(r"[\{\[]", text):
        try:
            obj, _ = decoder.raw_decode(text[match.start():])
            return obj
        except json.JSONDecodeError:
            continue
    raise ValueError("模型返回内容不是可解析的 JSON")


def _parse_result(content: str, client: OpenAI, model: str) -> dict[str, Any]:
    try:
        parsed = _loads_json(content)
    except ValueError:
        repaired = _repair_json(client, model, content)
        parsed = _loads_json(repaired)

    if isinstance(parsed, list):
        return {"assets": parsed, "image_notes": ""}
    if not isinstance(parsed, dict):
        raise ValueError("模型返回 JSON 顶层不是对象")
    if "assets" not in parsed:
        parsed["assets"] = []
    return parsed


def _to_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_number(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    if not text or text in {"-", "--", "N/A", "null", "None"}:
        return None
    multiplier = 10000 if "万" in text else 1
    text = (
        text.replace(",", "")
        .replace("，", "")
        .replace("￥", "")
        .replace("¥", "")
        .replace("$", "")
        .replace("HKD", "")
        .replace("USD", "")
        .replace("RMB", "")
    )
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0)) * multiplier
    except ValueError:
        return None


def _normalize_code(code: Any, market: str) -> str:
    text = _to_str(code).upper()
    if not text:
        return ""

    text = re.sub(r"\s+", "", text)
    text = text.replace("：", ":")
    text = re.sub(r"^(SH|SZ|HK|US|NASDAQ|NYSE)[:\.-]?", "", text)
    text = re.sub(r"\.(SH|SZ|HK|US|NASDAQ|NYSE)$", "", text)

    if market == "HK":
        digits = re.sub(r"\D", "", text)
        if digits:
            return digits.zfill(5)
    if market == "A":
        match = re.search(r"\d{6}", text)
        if match:
            return match.group(0)
    if re.fullmatch(r"[A-Z]{1,6}(?:\.[A-Z])?", text):
        return text
    return text


def _infer_market(code: str, raw_market: str) -> str:
    market = raw_market.upper().strip()
    mapping = {
        "A股": "A",
        "沪深": "A",
        "CN": "A",
        "CHINA": "A",
        "港股": "HK",
        "HKG": "HK",
        "US": "US",
        "美股": "US",
        "NASDAQ": "US",
        "NYSE": "US",
    }
    market = mapping.get(market, market)
    if market in VALID_MARKETS:
        return market
    if re.fullmatch(r"\d{6}", code):
        return "A"
    if re.fullmatch(r"\d{5}", code):
        return "HK"
    if re.fullmatch(r"[A-Z]{1,6}(?:\.[A-Z])?", code):
        return "US"
    return ""


def _infer_asset_type(asset_type: str, market: str, code: str, name: str, platform: str) -> str:
    normalized = asset_type.strip()
    aliases = {
        "fund": "offshore_fund",
        "mutual_fund": "offshore_fund",
        "基金": "offshore_fund",
        "场外基金": "offshore_fund",
        "场内基金": "onshore_fund",
        "etf": "onshore_fund",
        "lof": "onshore_fund",
        "stock": "stock",
        "股票": "stock",
    }
    normalized = aliases.get(normalized.lower(), aliases.get(normalized, normalized))
    if normalized in VALID_ASSET_TYPES:
        return normalized

    text = f"{name} {platform}".lower()
    looks_like_fund = any(
        token in text
        for token in ["基金", "etf", "lof", "qdii", "联接", "指数", "混合", "债券", "货币"]
    )
    if looks_like_fund:
        if market == "A" and (code.startswith(("1", "5")) or "etf" in text or "lof" in text):
            return "onshore_fund"
        return "offshore_fund"
    return "stock"


def _confidence(asset: dict[str, Any], warnings: list[str]) -> float:
    raw = _normalize_number(asset.get("confidence"))
    if raw is not None and raw > 0:
        return max(0.0, min(1.0, raw))

    score = 0.25
    for field, weight in [
        ("code", 0.18),
        ("name", 0.16),
        ("shares", 0.2),
        ("buy_price", 0.2),
        ("market", 0.08),
        ("asset_type", 0.08),
    ]:
        if asset.get(field) not in (None, ""):
            score += weight
    score -= min(0.25, len(warnings) * 0.06)
    return round(max(0.0, min(0.98, score)), 2)


def _normalize_asset(raw: Any, filename: str) -> dict[str, Any]:
    asset = raw if isinstance(raw, dict) else {}

    platform = _to_str(asset.get("platform"))
    name = _to_str(asset.get("name"))
    raw_market = _to_str(asset.get("market"))
    code = _normalize_code(asset.get("code"), raw_market.upper())
    market = _infer_market(code, raw_market)
    code = _normalize_code(code, market)
    asset_type = _infer_asset_type(_to_str(asset.get("asset_type")), market, code, name, platform)
    shares = _normalize_number(asset.get("shares"))
    buy_price = _normalize_number(asset.get("buy_price"))
    buy_date = _to_str(asset.get("buy_date"))

    warnings = []
    for warning in asset.get("warnings") or []:
        warning_text = _to_str(warning)
        if warning_text:
            warnings.append(warning_text)

    if not code:
        warnings.append("缺少代码")
    if not name:
        warnings.append("缺少名称")
    if shares is None:
        warnings.append("缺少持有份额")
    if buy_price is None:
        warnings.append("缺少买入单价/成本价")
    if not market:
        warnings.append("缺少市场")
    if not platform:
        warnings.append("缺少购买平台")
    if buy_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", buy_date):
        warnings.append("买入日期格式需要复核")

    normalized = {
        "asset_type": asset_type,
        "market": market,
        "platform": platform,
        "code": code,
        "name": name,
        "shares": shares,
        "buy_price": buy_price,
        "buy_date": buy_date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", buy_date) else "",
        "confidence": 0.0,
        "warnings": list(dict.fromkeys(warnings)),
        "evidence": _to_str(asset.get("evidence")),
        "source_filename": filename,
        "status": "ready",
    }
    confidence_input = {**normalized, "confidence": asset.get("confidence")}
    normalized["confidence"] = _confidence(confidence_input, normalized["warnings"])
    if not normalized["code"] or not normalized["name"]:
        normalized["status"] = "invalid"
    elif normalized["shares"] is None or normalized["buy_price"] is None:
        normalized["status"] = "review"
    elif normalized["warnings"] or normalized["confidence"] < 0.72:
        normalized["status"] = "review"
    return normalized


def _image_data_url(image_bytes: bytes, filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    mime_ext = IMAGE_EXTENSIONS.get(ext, "png")
    base64_image = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:image/{mime_ext};base64,{base64_image}"


def _friendly_api_error(err: str, model: str, status: int) -> str:
    if status == 401:
        return (
            f"API 认证失败：{err}\n\n"
            "请检查设置页中的 API Key 和 Base URL 是否正确，并确保该账户有当前模型的访问权限。"
        )

    lower = err.lower()
    hints = []
    if any(token in lower for token in ["image", "vision", "multimodal", "modal"]):
        hints.append(
            f"当前模型 '{model}' 可能不支持图片输入，或该服务商的 OpenAI 兼容接口没有开放 Vision 能力。"
        )
    if "response_format" in lower or "json_object" in lower:
        hints.append("该服务商可能不支持 JSON mode；系统已尝试关闭 JSON mode 后重试。")
    if "base64" in lower or "data:" in lower:
        hints.append("该服务商可能不支持 data URL 图片输入，请确认接口文档是否支持 base64 image_url。")
    if not hints:
        hints.append("请确认 API Key、Base URL、模型名、图片大小，以及该模型是否支持视觉输入。")
    return f"OCR 识别失败：{err}\n\n" + "\n".join(f"- {hint}" for hint in hints)


def parse_image(image_bytes: bytes, filename: str, db_session) -> list[dict[str, Any]]:
    cfg = _get_llm_config(db_session)
    if not cfg["api_key"]:
        raise ValueError("OCR API Key 未配置，请在设置页面中配置")
    if not image_bytes:
        raise ValueError("上传的图片为空")
    if len(image_bytes) > 12 * 1024 * 1024:
        raise ValueError("图片过大，请裁剪或压缩到 12MB 以内后重试")

    data_url = _image_data_url(image_bytes, filename)
    client = OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"] or None, timeout=120)

    try:
        content = _try_vision(client, cfg["model"], data_url, filename)
        result = _parse_result(content, client, cfg["model"])
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(
            _friendly_api_error(str(e), cfg["model"], getattr(e, "status_code", 0))
        )

    assets = result.get("assets") or []
    if not isinstance(assets, list):
        raise ValueError("模型返回的 assets 字段不是数组")

    return [_normalize_asset(asset, filename) for asset in assets]
