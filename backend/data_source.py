from __future__ import annotations
import json
import re
from datetime import datetime
from typing import Optional
from urllib.parse import quote

import requests

SINA = 'sina'
TENCENT = 'tencent'
EASTMONEY = 'eastmoney'
YAHOO = 'yahoo'

PROVIDER_LABELS = {
    SINA: '新浪财经',
    TENCENT: '腾讯财经',
    EASTMONEY: '东方财富',
    YAHOO: 'Yahoo Finance',
}

STOCK_PROVIDER_OPTIONS = {
    'A': [SINA, TENCENT, EASTMONEY],
    'HK': [SINA, TENCENT, YAHOO],
    'US': [YAHOO, SINA],
}

FUND_PROVIDER_OPTIONS = {
    'A': [EASTMONEY],
    'HK': [EASTMONEY],
    'US': [YAHOO],
}

DEFAULT_STOCK_PROVIDERS = {'A': SINA, 'HK': SINA, 'US': YAHOO}
DEFAULT_FUND_PROVIDERS = {'A': EASTMONEY, 'HK': EASTMONEY, 'US': YAHOO}


def parse_float(s) -> Optional[float]:
    try:
        return float(s) if s is not None and s != '' else None
    except (ValueError, TypeError):
        return None


def parse_chinese_amount(value) -> Optional[float]:
    """Parse amounts like 72.5亿元 / 1200万份 into a raw number."""
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        return None
    text = str(value).replace(',', '').strip()
    if not text or text in {'--', '-'}:
        return None
    m = re.search(r'-?\d+(?:\.\d+)?', text)
    if not m:
        return None
    num = parse_float(m.group(0))
    if num is None:
        return None
    if '亿' in text:
        return num * 1e8
    if '万' in text:
        return num * 1e4
    return num


def _base_code(code: str) -> str:
    """Return the numeric/local part of an exchange-qualified symbol."""
    c = (code or '').strip().upper()
    for suffix in ('.HK', '.SH', '.SZ', '.SS'):
        if c.endswith(suffix):
            return c[:-len(suffix)]
    return c


def _local_code(code: str, market: str) -> str:
    c = _base_code(code)
    if market == 'HK' and c.isdigit():
        return c.zfill(5)
    return c


def _yahoo_code(code: str, market: str) -> str:
    c = _base_code(code)
    if market == 'HK':
        return f'{c.zfill(4)}.HK' if c.isdigit() else f'{c}.HK'
    if market == 'A':
        return f'{c}.SS' if c.startswith(('6', '9')) else f'{c}.SZ'
    return c


RATIO_FIELDS = {
    'dividend_yield', 'payout_ratio', 'revenue_growth', 'profit_margins',
    'return_on_equity', 'return_on_assets', 'operating_margins',
    'earnings_growth', 'short_ratio', 'debt_to_equity',
}


def _normalize_ratio(value) -> Optional[float]:
    num = parse_float(value)
    if num is None:
        return None
    abs_num = abs(num)
    # Providers mix decimals (0.0586), percentages (5.86), and occasionally basis-points-like values (586).
    if abs_num > 100:
        return num / 10000.0
    if abs_num > 1:
        return num / 100.0
    return num


def _clean_fundamentals(data: Optional[dict]) -> Optional[dict]:
    if not data:
        return None
    cleaned = {}
    for k, v in data.items():
        if v is None:
            continue
        if k in {'trailing_pe', 'forward_pe', 'price_to_book', 'market_cap', 'shares_outstanding'}:
            num = parse_float(v)
            if num is not None and num <= 0:
                continue
        if k in RATIO_FIELDS:
            v = _normalize_ratio(v)
            if v is None:
                continue
            if k == 'dividend_yield' and abs(v) > 0.5:
                continue
        cleaned[k] = v
    return cleaned or None


def _complete_fundamentals(code: str, market: str, asset_type: str, data: Optional[dict],
                           providers: Optional[dict] = None) -> Optional[dict]:
    data = _clean_fundamentals(data)
    if not data:
        return None
    dividend_rate = parse_float(data.get('dividend_rate'))
    dividend_yield = parse_float(data.get('dividend_yield'))
    if dividend_rate and (dividend_yield is None or dividend_yield <= 0):
        try:
            quote_data = get_quote(code, market, asset_type, providers)
            price = parse_float((quote_data or {}).get('current_price'))
            if price and price > 0:
                computed_yield = dividend_rate / price
                if 0 < computed_yield < 0.5:
                    data['dividend_yield'] = computed_yield
        except Exception:
            pass
    return data


