from __future__ import annotations

import html
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from threading import RLock
from typing import Optional

import requests

from data_source import parse_float, parse_chinese_amount

EASTMONEY_A_IPO = "eastmoney_a_ipo"
EASTMONEY_HK_IPO = "eastmoney_hk_ipo"
AASTOCKS_HK_IPO = "aastocks_hk_ipo"
NASDAQ_IPO = "nasdaq_ipo"
STOCKANALYSIS_IPO = "stockanalysis_ipo"

IPO_PROVIDER_LABELS = {
    EASTMONEY_A_IPO: "东方财富新股中心",
    EASTMONEY_HK_IPO: "东方财富港股新股（旧接口）",
    AASTOCKS_HK_IPO: "AAStocks 港股新股",
    NASDAQ_IPO: "Nasdaq IPO Calendar",
    STOCKANALYSIS_IPO: "StockAnalysis IPO Calendar",
}

IPO_PROVIDER_OPTIONS = {
    "A": [EASTMONEY_A_IPO],
    "HK": [AASTOCKS_HK_IPO],
    "US": [NASDAQ_IPO, STOCKANALYSIS_IPO],
}

DEFAULT_IPO_PROVIDERS = {
    "A": EASTMONEY_A_IPO,
    "HK": AASTOCKS_HK_IPO,
    "US": NASDAQ_IPO,
}

IPO_SOURCE_NOTES = {
    EASTMONEY_A_IPO: "东方财富新股中心聚合沪深北交易所披露的新股申购、发行价、发行市盈率、中签及上市安排。",
    EASTMONEY_HK_IPO: "东方财富港股新股旧报表接口已多次返回报表配置不存在，仅保留为历史兼容源。",
    AASTOCKS_HK_IPO: "AAStocks 港股 IPO 页面聚合港交所新股招股、上市日期、招股价和每手股数等信息；若页面反爬、连接超时或无近期招股记录，会返回明确状态。",
    NASDAQ_IPO: "Nasdaq 官方 IPO Calendar 覆盖美国市场 upcoming/priced IPO 信息。",
    STOCKANALYSIS_IPO: "StockAnalysis IPO Calendar 提供美国 IPO 日历、拟上市代码、公司名称和招股价区间。",
}

_CACHE_MISS = object()
_CACHE_LOCK = RLock()
_CACHE: dict[tuple, tuple[float, object]] = {}


def _clone(value):
    if isinstance(value, list):
        return [dict(item) if isinstance(item, dict) else item for item in value]
    if isinstance(value, dict):
        cloned = {}
        for key, item in value.items():
            if isinstance(item, list):
                cloned[key] = [dict(row) if isinstance(row, dict) else row for row in item]
            elif isinstance(item, dict):
                cloned[key] = dict(item)
            else:
                cloned[key] = item
        return cloned
    return value


def _cache_get(key: tuple, ttl: int):
    now = time.time()
    with _CACHE_LOCK:
        item = _CACHE.get(key)
        if not item:
            return _CACHE_MISS
        ts, value = item
        if now - ts > ttl:
            _CACHE.pop(key, None)
            return _CACHE_MISS
        return _clone(value)


def _cache_set(key: tuple, value):
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), _clone(value))
        if len(_CACHE) > 120:
            oldest = sorted(_CACHE.items(), key=lambda item: item[1][0])[:30]
            for old_key, _ in oldest:
                _CACHE.pop(old_key, None)
    return _clone(value)


