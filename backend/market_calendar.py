from __future__ import annotations
from datetime import date, datetime, timedelta
from typing import Optional


# 主要节假日列表（2026年）
# A股：春节、国庆各休7天，元旦、清明、劳动、端午各休3-5天
# 港股：春节3天，清明、佛诞、中秋各1天，国庆1天
# 美股：元旦、马丁路德金日、总统日、阵亡将士日、独立日、劳动节、感恩节、圣诞节

CN_HOLIDAYS_2026: set[str] = {
    "2026-01-01",  # 元旦
    "2026-01-02",
    "2026-01-03",
    "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21",  # 春节
    "2026-04-04", "2026-04-05", "2026-04-06",  # 清明
    "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",  # 劳动节
    "2026-06-25", "2026-06-26", "2026-06-27",  # 端午
    "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",  # 国庆
}

# 调休上班日（2026年）
CN_WORKDAYS_2026: set[str] = {
    "2026-02-14",  # 春节前
    "2026-09-27",  # 国庆前
    "2026-10-10",  # 国庆后
}

HK_HOLIDAYS_2026: set[str] = {
    "2026-01-01",  # 元旦
    "2026-02-17", "2026-02-18", "2026-02-19",  # 春节（年初二至初四）
    "2026-04-04",  # 清明节
    "2026-04-06",  # 复活节星期一
    "2026-05-01",  # 劳动节
    "2026-05-25",  # 佛诞
    "2026-06-19",  # 端午节
    "2026-07-01",  # 回归纪念日
    "2026-09-28",  # 中秋节翌日
    "2026-10-01",  # 国庆日
    "2026-10-02",  # 国庆日翌日
    "2026-10-29",  # 重阳节
    "2026-12-25",  # 圣诞节
    "2026-12-26",  # 圣诞节后第一个周日
}

US_HOLIDAYS_2026: set[str] = {
    "2026-01-01",  # New Year's Day
    "2026-01-19",  # Martin Luther King Jr. Day
    "2026-02-16",  # Presidents' Day
    "2026-05-25",  # Memorial Day
    "2026-06-19",  # Juneteenth
    "2026-07-03",  # Independence Day (observed, Sat is Jul 4)
    "2026-09-07",  # Labor Day
    "2026-11-26",  # Thanksgiving
    "2026-12-25",  # Christmas
}


def _is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def is_china_trading_day(d: date) -> bool:
    ds = d.isoformat()
    if ds in CN_HOLIDAYS_2026:
        return False
    if ds in CN_WORKDAYS_2026:
        return True
    return not _is_weekend(d)


def is_hk_trading_day(d: date) -> bool:
    ds = d.isoformat()
    if ds in HK_HOLIDAYS_2026:
        return False
    return not _is_weekend(d)


def is_us_trading_day(d: date) -> bool:
    ds = d.isoformat()
    if ds in US_HOLIDAYS_2026:
        return False
    return not _is_weekend(d)


MARKET_CHECK = {
    "A": is_china_trading_day,
    "HK": is_hk_trading_day,
    "US": is_us_trading_day,
}


def is_trading_day(markets: list[str], d: Optional[date] = None) -> bool:
    """Check if today (or given date) is a trading day for ANY of the specified markets.
    If markets is empty, returns True (no restriction)."""
    if not markets:
        return True
    d = d or datetime.now().date()
    for m in markets:
        fn = MARKET_CHECK.get(m)
        if fn and fn(d):
            return True
    return False


def next_trading_day(markets: list[str], from_date: Optional[date] = None) -> date:
    """Find the next trading day after from_date (or today) that at least one market is open."""
    d = (from_date or datetime.now().date()) + timedelta(days=1)
    while not is_trading_day(markets, d):
        d += timedelta(days=1)
    return d