def _sina_stock_quote(code: str, market: str) -> Optional[dict]:
    code = _local_code(code, market)
    prefix_map = {'A': 'sh' if code.startswith(('6', '9')) else 'sz', 'HK': 'hk', 'US': 'gb_'}
    prefix = prefix_map.get(market, '')
    if not prefix:
        return None
    try:
        resp = requests.get(
            f'http://hq.sinajs.cn/list={prefix}{code}',
            headers={'Referer': 'http://finance.sina.com.cn'},
            timeout=5,
        )
        resp.encoding = 'gbk'
        m = re.search(r'"(.*)"', resp.text.strip())
        if not m:
            return None
        parts = m.group(1).split(',')
        if len(parts) < 32:
            return None
        name = parts[0]
        current = parse_float(parts[3])
        prev_close = parse_float(parts[2])
        return {
            'name': name, 'code': code, 'market': market,
            'current_price': current, 'prev_close': prev_close,
            'change': round(current - prev_close, 3) if (current is not None and prev_close is not None) else None,
            'change_pct': round((current - prev_close) / prev_close * 100, 2) if (current and prev_close) else None,
        }
    except Exception as e:
        print(f"[Sina] {code}: {e}")
        return None


def _tencent_stock_quote(code: str, market: str) -> Optional[dict]:
    code = _local_code(code, market)
    if market == 'A':
        prefix = 'sh' if code.startswith(('6', '9', '5')) else 'sz'
    else:
        prefix = {'HK': 'hk', 'US': 'us'}.get(market, '')
    try:
        resp = requests.get(f'http://qt.gtimg.cn/q={prefix}{code}', timeout=5)
        m = re.search(r'"(.*)"', resp.text)
        if not m:
            return None
        parts = m.group(1).split('~')
        if len(parts) < 40:
            return None
        name = parts[1]
        current = parse_float(parts[3])
        prev_close = parse_float(parts[4])
        return {
            'name': name, 'code': code, 'market': market,
            'current_price': current, 'prev_close': prev_close,
        }
    except Exception as e:
        print(f"[Tencent] {code}: {e}")
        return None


def _eastmoney_fund_quote(code: str) -> Optional[dict]:
    code = _base_code(code)
    try:
        resp = requests.get(f'https://fundgz.1234567.com.cn/js/{code}.js', timeout=5)
        m = re.search(r'jsonpgz\((.+)\)', resp.text)
        if not m:
            return None
        data = json.loads(m.group(1))
        return {
            'name': data.get('name', ''),
            'code': data.get('fundcode', code),
            'current_price': parse_float(data.get('gsz')),
            'nav': parse_float(data.get('dwjz')),
            'nav_date': data.get('jzrq', ''),
            'change_pct': parse_float(data.get('gszzl')),
        }
    except Exception as e:
        print(f"[EastMoney Fund] {code}: {e}")
        return None


def _yahoo_quote(code: str, market: str) -> Optional[dict]:
    try:
        yahoo_code = _yahoo_code(code, market)

        headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

        resp = requests.get(
            f'https://query1.finance.yahoo.com/v8/finance/chart/{quote(yahoo_code)}',
            headers=headers, timeout=5,
        )
        data = resp.json()
        result = data.get('chart', {}).get('result', [{}])[0]
        meta = result.get('meta', {})

        current_price = meta.get('regularMarketPrice')
        prev_close = meta.get('chartPreviousClose') or meta.get('previousClose')
        name = _yahoo_name(yahoo_code)

        return {
            'name': name or '',
            'code': code, 'market': market,
            'current_price': float(current_price) if current_price is not None else None,
            'prev_close': float(prev_close) if prev_close is not None else None,
            'change': round(float(current_price) - float(prev_close), 3) if (current_price is not None and prev_close is not None) else None,
            'change_pct': round((float(current_price) - float(prev_close)) / float(prev_close) * 100, 2) if (current_price and prev_close) else None,
        }
    except Exception as e:
        print(f"[Yahoo] {code}: {e}")
        return None