def _date_only(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text or text in {"-", "--", "None", "null"}:
        return ""
    normalized = text[:10].replace("/", "-")
    if re.match(r"^\d{4}-\d{1,2}-\d{1,2}$", normalized):
        parts = normalized.split("-")
        return f"{int(parts[0]):04d}-{int(parts[1]):02d}-{int(parts[2]):02d}"
    try:
        from dateutil import parser
        return parser.parse(text, fuzzy=True).date().isoformat()
    except Exception:
        return ""


def _num(value) -> Optional[float]:
    if value in ("", "-", "--", None):
        return None
    if isinstance(value, str) and any(unit in value for unit in ("万", "亿")):
        return parse_chinese_amount(value)
    return parse_float(str(value).replace(",", "").replace("$", "").replace("HK$", "").strip())


def _safe_text(value) -> str:
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


class IPODataUnavailable(Exception):
    pass


def _friendly_source_error(market: str, exc: Exception) -> str:
    raw = str(exc)
    if isinstance(exc, IPODataUnavailable):
        return raw
    if "NameResolutionError" in raw or "Failed to resolve" in raw:
        return f"{market} 新股数据源域名解析失败，请检查网络或稍后刷新"
    if "timed out" in raw or "Read timed out" in raw or "Connection timed out" in raw:
        return f"{market} 新股数据源连接超时，请稍后刷新"
    if "报表配置不存在" in raw:
        return f"{market} 新股数据源接口已调整，当前自动降级源暂未取到数据"
    return f"{market} 新股数据源暂不可用，请稍后刷新"


def _extract_objects_with_keys(text: str, required_keys: set[str], limit: int = 80) -> list[dict]:
    decoder = json.JSONDecoder()
    rows: list[dict] = []
    idx = 0
    while idx < len(text) and len(rows) < limit:
        start = text.find("{", idx)
        if start < 0:
            break
        try:
            obj, end = decoder.raw_decode(text[start:])
        except Exception:
            idx = start + 1
            continue
        idx = start + max(end, 1)
        if isinstance(obj, dict) and required_keys.intersection(obj.keys()):
            rows.append(obj)
    return rows


def _comment_sentiment(text: str) -> str:
    if any(word in text for word in ("破发", "坑", "不买", "不要中", "亏", "太贵", "高价", "风险")):
        return "negative"
    if any(word in text for word in ("大肉", "中签", "看好", "保佑", "求中", "能赚", "上涨", "目标价")):
        return "positive"
    return "neutral"


def _fetch_eastmoney_guba_comments(code: str, limit: int = 6) -> list[dict]:
    code = _safe_text(code)
    if not code:
        return []
    try:
        resp = requests.get(
            f"https://guba.eastmoney.com/list,{code}.html",
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
            timeout=6,
        )
        match = re.search(r"var\s+article_list\s*=\s*(\{.*?\});\s*var\s+other_list", resp.text, re.S)
        if not match:
            return []
        data = json.loads(match.group(1))
        rows = data.get("re") or []
        comments = []
        seen = set()
        for row in rows:
            title = _safe_text(row.get("post_title"))
            if not title or title in seen:
                continue
            seen.add(title)
            comments.append({
                "source": "eastmoney_guba",
                "author": _safe_text((row.get("post_user") or {}).get("user_nickname") or row.get("user_nickname") or "股吧用户"),
                "content": title[:160],
                "sentiment": _comment_sentiment(title),
                "heat": int(_num(row.get("post_click_count")) or 0),
                "reply_count": int(_num(row.get("post_comment_count")) or 0),
                "published_at": _safe_text(row.get("post_publish_time") or row.get("post_display_time")),
            })
            if len(comments) >= limit:
                break
        return comments
    except Exception:
        return []


def _eastmoney_get(report_name: str, *, page_size: int = 40, sort_columns: str = "", sort_types: str = "") -> dict:
    params = {
        "reportName": report_name,
        "columns": "ALL",
        "pageNumber": 1,
        "pageSize": page_size,
    }
    if sort_columns:
        params["sortColumns"] = sort_columns
    if sort_types:
        params["sortTypes"] = sort_types
    resp = requests.get(
        "https://datacenter-web.eastmoney.com/api/data/v1/get",
        params=params,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Referer": "https://datacenter.eastmoney.com/",
        },
        timeout=12,
    )
    data = resp.json()
    if not data.get("success"):
        raise ValueError(data.get("message") or f"东方财富接口返回异常: {report_name}")
    return data.get("result") or {}


def _status_from_dates(apply_date: str, listing_date: str, raw_status: str = "") -> str:
    today = datetime.now().date()
    raw = _safe_text(raw_status).lower()
    apply_dt = None
    listing_dt = None
    try:
        if apply_date:
            apply_dt = datetime.fromisoformat(apply_date).date()
    except ValueError:
        pass
    try:
        if listing_date:
            listing_dt = datetime.fromisoformat(listing_date).date()
    except ValueError:
        pass
    if listing_dt and listing_dt <= today:
        return "listed"
    if any(word in raw for word in ("listed", "已上市", "上市首日")):
        return "listed"
    if any(word in raw for word in ("申购中", "认购中", "招股中", "subscription", "subscrib")):
        return "subscribing"
    if apply_dt and apply_dt > today:
        return "upcoming"
    if apply_dt and apply_dt == today:
        return "subscribing"
    if apply_dt and apply_dt < today:
        return "pending_listing"
    if listing_dt and listing_dt > today:
        return "upcoming"
    if raw_status:
        return raw_status
    return "upcoming"