def _yahoo_name(symbol: str) -> Optional[str]:
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
        resp = requests.get(
            f'https://query1.finance.yahoo.com/v10/finance/quoteSummary/{quote(symbol)}?modules=price',
            headers=headers, timeout=5,
        )
        data = resp.json()
        price = data.get('quoteSummary', {}).get('result', [{}])[0].get('price', {})
        return price.get('longName') or price.get('shortName') or price.get('symbol', symbol)
    except Exception as e:
        print(f"[Yahoo Name] {symbol}: {e}")
        return None


def _eastmoney_stock_search(keyword: str) -> list[dict]:
    try:
        params = {'input': keyword, 'type': 14, 'token': 'D43BF722C8E33BDC906FB84D85E326E8', 'count': 10}
        resp = requests.get('https://searchadapter.eastmoney.com/api/suggest/get', params=params, timeout=5)
        data = resp.json()
        return [
            {'code': item.get('Code', ''), 'name': item.get('Name', ''), 'market': 'A'}
            for item in data.get('QuotationCodeTable', {}).get('Data', [])
        ]
    except Exception as e:
        print(f"[EastMoney Search] {e}")
        return []


def _eastmoney_fund_search(keyword: str, limit: int = 10) -> list[dict]:
    try:
        resp = requests.get('https://fund.eastmoney.com/js/fundcode_search.js', timeout=10)
        m = re.search(r'var r = (\[.*?\]);', resp.text)
        if not m:
            return []
        funds = json.loads(m.group(1))
        results = []
        for f in funds:
            code, name, fund_type = f[0], f[2], f[3]
            if keyword.lower() in code.lower() or keyword.lower() in name.lower():
                results.append({'code': code, 'name': name, 'type': fund_type, 'market': 'A'})
                if len(results) >= limit:
                    break
        return results
    except Exception as e:
        print(f"[EastMoney Fund Search] {e}")
        return []


def get_provider(asset_type: str, market: str, providers: Optional[dict] = None) -> str:
    type_key = 'fund' if 'fund' in (asset_type or '') else 'stock'
    defaults = DEFAULT_FUND_PROVIDERS if type_key == 'fund' else DEFAULT_STOCK_PROVIDERS
    if providers and type_key in providers and market in providers[type_key]:
        return providers[type_key][market]
    return defaults.get(market, SINA)


def lookup_name(code: str, market: str, asset_type: str, providers: Optional[dict] = None) -> Optional[str]:
    is_fund = 'fund' in (asset_type or '')
    provider = get_provider(asset_type, market, providers)

    result = None
    if is_fund:
        result = _eastmoney_fund_quote(code)
    elif provider == SINA:
        result = _sina_stock_quote(code, market)
    elif provider == TENCENT:
        result = _tencent_stock_quote(code, market)
    elif provider == YAHOO:
        result = _yahoo_quote(code, market)
    elif provider == EASTMONEY:
        result = _sina_stock_quote(code, market)

    if result and result.get('name'):
        return result['name']

    if is_fund:
        result = _eastmoney_fund_quote(code)
        if result and result.get('name'):
            return result['name']
    else:
        for fn in [_sina_stock_quote, _tencent_stock_quote, _yahoo_quote]:
            result = fn(code, market)
            if result and result.get('name'):
                return result['name']
    return None


def get_quote(code: str, market: str, asset_type: str, providers: Optional[dict] = None) -> Optional[dict]:
    is_fund = 'fund' in (asset_type or '')
    provider = get_provider(asset_type, market, providers)

    result = None
    if is_fund:
        result = _eastmoney_fund_quote(code)
        if not result:
            result = _yahoo_quote(code, market)
    else:
        fns = {SINA: _sina_stock_quote, TENCENT: _tencent_stock_quote, YAHOO: _yahoo_quote}
        result = fns.get(provider, _sina_stock_quote)(code, market)
        if not result:
            for fn in [_sina_stock_quote, _tencent_stock_quote, _yahoo_quote]:
                result = fn(code, market)
                if result:
                    break
    return result


def _eastmoney_kline_secid(code: str, market: str) -> Optional[str]:
    code = _base_code(code)
    if market == 'A':
        return ('1.' if code.startswith(('6', '9', '5')) else '0.') + code
    if market == 'HK':
        padded = code.zfill(5)
        return f'hk{padded}'
    return None


def _eastmoney_quote_secid(code: str, market: str) -> Optional[str]:
    code = _base_code(code)
    if market == 'A':
        return ('1.' if code.startswith(('6', '9', '5')) else '0.') + code
    if market == 'HK':
        return f'116.{code.zfill(5)}'
    return None


def _eastmoney_stock_history(code: str, market: str) -> Optional[list[dict]]:
    """Fetch ~6 months of daily K-line data from East Money (A-shares)."""
    secid = _eastmoney_kline_secid(code, market)
    if not secid:
        return None
    try:
        resp = requests.get(
            'https://push2.eastmoney.com/api/qt/stock/kline/get',
            params={'secid': secid, 'fields1': 'f1,f2,f3', 'fields2': 'f51,f52,f53,f54,f55',
                    'klt': '101', 'fqt': '1', 'end': '20500101', 'lmt': '120'},
            headers={'User-Agent': 'Mozilla/5.0'}, timeout=10,
        )
        data = resp.json().get('data', {})
        klines = data.get('klines', [])
        history = []
        for line in klines:
            parts = line.split(',')
            if len(parts) >= 5:
                date_str = parts[0]
                open_p = round(float(parts[1]), 3)
                close = round(float(parts[2]), 3)
                high = round(float(parts[3]), 3)
                low = round(float(parts[4]), 3)
                history.append({
                    'date': date_str, 'price': close,
                    'open': open_p, 'high': high, 'low': low,
                })
        return history if history else None
    except Exception as e:
        print(f"[EastMoney Stock History] {code}: {e}")
        return None


def _eastmoney_fund_history(code: str) -> Optional[list[dict]]:
    """Fetch fund NAV history from East Money."""
    code = _base_code(code)
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Referer': 'https://fund.eastmoney.com/',
        }
        resp = requests.get(
            'https://api.fund.eastmoney.com/f10/lsjz',
            params={'fundCode': code, 'pageIndex': 1, 'pageSize': 120},
            headers=headers, timeout=10,
        )
        data = resp.json()
        lsjz = data.get('Data', {}).get('LSJZList', [])
        history = []
        for item in lsjz:
            nav = parse_float(item.get('DWJZ'))
            date_str = item.get('FSRQ', '')
            if nav is not None and date_str:
                history.append({'date': date_str, 'price': round(nav, 4)})
        return history if history else None
    except Exception as e:
        print(f"[EastMoney Fund History] {code}: {e}")
        return None


def _yahoo_history(code: str, market: str) -> Optional[list[dict]]:
    """Fetch history from Yahoo Finance (HK/US stocks, fallback)."""
    try:
        yahoo_code = _yahoo_code(code, market)

        headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
        resp = requests.get(
            f'https://query1.finance.yahoo.com/v8/finance/chart/{quote(yahoo_code)}',
            params={'range': '6mo', 'interval': '1d'},
            headers=headers, timeout=10,
        )
        data = resp.json()
        result = data.get('chart', {}).get('result', [{}])[0]
        timestamps = result.get('timestamp', [])
        quotes = result.get('indicators', {}).get('quote', [{}])[0]
        closes = quotes.get('close', [])
        opens = quotes.get('open', [])
        highs = quotes.get('high', [])
        lows = quotes.get('low', [])

        history = []
        for i, ts in enumerate(timestamps):
            close = closes[i] if i < len(closes) else None
            if close is not None:
                item = {
                    'date': datetime.fromtimestamp(ts).strftime('%Y-%m-%d'),
                    'price': round(float(close), 3),
                }
                if i < len(opens) and opens[i] is not None:
                    item['open'] = round(float(opens[i]), 3)
                if i < len(highs) and highs[i] is not None:
                    item['high'] = round(float(highs[i]), 3)
                if i < len(lows) and lows[i] is not None:
                    item['low'] = round(float(lows[i]), 3)
                history.append(item)
        return history if history else None
    except Exception as e:
        print(f"[Yahoo History] {code}: {e}")
        return None


def _tencent_stock_history(code: str, market: str) -> Optional[list[dict]]:
    """Fetch K-line history Tencent finance (A-shares / HK)."""
    code = _local_code(code, market)
    if market == 'A':
        prefix = 'sh' if code.startswith(('6', '9', '5')) else 'sz'
    elif market == 'HK':
        prefix = 'hk'
    else:
        return None
    try:
        resp = requests.get(
            f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={prefix}{code},day,,,120,qfq',
            headers={'User-Agent': 'Mozilla/5.0'}, timeout=10,
        )
        data = resp.json()
        klines = data.get('data', {}).get(f'{prefix}{code}', {}).get('qfqday', [])
        history = []
        for item in klines:
            if len(item) >= 5:
                history.append({
                    'date': item[0],
                    'price': round(float(item[1]), 3),
                    'open': round(float(item[2]), 3),
                    'high': round(float(item[3]), 3),
                    'low': round(float(item[4]), 3),
                })
        return history if history else None
    except Exception as e:
        print(f"[Tencent History] {code}: {e}")
        return None