def _parse_date(value):
    text = _date_only(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def _a_ipo_status(row: dict, apply_date: str, listing_date: str) -> str:
    today = datetime.now().date()
    raw_status = _safe_text(
        row.get("CONTINUOUS_1WORD_NUM")
        or row.get("CONTINUOUS_N1WORD_NUM")
        or row.get("ISSUE_STATE")
    )
    raw_lower = raw_status.lower()
    apply_dt = _parse_date(apply_date)
    listing_dt = _parse_date(listing_date)
    if listing_dt and listing_dt <= today:
        return "listed"
    if any(word in raw_lower for word in ("已上市", "上市首日", "listed")):
        return "listed"
    if apply_dt and apply_dt > today:
        return "upcoming"

    active_dates = [
        _parse_date(row.get(key))
        for key in (
            "ONLINE_PAY_DATE", "BALLOT_PAY_DATE", "BALLOT_NUM_DATE",
            "RESULT_NOTICE_DATE", "ASSIGN_DATE", "START_DATE",
        )
    ]
    latest_active_dt = max([dt for dt in active_dates if dt], default=None)
    if apply_dt and apply_dt <= today and latest_active_dt and latest_active_dt >= today:
        return "subscribing"
    if apply_dt and apply_dt == today:
        return "subscribing"
    if any(word in raw_status for word in ("申购", "缴款", "中签")) and not listing_dt:
        return "subscribing"
    if listing_dt and listing_dt > today:
        return "pending_listing"
    if apply_dt and apply_dt < today:
        return "pending_listing"
    return _status_from_dates(apply_date, listing_date, raw_status)


def _is_open_for_subscription(item: dict) -> bool:
    status = str(item.get("status") or "")
    if status == "listed":
        return False
    apply_date = _date_only(item.get("apply_date"))
    listing_date = _date_only(item.get("listing_date"))
    today = datetime.now().date()
    try:
        if listing_date and datetime.fromisoformat(listing_date).date() <= today:
            return False
    except ValueError:
        pass
    return status in {"upcoming", "subscribing"}


def _filter_open_ipos(items: list[dict]) -> list[dict]:
    return [item for item in items if _is_open_for_subscription(item)]


def _mark_ipo_source(item: dict, provider: str, source_url: str) -> dict:
    item["source"] = provider
    item["source_label"] = IPO_PROVIDER_LABELS.get(provider, provider)
    item["source_url"] = source_url
    return item


def _normalize_a_ipo(row: dict) -> dict:
    issue_price = _num(row.get("ISSUE_PRICE") or row.get("TNEW_PRICE") or row.get("PREDICT_ISSUE_PRICE"))
    online_upper = _num(row.get("ONLINE_APPLY_UPPER") or row.get("PREDICT_ONAPPLY_UPPER"))
    issue_pe = _num(row.get("AFTER_ISSUE_PE") or row.get("PREDICT_PE_THREE") or row.get("PREDICT_ISSUE_PE"))
    industry_pe = _num(row.get("INDUSTRY_PE_NEW") or row.get("INDUSTRY_PE"))
    apply_date = _date_only(row.get("APPLY_DATE") or row.get("ONLINE_ISSUE_DATE"))
    listing_date = _date_only(row.get("LISTING_DATE") or row.get("SELECT_LISTING_DATE"))
    code = _safe_text(row.get("SECURITY_CODE") or row.get("APPLY_CODE") or row.get("SECUCODE"))
    name = _safe_text(row.get("SECURITY_NAME_ABBR") or row.get("SECURITY_NAME") or row.get("SECURITY_NAME_FULL") or code)
    return {
        "id": f"A:{code}:{apply_date}",
        "market": "A",
        "code": code,
        "apply_code": _safe_text(row.get("APPLY_CODE") or code),
        "name": name,
        "company_name": _safe_text(row.get("SECURITY_NAME_FULL") or name),
        "exchange": _safe_text(row.get("MARKET") or row.get("MARKET_TYPE_NEW") or row.get("TRADE_MARKET")),
        "sector": _safe_text(row.get("INDUSTRY_NAME") or row.get("MARKET_TYPE_NEW")),
        "business": _safe_text(row.get("MAIN_BUSINESS")),
        "apply_date": apply_date,
        "listing_date": listing_date,
        "pricing_date": _date_only(row.get("ONLINE_PAY_DATE") or row.get("BALLOT_PAY_DATE")),
        "issue_price": issue_price,
        "price_range": "",
        "currency": "CNY",
        "issue_pe": issue_pe,
        "industry_pe": industry_pe,
        "issue_size": _num(row.get("TOTAL_ISSUE_NUM") or row.get("ISSUE_NUM")),
        "fundraising_amount": _num(row.get("TOTAL_RAISE_FUNDS") or row.get("DEC_SUMFINA") or row.get("PREDICT_RAISE_FUNDS")),
        "online_apply_limit": online_upper,
        "estimated_required_cash": (issue_price * online_upper) if issue_price and online_upper else _num(row.get("ONLINE_FUND_UPPER") or row.get("PREDICT_ONFUND_UPPER")),
        "lot_size": _num(row.get("EACHBALLOT_SHARES")) or 500,
        "subscription_multiple": _num(row.get("INITIAL_MULTIPLE") or row.get("OFFFLINE_INITIAL_MULTIPLE")),
        "winning_rate": _num(row.get("BALLOT_NUM")),
        "sponsor": _safe_text(row.get("RECOMMEND_ORG") or row.get("UNDERWRITER_ORG")),
        "raw_status": _safe_text(row.get("CONTINUOUS_1WORD_NUM") or row.get("ISSUE_STATE")),
        "status": _a_ipo_status(row, apply_date, listing_date),
        "source": EASTMONEY_A_IPO,
        "source_label": IPO_PROVIDER_LABELS[EASTMONEY_A_IPO],
        "source_url": "https://data.eastmoney.com/xg/xg/default.html",
        "updated_at": _date_only(row.get("UP_DATE")) or datetime.now().strftime("%Y-%m-%d"),
        "comments": [],
    }


def _fetch_a_ipos(limit: int) -> list[dict]:
    result = _eastmoney_get(
        "RPTA_APP_IPOAPPLY",
        page_size=max(limit, 20),
        sort_columns="APPLY_DATE",
        sort_types="-1",
    )
    rows = result.get("data") or []
    items = [_normalize_a_ipo(row) for row in rows if isinstance(row, dict)]
    return _filter_open_ipos(items)[:limit]


def _extract_json_from_html(text: str):
    for pattern in (
        r"window\.__INITIAL_STATE__\s*=\s*({.*?})\s*</script>",
        r"window\.__NUXT__\s*=\s*({.*?})\s*</script>",
        r"<script[^>]+id=\"__NEXT_DATA__\"[^>]*>(.*?)</script>",
    ):
        m = re.search(pattern, text, re.S)
        if not m:
            continue
        try:
            return json.loads(m.group(1))
        except Exception:
            continue
    return None


def _normalize_hk_ipo(row: dict) -> dict:
    code = _safe_text(
        row.get("SECURITY_CODE")
        or row.get("SECUCODE")
        or row.get("stockCode")
        or row.get("code")
        or row.get("symbol")
    ).replace(".HK", "")
    name = _safe_text(
        row.get("SECURITY_NAME")
        or row.get("SECURITY_NAME_ABBR")
        or row.get("stockName")
        or row.get("name")
        or code
    )
    apply_date = _date_only(
        row.get("APPLY_DATE")
        or row.get("START_DATE")
        or row.get("applyDate")
        or row.get("subscriptionStartDate")
    )
    listing_date = _date_only(row.get("LISTING_DATE") or row.get("listingDate"))
    low_price = _num(row.get("LOW_PRICE") or row.get("lowerPrice") or row.get("priceLow"))
    high_price = _num(row.get("HIGH_PRICE") or row.get("upperPrice") or row.get("priceHigh"))
    issue_price = _num(row.get("ISSUE_PRICE") or row.get("finalPrice"))
    price_range = ""
    if low_price and high_price:
        price_range = f"{low_price:g}-{high_price:g}"
    return {
        "id": f"HK:{code}:{apply_date or listing_date}",
        "market": "HK",
        "code": code,
        "apply_code": code,
        "name": name,
        "company_name": _safe_text(row.get("SECURITY_NAME_FULL") or row.get("companyName") or name),
        "exchange": "港交所",
        "sector": _safe_text(row.get("INDUSTRY_NAME") or row.get("sector")),
        "business": _safe_text(row.get("MAIN_BUSINESS") or row.get("business")),
        "apply_date": apply_date,
        "listing_date": listing_date,
        "pricing_date": _date_only(row.get("pricingDate")),
        "issue_price": issue_price,
        "price_range": price_range,
        "currency": "HKD",
        "issue_pe": _num(row.get("PE") or row.get("issuePe")),
        "industry_pe": None,
        "issue_size": _num(row.get("ISSUE_NUM") or row.get("issueSize")),
        "fundraising_amount": _num(row.get("RAISE_FUNDS") or row.get("fundraisingAmount")),
        "online_apply_limit": None,
        "estimated_required_cash": None,
        "lot_size": _num(row.get("LOT_SIZE") or row.get("boardLot")),
        "subscription_multiple": _num(row.get("SUBSCRIPTION_MULTIPLE") or row.get("multiple")),
        "winning_rate": _num(row.get("WINNING_RATE") or row.get("oneLotSuccessRate")),
        "sponsor": _safe_text(row.get("SPONSOR") or row.get("sponsor")),
        "raw_status": _safe_text(row.get("STATUS") or row.get("status")),
        "status": _status_from_dates(apply_date, listing_date, _safe_text(row.get("STATUS") or row.get("status"))),
        "source": EASTMONEY_HK_IPO,
        "source_label": IPO_PROVIDER_LABELS[EASTMONEY_HK_IPO],
        "source_url": "https://data.eastmoney.com/hk/ipo.html",
        "updated_at": datetime.now().strftime("%Y-%m-%d"),
        "comments": [],
    }


def _hk_page_has_no_records(text: str) -> bool:
    plain = _safe_text(text).lower()
    markers = (
        "no record", "no ipo", "no information", "no related information",
        "暫無", "暂无", "沒有相關", "没有相关", "沒有新股", "没有新股",
    )
    return any(marker in plain for marker in markers)


def _parse_aastocks_hk_table(text: str, limit: int, source_url: str) -> list[dict]:
    parsed: list[dict] = []
    for html_row in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S | re.I):
        cells = [
            _safe_text(cell)
            for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", html_row, re.S | re.I)
        ]
        cells = [cell for cell in cells if cell]
        if len(cells) < 3:
            continue
        joined = " ".join(cells)
        if any(word in joined.lower() for word in ("stock code", "股份代號", "上市日期", "listing date")):
            continue
        code_match = re.search(r"\b\d{4,5}\b", joined)
        if not code_match:
            continue
        code = code_match.group(0).zfill(5)
        dates = re.findall(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", joined)
        price_cell = next(
            (
                cell for cell in cells
                if re.search(r"(?:HK\$|\$|\d+(?:\.\d+)?\s*[-至]\s*\d+(?:\.\d+)?)", cell, re.I)
                and code not in cell
            ),
            "",
        )
        price_values = re.findall(r"\d+(?:\.\d+)?", price_cell.replace(",", ""))
        name = next(
            (
                cell for cell in cells
                if code not in cell
                and not re.search(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", cell)
                and not re.fullmatch(r"[\d.,$/\-\s至]+", cell)
                and not any(word in cell.lower() for word in ("details", "詳情", "详情"))
            ),
            code,
        )
        raw_status = next(
            (
                cell for cell in cells
                if any(word in cell for word in ("招股中", "申购中", "認購中", "即將", "即将", "上市", "截止"))
                or any(word in cell.lower() for word in ("subscription", "upcoming", "listed", "closed"))
            ),
            "",
        )
        parsed.append(_mark_ipo_source(_normalize_hk_ipo({
            "stockCode": code,
            "stockName": name,
            "START_DATE": dates[0].replace("/", "-") if dates else "",
            "listingDate": dates[-1].replace("/", "-") if dates else "",
            "lowerPrice": price_values[0] if price_values else "",
            "upperPrice": price_values[1] if len(price_values) > 1 else "",
            "status": raw_status,
        }), AASTOCKS_HK_IPO, source_url))
        if len(parsed) >= limit:
            break
    return parsed


def _fetch_aastocks_hk_ipos(limit: int) -> list[dict]:
    urls = [
        "https://www.aastocks.com/tc/stocks/market/ipo/mainpage.aspx",
        "https://www.aastocks.com/en/stocks/market/ipo/mainpage.aspx",
        "https://www.aastocks.com/tc/ipo/IPOInfo.aspx",
        "https://www.aastocks.com/en/ipo/IPOInfo.aspx",
    ]
    errors: list[str] = []
    had_readable_page = False
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    for url in urls:
        try:
            resp = requests.get(
                url,
                headers=headers,
                timeout=10,
            )
            final_url = str(resp.url or url).lower()
            if resp.status_code >= 400:
                errors.append(f"{url} HTTP {resp.status_code}")
                continue
            text = resp.text
            if not text or "pagenotfound" in final_url or "pagenotfound" in text.lower():
                errors.append(f"{url} 页面不存在或被重定向")
                continue
            had_readable_page = True
            rows = _extract_objects_with_keys(
                text,
                {
                    "stockCode", "code", "symbol", "companyName", "name",
                    "listingDate", "subscriptionStartDate", "priceLow", "priceHigh",
                },
                limit=max(limit, 20),
            )
            items = [_normalize_hk_ipo(row) for row in rows if isinstance(row, dict)]
            items = [item for item in items if item.get("code") or item.get("name")]
            items = [_mark_ipo_source(item, AASTOCKS_HK_IPO, url) for item in items]
            if items:
                return _filter_open_ipos(items)[:limit]

            parsed = _parse_aastocks_hk_table(text, max(limit, 20), url)
            if parsed:
                return _filter_open_ipos(parsed)[:limit]

            if _hk_page_has_no_records(text):
                return []
        except Exception as exc:
            errors.append(str(exc))
    if had_readable_page:
        raise IPODataUnavailable("港股新股数据源页面可访问，但页面结构已变化或当前没有可解析的新股表格，请稍后刷新")
    detail = "；".join(errors[:2]) if errors else "连接失败"
    raise IPODataUnavailable(f"港股新股数据源当前不可达或入口已变更：{detail}")


def _find_hk_rows(value) -> list[dict]:
    if isinstance(value, dict):
        for key in ("data", "list", "items", "ipoList", "newStockList"):
            rows = value.get(key)
            if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                keys = set(rows[0].keys())
                if {"SECURITY_CODE", "SECURITY_NAME"} & keys or {"stockCode", "stockName"} & keys:
                    return rows
        for item in value.values():
            rows = _find_hk_rows(item)
            if rows:
                return rows
    if isinstance(value, list):
        if value and isinstance(value[0], dict):
            keys = set(value[0].keys())
            if {"SECURITY_CODE", "SECURITY_NAME"} & keys or {"stockCode", "stockName"} & keys:
                return value
        for item in value:
            rows = _find_hk_rows(item)
            if rows:
                return rows
    return []


def _fetch_hk_ipos(limit: int) -> list[dict]:
    candidates = [
        ("RPT_HKIPO", "APPLY_DATE"),
        ("RPT_HK_IPO", "APPLY_DATE"),
        ("RPTA_APP_HKIPO", "APPLY_DATE"),
        ("RPT_HKNEWSTOCK", "LISTING_DATE"),
    ]
    errors: list[str] = []
    for report_name, sort_column in candidates:
        try:
            result = _eastmoney_get(
                report_name,
                page_size=max(limit, 20),
                sort_columns=sort_column,
                sort_types="-1",
            )
            rows = result.get("data") or []
            if rows:
                return _filter_open_ipos([_normalize_hk_ipo(row) for row in rows if isinstance(row, dict)])[:limit]
        except Exception as exc:
            errors.append(str(exc))

    if errors and all("报表配置不存在" in error for error in errors):
        raise IPODataUnavailable("东方财富港股 IPO 旧报表接口已失效：报表配置不存在，请使用 AAStocks 港股新股源")

    # Keep a best-effort HTML parser as a fallback because Eastmoney report names change occasionally.
    page_candidates = [
        "https://data.eastmoney.com/hk/ipo.html",
        "https://www.aastocks.com/tc/stocks/market/ipo/mainpage.aspx",
        "https://www.aastocks.com/en/stocks/market/ipo/mainpage.aspx",
        "https://www.aastocks.com/tc/ipo/IPOInfo.aspx",
        "https://www.aastocks.com/en/ipo/IPOInfo.aspx",
        "https://www.hkexnews.hk/index.htm",
    ]
    for url in page_candidates:
        try:
            resp = requests.get(
                url,
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=6,
            )
            text = resp.text
            state = _extract_json_from_html(text)
            rows = _find_hk_rows(state)
            if not rows:
                rows = _extract_objects_with_keys(
                    text,
                    {
                        "SECURITY_CODE", "stockCode", "code", "symbol",
                        "SECURITY_NAME", "stockName", "companyName",
                        "listingDate", "LISTING_DATE",
                    },
                    limit=max(limit, 20),
                )
            items = [_normalize_hk_ipo(row) for row in rows if isinstance(row, dict)]
            items = [item for item in items if item.get("code") or item.get("name")]
            if items:
                return _filter_open_ipos(items)[:limit]
        except Exception as exc:
            errors.append(str(exc))

    raise IPODataUnavailable("东方财富港股 IPO 旧源未返回可解析数据，请使用 AAStocks 港股新股源")


def _normalize_us_ipo(row: dict) -> dict:
    code = _safe_text(row.get("symbol") or row.get("proposedTickerSymbol") or row.get("ticker"))
    name = _safe_text(row.get("companyName") or row.get("name") or code)
    price = _safe_text(row.get("proposedSharePrice") or row.get("price") or row.get("priceRange"))
    low_price = None
    high_price = None
    nums = re.findall(r"\d+(?:\.\d+)?", price.replace(",", ""))
    if len(nums) >= 2:
        low_price, high_price = float(nums[0]), float(nums[1])
    elif len(nums) == 1:
        low_price = high_price = float(nums[0])
    issue_price = high_price if high_price and high_price == low_price else None
    apply_date = _date_only(row.get("expectedPriceDate") or row.get("pricedDate"))
    listing_date = _date_only(row.get("expectedDate") or row.get("tradeDate") or row.get("listingDate"))
    return {
        "id": f"US:{code}:{listing_date or apply_date}",
        "market": "US",
        "code": code,
        "apply_code": code,
        "name": name,
        "company_name": name,
        "exchange": _safe_text(row.get("exchange") or row.get("proposedExchange")),
        "sector": _safe_text(row.get("sector") or row.get("industry")),
        "business": _safe_text(row.get("business") or row.get("description")),
        "apply_date": apply_date,
        "listing_date": listing_date,
        "pricing_date": apply_date,
        "issue_price": issue_price,
        "price_range": price,
        "currency": "USD",
        "issue_pe": None,
        "industry_pe": None,
        "issue_size": _num(row.get("sharesOffered") or row.get("shares")),
        "fundraising_amount": _num(row.get("dealSize") or row.get("proposedDealSize")),
        "online_apply_limit": None,
        "estimated_required_cash": None,
        "lot_size": None,
        "subscription_multiple": None,
        "winning_rate": None,
        "sponsor": _safe_text(row.get("underwriters") or row.get("bookrunner")),
        "raw_status": _safe_text(row.get("status") or "upcoming"),
        "status": _status_from_dates(apply_date, listing_date, _safe_text(row.get("status") or "upcoming")),
        "source": NASDAQ_IPO,
        "source_label": IPO_PROVIDER_LABELS[NASDAQ_IPO],
        "source_url": "https://www.nasdaq.com/market-activity/ipos",
        "updated_at": datetime.now().strftime("%Y-%m-%d"),
        "comments": [],
    }


def _fetch_stockanalysis_ipos(limit: int) -> list[dict]:
    try:
        resp = requests.get(
            "https://stockanalysis.com/ipos/calendar/",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=6,
        )
        text = resp.text
        rows = []
        for html_row in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S | re.I):
            cells = [
                _safe_text(cell)
                for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", html_row, re.S | re.I)
            ]
            cells = [cell for cell in cells if cell]
            if len(cells) < 3:
                continue
            joined = " ".join(cells)
            symbol = next((cell for cell in cells if re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,8}", cell)), "")
            if not symbol:
                m = re.search(r"\b[A-Z][A-Z0-9.\-]{1,8}\b", joined)
                symbol = m.group(0) if m else ""
            if not symbol or symbol in {"IPO", "NYSE", "NASDAQ"}:
                continue
            date_match = re.search(r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}|\d{4}-\d{1,2}-\d{1,2}", joined, re.I)
            company = next((cell for cell in cells if symbol not in cell and "$" not in cell and not re.search(r"\d{4}", cell)), symbol)
            price_cell = next((cell for cell in cells if "$" in cell), "")
            rows.append(_mark_ipo_source(_normalize_us_ipo({
                "symbol": symbol,
                "companyName": company,
                "priceRange": price_cell,
                "expectedDate": date_match.group(0) if date_match else "",
                "exchange": "US",
            }), STOCKANALYSIS_IPO, "https://stockanalysis.com/ipos/calendar/"))
            if len(rows) >= limit:
                break
        if rows:
            return _filter_open_ipos(rows)[:limit]
    except Exception as exc:
        raise IPODataUnavailable("美股 IPO 备用数据源暂未返回可解析数据") from exc
    raise IPODataUnavailable("美股 IPO 备用数据源暂未返回可解析数据")


def _fetch_us_ipos(limit: int) -> list[dict]:
    today = datetime.now()
    months = [today, today + timedelta(days=32)]
    rows: list[dict] = []
    errors: list[str] = []
    for month in months:
        try:
            resp = requests.get(
                "https://api.nasdaq.com/api/ipo/calendar",
                params={"date": month.strftime("%Y-%m")},
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "application/json, text/plain, */*",
                    "Origin": "https://www.nasdaq.com",
                    "Referer": "https://www.nasdaq.com/market-activity/ipos",
                    "Connection": "close",
                },
                timeout=6,
            )
            data = resp.json()
            body = data.get("data") or {}
            for key in ("upcoming", "priced", "filed"):
                value = body.get(key)
                if isinstance(value, dict):
                    value = value.get("rows") or value.get("data") or []
                if isinstance(value, list):
                    rows.extend([item for item in value if isinstance(item, dict)])
        except Exception as exc:
            errors.append(str(exc))

    if not rows:
        try:
            resp = requests.get(
                "https://www.nasdaq.com/market-activity/ipos",
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "text/html,application/xhtml+xml",
                    "Connection": "close",
                },
                timeout=6,
            )
            rows = _extract_objects_with_keys(
                resp.text,
                {
                    "symbol", "proposedTickerSymbol", "ticker",
                    "companyName", "proposedSharePrice", "priceRange",
                    "expectedDate", "expectedPriceDate",
                },
                limit=max(limit, 20),
            )
        except Exception as exc:
            errors.append(str(exc))

    if not rows:
        return _fetch_stockanalysis_ipos(limit)

    items = [_normalize_us_ipo(row) for row in rows if row]
    seen = set()
    unique = []
    for item in items:
        dedupe_key = (item.get("code"), item.get("listing_date"), item.get("apply_date"))
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        unique.append(item)
    if unique:
        return _filter_open_ipos(unique)[:limit]
    raise IPODataUnavailable("美股 IPO 数据源暂未返回可解析数据")