def get_history(code: str, market: str, asset_type: str, providers: Optional[dict] = None) -> Optional[list[dict]]:
    """Fetch ~6 months of daily K-line / NAV history.

    Multi-source fallback chain: tries each source in order,
    returns the first one that returns data.
    """
    is_fund = 'fund' in (asset_type or '')
    provider = get_provider(asset_type, market, providers)

    if is_fund:
        sources = [
            lambda: _eastmoney_fund_history(code),
            lambda: _yahoo_history(code, market),
        ]
        for fn in sources:
            result = fn()
            if result:
                return result
        return None

    def em_s():
        return _eastmoney_stock_history(code, market)
    def yh():
        return _yahoo_history(code, market)
    def tencent_h():
        return _tencent_stock_history(code, market)

    if market == 'A':
        ordered = [tencent_h, em_s, yh]
        if provider == YAHOO:
            ordered = [yh, tencent_h, em_s]
    elif market == 'HK':
        ordered = [tencent_h, yh, em_s]
    else:
        ordered = [yh, em_s, tencent_h]

    for fn in ordered:
        try:
            result = fn()
            if result:
                return result
        except Exception:
            continue
    return None


def _sina_stock_fundamentals(code: str, market: str) -> Optional[dict]:
    """Extract fundamental metrics from Sina finance quote (A-shares).

    Field mapping (Sina A-share quote):
      30 → trailing_pe
      34 → shares_outstanding
      36 → market_cap
      38 → price_to_book
    """
    code = _local_code(code, market)
    prefix_map = {'A': 'sh' if code.startswith(('6', '9')) else 'sz', 'HK': 'hk'}
    prefix = prefix_map.get(market, '')
    if not prefix:
        return None
    try:
        resp = requests.get(
            f'http://hq.sinajs.cn/list={prefix}{code}',
            headers={'Referer': 'http://finance.sina.com.cn'},
            timeout=5,
        )
        resp.encoding = 'gbk'
        m = re.search(r'"(.*)"', resp.text.strip())
        if not m:
            return None
        parts = m.group(1).split(',')
        if len(parts) < 40:
            return None
        result = {}
        if len(parts) > 30:
            pe = parse_float(parts[30])
            if pe is not None:
                result['trailing_pe'] = pe
        if len(parts) > 34:
            shares = parse_float(parts[34])
            if shares is not None:
                result['shares_outstanding'] = shares
        if len(parts) > 36:
            mcap = parse_float(parts[36])
            if mcap is not None:
                result['market_cap'] = mcap
        if len(parts) > 38:
            pb = parse_float(parts[38])
            if pb is not None:
                result['price_to_book'] = pb
        return result if result else None
    except Exception as e:
        print(f"[Sina Fundamentals] {code}: {e}")
        return None


def _tencent_stock_fundamentals(code: str, market: str) -> Optional[dict]:
    """Extract fundamental metrics from Tencent finance quote.

    Tencent's qt.gtimg.cn field layout differs by market:
      A shares (sz/sh prefix):  39→trailing_pe, 46→price_to_book, 44→mcap(亿), 72→shares
      HK shares (hk prefix):    41→trailing_pe, 44→shares_outstanding, 45→mcap(亿)
    """
    code = _local_code(code, market)
    if market == 'A':
        prefix = 'sh' if code.startswith(('6', '9', '5')) else 'sz'
    elif market == 'HK':
        prefix = 'hk'
    else:
        return None
    try:
        resp = requests.get(f'http://qt.gtimg.cn/q={prefix}{code}', timeout=5)
        m = re.search(r'"(.*)"', resp.text)
        if not m or 'none_match' in resp.text.lower():
            return None
        parts = m.group(1).split('~')
        result = {}
        if market == 'A':
            current_price = parse_float(parts[3]) if len(parts) > 3 else None
            if len(parts) > 39:
                pe = parse_float(parts[39])
                if pe is not None:
                    result['trailing_pe'] = pe
            if len(parts) > 46:
                pb = parse_float(parts[46])
                if pb is not None:
                    result['price_to_book'] = pb
            if len(parts) > 64:
                dividend_yield_pct = parse_float(parts[64])
                if dividend_yield_pct is not None and dividend_yield_pct > 0:
                    dividend_yield = _normalize_ratio(dividend_yield_pct)
                    if dividend_yield is not None:
                        result['dividend_yield'] = dividend_yield
                        if current_price is not None and current_price > 0:
                            result['dividend_rate'] = current_price * dividend_yield
            if len(parts) > 72:
                shares = parse_float(parts[72])
                if shares is not None and shares > 0:
                    result['shares_outstanding'] = shares
            if len(parts) > 45:
                mcap_yi = parse_float(parts[44]) or parse_float(parts[45])
                if mcap_yi is not None:
                    result['market_cap'] = mcap_yi * 1e8
        elif market == 'HK':
            if len(parts) < 45:
                return None
            if len(parts) > 39:
                pe = parse_float(parts[39])
                if pe is not None and pe > 0:
                    result['trailing_pe'] = pe
            if len(parts) > 58:
                pb = parse_float(parts[58])
                if pb is not None and pb > 0:
                    result['price_to_book'] = pb
            if len(parts) > 47:
                dividend_yield_pct = parse_float(parts[47])
                if dividend_yield_pct is not None and dividend_yield_pct > 0:
                    result['dividend_yield'] = _normalize_ratio(dividend_yield_pct)
            if len(parts) > 72:
                dividend_rate = parse_float(parts[72])
                if dividend_rate is not None and dividend_rate > 0:
                    result['dividend_rate'] = dividend_rate
            if len(parts) > 45:
                mcap_yi = parse_float(parts[45]) or parse_float(parts[44])
                if mcap_yi is not None and mcap_yi > 0:
                    result['market_cap'] = mcap_yi * 1e8
        return result if result else None
    except Exception as e:
        print(f"[Tencent Fundamentals] {code}: {e}")
        return None


def _eastmoney_stock_fundamentals(code: str, market: str) -> Optional[dict]:
    """Fetch fundamentals from East Money (A-shares / HK stocks)."""
    secid = _eastmoney_quote_secid(code, market)
    if not secid:
        return None
    try:
        resp = requests.get(
            'https://push2.eastmoney.com/api/qt/stock/get',
            params={'secid': secid,
                    'fields': 'f43,f50,f52,f84,f85,f100,f115,f116,f117,f162,f167,f168,f45,f46'},
            headers={'User-Agent': 'Mozilla/5.0'}, timeout=10,
        )
        data = resp.json().get('data', {})
        if not data:
            return None
        result = {}
        if market == 'HK':
            if data.get('f116') is not None:
                result['market_cap'] = data['f116']
            if data.get('f167') is not None:
                result['dividend_yield'] = _normalize_ratio(data['f167'])
            if data.get('f84') is not None and data['f84'] > 0:
                result['shares_outstanding'] = data['f84']
            return result if result else None
        # East Money A-share quote fields are not stable fundamentals for PE/PB/EPS/ROE here.
        # Keep only quote-level values whose meanings are verified by cross-source checks.
        if data.get('f116') is not None:
            result['market_cap'] = data['f116']  # in yuan
        if data.get('f84') is not None:
            result['shares_outstanding'] = data['f84']
        return result if result else None
    except Exception as e:
        print(f"[EastMoney Stock Fundamentals] {code}: {e}")
        return None