def _build_comment_summary(item: dict, fetched_comments: Optional[list[dict]] = None) -> list[dict]:
    signals = []
    comments = list(fetched_comments or [])
    name = item.get("name") or item.get("code")
    issue_pe = item.get("issue_pe")
    industry_pe = item.get("industry_pe")
    if issue_pe and industry_pe:
        if issue_pe < industry_pe * 0.8:
            signals.append(f"发行市盈率 {issue_pe:.2f} 倍，低于行业参考 {industry_pe:.2f} 倍，评论区通常会关注估值折价。")
        elif issue_pe > industry_pe * 1.2:
            signals.append(f"发行市盈率 {issue_pe:.2f} 倍，高于行业参考 {industry_pe:.2f} 倍，评论区容易担心估值偏贵。")
        else:
            signals.append(f"发行市盈率 {issue_pe:.2f} 倍，接近行业参考 {industry_pe:.2f} 倍，市场讨论可能更看重行业景气度。")
    if item.get("subscription_multiple"):
        signals.append(f"网下/初步申购倍数约 {item['subscription_multiple']:.2f} 倍，可作为机构参与热度参考。")
    if item.get("business"):
        signals.append(f"{name} 主营业务：{item['business']}")
    if not signals:
        signals.append("暂无稳定可抓取的评论明细，AI 将主要依据发行资料、估值、行业和日程做保守判断。")
    structured = [
        {
            "source": "structured_sentiment",
            "author": "系统摘要",
            "content": text,
            "sentiment": "neutral",
        }
        for text in signals[:4]
    ]
    return comments[:6] + structured