def _eastmoney_fund_fundamentals(code: str) -> Optional[dict]:
    """Fetch fund fundamentals from East Money (size, managers, returns, dividends)."""
    code = _base_code(code)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://fund.eastmoney.com/',
    }
    result = {}
    try:
        resp = requests.get(
            'https://api.fund.eastmoney.com/f10/fninfo',
            params={'fundCode': code},
            headers=headers, timeout=10,
        )
        data = resp.json().get('Data') or {}
        fund_size = parse_chinese_amount(data.get('ENDNAV')) or parse_chinese_amount(data.get('FFSHARE'))
        if fund_size is not None:
            result['fund_size'] = fund_size
            result['market_cap'] = fund_size
        dividend_rate = parse_float(data.get('FHFCZ')) or parse_float(data.get('DWJZFH'))
        if dividend_rate is not None:
            result['dividend_rate'] = dividend_rate
        if data.get('FTYPE'):
            result['fund_type'] = data.get('FTYPE', '')
        if data.get('CLRQ'):
            result['fund_established'] = data.get('CLRQ', '')
    except Exception as e:
        print(f"[EastMoney Fund Fundamentals] {code}: {e}")

    try:
        resp = requests.get(
            f'https://fund.eastmoney.com/pingzhongdata/{code}.js',
            headers=headers, timeout=10,
        )
        text = resp.text

        def _extract_json_var(name: str):
            m = re.search(rf'var\s+{name}\s*=\s*(.*?);', text, re.S)
            if not m:
                return None
            try:
                return json.loads(m.group(1))
            except Exception:
                return None

        def _extract_string_var(name: str):
            m = re.search(rf'var\s+{name}\s*=\s*["\'](.*?)["\'];', text, re.S)
            return m.group(1) if m else None

        if _extract_string_var('fS_name'):
            result['fund_name'] = _extract_string_var('fS_name')
        if _extract_string_var('Data_netWorthTrend') is None:
            pass
        for key, var_name in [
            ('fund_1m_return', 'syl_1y'),
            ('fund_3m_return', 'syl_3y'),
            ('fund_6m_return', 'syl_6y'),
            ('fund_1y_return', 'syl_1n'),
        ]:
            value = _extract_string_var(var_name)
            parsed = parse_float(value)
            if parsed is not None:
                result[key] = parsed / 100

        managers = _extract_json_var('Data_currentFundManager') or []
        if isinstance(managers, list) and managers:
            names = [str(m.get('name', '')).strip() for m in managers if isinstance(m, dict) and m.get('name')]
            if names:
                result['fund_manager'] = '、'.join(names)
                result['fund_managers'] = names
            first = next((m for m in managers if isinstance(m, dict)), {})
            if first.get('workTime'):
                result['fund_manager_tenure'] = first.get('workTime')
            if first.get('fundSize'):
                size = parse_chinese_amount(first.get('fundSize'))
                if size is not None and not result.get('fund_size'):
                    result['fund_size'] = size
                    result['market_cap'] = size
    except Exception as e:
        print(f"[EastMoney Fund Profile] {code}: {e}")

    try:
        resp = requests.get(
            'https://api.fund.eastmoney.com/f10/lsjz',
            params={'fundCode': code, 'pageIndex': 1, 'pageSize': 120},
            headers=headers, timeout=10,
        )
        items = resp.json().get('Data', {}).get('LSJZList', [])
        dividends = []
        for item in items:
            amount = parse_float(item.get('FHFCZ'))
            date_str = item.get('FSRQ', '')
            if amount is not None and amount > 0 and date_str:
                dividends.append({'date': date_str, 'amount': amount, 'unit': '元/份'})
        if dividends:
            result['fund_dividends'] = dividends[:8]
            result['last_dividend_date'] = dividends[0]['date']
            result['last_dividend_amount'] = dividends[0]['amount']
    except Exception as e:
        print(f"[EastMoney Fund Dividends] {code}: {e}")

    try:
        quote = _eastmoney_fund_quote(code)
        if quote:
            if quote.get('nav') is not None:
                result['fund_nav'] = quote.get('nav')
            if quote.get('nav_date'):
                result['fund_nav_date'] = quote.get('nav_date')
    except Exception:
        pass

    return result if result else None