def _attach_comments(items: list[dict]) -> list[dict]:
    if not items:
        return items

    candidates = [
        item for item in items[:12]
        if item.get("market") in {"A", "HK"} and item.get("code")
    ]
    fetched_by_id: dict[str, list[dict]] = {}
    if candidates:
        with ThreadPoolExecutor(max_workers=min(5, len(candidates))) as executor:
            futures = {
                executor.submit(_fetch_eastmoney_guba_comments, str(item.get("code") or "")): item
                for item in candidates
            }
            for future in as_completed(futures):
                item = futures[future]
                try:
                    fetched_by_id[str(item.get("id"))] = future.result()
                except Exception:
                    fetched_by_id[str(item.get("id"))] = []

    for item in items:
        item["comments"] = _build_comment_summary(item, fetched_by_id.get(str(item.get("id")), []))
    return items


def _provider_for_market(market: str, providers: Optional[dict]) -> str:
    market = market.upper()
    selected = (providers or {}).get(market)
    if selected in IPO_PROVIDER_OPTIONS.get(market, []):
        return selected
    return DEFAULT_IPO_PROVIDERS.get(market, EASTMONEY_A_IPO)


def fetch_ipo_list(markets: list[str], providers: Optional[dict] = None, limit: int = 30, force_refresh: bool = False) -> dict:
    normalized_markets = [m.upper() for m in markets if m.upper() in {"A", "HK", "US"}] or ["A", "HK", "US"]
    provider_map = {market: _provider_for_market(market, providers) for market in normalized_markets}
    cache_key = ("ipo_list", tuple(normalized_markets), tuple(sorted(provider_map.items())), limit)
    cached = _cache_get(cache_key, 15 * 60)
    if cached is not _CACHE_MISS and not force_refresh:
        return cached

    all_items: list[dict] = []
    source_status: dict[str, dict] = {}
    fetchers = {
        EASTMONEY_A_IPO: _fetch_a_ipos,
        EASTMONEY_HK_IPO: _fetch_hk_ipos,
        AASTOCKS_HK_IPO: _fetch_aastocks_hk_ipos,
        NASDAQ_IPO: _fetch_us_ipos,
        STOCKANALYSIS_IPO: _fetch_stockanalysis_ipos,
    }
    per_market_limit = max(5, limit)
    for market in normalized_markets:
        provider = provider_map[market]
        try:
            items = fetchers[provider](per_market_limit)
            items = _attach_comments(items)
            all_items.extend(items)
            note = IPO_SOURCE_NOTES.get(provider, "")
            if not items:
                note = f"{note} 当前未返回近期新股记录。".strip()
            source_status[market] = {
                "provider": provider,
                "label": IPO_PROVIDER_LABELS.get(provider, provider),
                "ok": True,
                "count": len(items),
                "note": note,
            }
        except Exception as exc:
            market_label = {"A": "A股", "HK": "港股", "US": "美股"}.get(market, market)
            source_status[market] = {
                "provider": provider,
                "label": IPO_PROVIDER_LABELS.get(provider, provider),
                "ok": False,
                "count": 0,
                "error": _friendly_source_error(market_label, exc),
                "note": IPO_SOURCE_NOTES.get(provider, ""),
            }

    def sort_key(item: dict):
        return item.get("apply_date") or item.get("listing_date") or ""

    all_items = sorted(all_items, key=sort_key, reverse=True)[:limit]
    result = {
        "items": all_items,
        "source_status": source_status,
        "providers": provider_map,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    return _cache_set(cache_key, result)