def _yahoo_fundamentals(code: str, market: str) -> Optional[dict]:
    """Fetch fundamental metrics from Yahoo Finance (HK/US stocks)."""
    try:
        yahoo_code = _yahoo_code(code, market)

        headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
        resp = requests.get(
            f'https://query1.finance.yahoo.com/v10/finance/quoteSummary/{quote(yahoo_code)}',
            params={'modules': 'summaryDetail,financialData,defaultKeyStatistics,price'},
            headers=headers, timeout=10,
        )
        data = resp.json()
        result = data.get('quoteSummary', {}).get('result', [{}])[0]

        def _safe(v):
            if v is None:
                return None
            if isinstance(v, dict):
                return v.get('raw') if 'raw' in v else v.get('fmt')
            return v

        sd = result.get('summaryDetail', {})
        fd = result.get('financialData', {})
        ks = result.get('defaultKeyStatistics', {})

        fundamentals = {
            'market_cap': _safe(sd.get('marketCap')),
            'trailing_pe': _safe(sd.get('trailingPE')),
            'forward_pe': _safe(sd.get('forwardPE')),
            'price_to_book': _safe(sd.get('priceToBook')),
            'dividend_yield': _safe(sd.get('dividendYield')),
            'dividend_rate': _safe(sd.get('dividendRate')),
            'payout_ratio': _safe(sd.get('payoutRatio')),
            'beta': _safe(sd.get('beta')),
            'eps': _safe(fd.get('earningsPerShare')),
            'revenue': _safe(fd.get('totalRevenue')),
            'revenue_growth': _safe(fd.get('revenueGrowth')),
            'profit_margins': _safe(fd.get('profitMargins')),
            'return_on_equity': _safe(fd.get('returnOnEquity')),
            'return_on_assets': _safe(fd.get('returnOnAssets')),
            'debt_to_equity': _safe(fd.get('debtToEquity')),
            'book_value': _safe(ks.get('bookValue')),
            'shares_outstanding': _safe(ks.get('sharesOutstanding')),
            'short_ratio': _safe(ks.get('shortRatio')),
            'current_ratio': _safe(fd.get('currentRatio')),
            'quick_ratio': _safe(fd.get('quickRatio')),
            'earnings_growth': _safe(fd.get('earningsGrowth')),
            'operating_margins': _safe(fd.get('operatingMargins')),
        }
        return {k: v for k, v in fundamentals.items() if v is not None}
    except Exception as e:
        print(f"[Yahoo Fundamentals] {code}: {e}")
        return None


def get_fundamentals(code: str, market: str, asset_type: str, providers: Optional[dict] = None) -> Optional[dict]:
    """Fetch fundamental metrics (PE, PB, dividend, market cap, etc.).

    Multi-source fallback chain (all sources tried, results merged):
      1. Configured provider (if it supports fundamentals)
      2. East Money (best coverage for A / HK)
      3. Yahoo (best coverage for HK / US)
      4. Sina / Tencent (backup extractors)
    """
    base = _base_code(code)
    is_fund = 'fund' in (asset_type or '') or (market == 'A' and base.startswith(('1', '5')))
    provider = get_provider(asset_type, market, providers)

    if is_fund:
        result = _complete_fundamentals(code, market, asset_type, _eastmoney_fund_fundamentals(code), providers)
        if result:
            return result
        if market == 'A':
            stock_like = _complete_fundamentals(code, market, asset_type, _eastmoney_stock_fundamentals(code, market), providers)
            if stock_like:
                safe_keys = {'market_cap', 'dividend_yield', 'shares_outstanding'}
                return {k: v for k, v in stock_like.items() if k in safe_keys}
        return result

    def em():
        return _eastmoney_stock_fundamentals(code, market)
    def yahoo():
        return _yahoo_fundamentals(code, market)
    def sina():
        return _sina_stock_fundamentals(code, market)
    def tencent():
        return _tencent_stock_fundamentals(code, market)

    if market == 'A':
        provider_first = {YAHOO: yahoo}.get(provider)
        ordered = [provider_first, tencent, em, yahoo, sina] if provider_first else [tencent, em, yahoo, sina]
    elif market == 'HK':
        provider_first = {YAHOO: yahoo, SINA: tencent}.get(provider)
        ordered = [provider_first, tencent, yahoo, em] if provider_first else [tencent, yahoo, em]
    elif market == 'US':
        ordered = [yahoo, em]
    else:
        ordered = [yahoo]

    all_data = {}
    for fn in ordered:
        if fn is None:
            continue
        try:
            data = _clean_fundamentals(fn())
        except Exception:
            data = None
        if data and isinstance(data, dict):
            for k, v in data.items():
                if k not in all_data and v is not None:
                    all_data[k] = v

    return _complete_fundamentals(code, market, asset_type, all_data, providers)


def search(keyword: str, market: str, asset_type: str) -> list[dict]:
    is_fund = 'fund' in (asset_type or '')
    if is_fund:
        return _eastmoney_fund_search(keyword)
    if market == 'A':
        return _eastmoney_stock_search(keyword)
    if market == 'HK':
        r = _sina_stock_quote(keyword, 'HK')
        if r:
            return [{'code': keyword, 'name': r['name'], 'market': 'HK'}]
        return []
    if market == 'US':
        r = _yahoo_quote(keyword, 'US')
        if r:
            return [{'code': keyword, 'name': r['name'], 'market': 'US'}]
        return []
    return []
