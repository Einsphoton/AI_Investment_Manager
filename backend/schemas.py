from __future__ import annotations
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime


class AssetCreate(BaseModel):
    asset_type: str
    market: str
    platform: str
    code: str
    name: str = ""
    shares: float
    buy_price: float
    buy_date: str
    current_price: Optional[float] = None
    note: str = ""
    source: str = "manual"


class AssetUpdate(BaseModel):
    asset_type: Optional[str] = None
    market: Optional[str] = None
    platform: Optional[str] = None
    code: Optional[str] = None
    name: Optional[str] = None
    shares: Optional[float] = None
    buy_price: Optional[float] = None
    buy_date: Optional[str] = None
    current_price: Optional[float] = None
    note: Optional[str] = None
    source: Optional[str] = None


class AssetResponse(BaseModel):
    id: int
    asset_type: str
    market: str
    platform: str
    code: str
    name: str
    shares: float
    buy_price: float
    buy_date: str
    current_price: Optional[float]
    price_updated_at: str
    note: str
    source: str = "manual"
    created_at: datetime
    updated_at: datetime

    @field_validator("source", mode="before")
    @classmethod
    def normalize_source(cls, value):
        return "ai_advice" if value == "ai_advice" else "manual"

    class Config:
        from_attributes = True


class AssetTransactionCreate(BaseModel):
    trade_type: str
    trade_date: str
    shares: float
    price: float
    fee: float = 0.0
    note: str = ""


class AssetTransactionResponse(BaseModel):
    id: int
    asset_id: int
    trade_type: str
    trade_date: str
    shares: float
    price: float
    fee: float
    note: str
    created_at: datetime

    class Config:
        from_attributes = True


class AssetAnalysisSnippet(BaseModel):
    id: int
    summary: str
    detail: str
    created_at: datetime

    class Config:
        from_attributes = True


class AssetDetailResponse(BaseModel):
    asset: AssetResponse
    history: list[dict] = []
    fundamentals: dict = {}
    transactions: list[AssetTransactionResponse] = []
    latest_analysis: Optional[AssetAnalysisSnippet] = None


class AnalysisResponse(BaseModel):
    id: int
    summary: str
    detail: str
    total_market_value: float
    total_cost: float
    total_pnl: float
    total_pnl_percent: float
    realized_pnl: float
    created_at: datetime

    class Config:
        from_attributes = True


class SettingsUpdate(BaseModel):
    key: str
    value: str


class SettingsResponse(BaseModel):
    key: str
    value: str

    class Config:
        from_attributes = True


class DashboardData(BaseModel):
    total_market_value: float
    total_cost: float
    total_pnl: float
    total_pnl_percent: float
    realized_pnl: float
    assets_count: int
    analysis_summary: str = ""


class TargetCreate(BaseModel):
    code: str = ""
    name: str
    market: str = "A"
    asset_type: str = "stock"
    source: str = "manual"
    reason: str = ""
    priority: str = "MEDIUM"
    risk_level: str = "MEDIUM"
    expected_return: str = ""
    target_price: Optional[float] = None
    recommended_price: Optional[float] = None
    note: str = ""


class TargetUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    market: Optional[str] = None
    asset_type: Optional[str] = None
    source: Optional[str] = None
    reason: Optional[str] = None
    priority: Optional[str] = None
    risk_level: Optional[str] = None
    expected_return: Optional[str] = None
    target_price: Optional[float] = None
    recommended_price: Optional[float] = None
    status: Optional[str] = None
    note: Optional[str] = None


class TargetResponse(BaseModel):
    id: int
    code: str
    name: str
    market: str
    asset_type: str
    source: str
    reason: str
    priority: str
    risk_level: str
    expected_return: str
    target_price: Optional[float] = None
    recommended_price: Optional[float] = None
    status: str
    note: str
    ai_analysis: str
    last_analyzed_at: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AIRecommendConfig(BaseModel):
    markets: list[str] = []
    asset_types: list[str] = []


class AgentAnalysisRequest(BaseModel):
    asset_ids: list[int] = []
    target_ids: list[int] = []
    goal: str = "全面分析投资组合"
    save_portfolio_record: bool = True


class AgentAnalysisResponse(BaseModel):
    summary: str
    report: dict


class InvestmentAdviceAcceptRequest(BaseModel):
    advice: dict


class InvestmentAdviceResponse(BaseModel):
    summary: str
    advice: list[dict] = []
    ipo_advice: list[dict] = []
    budget_status: list[dict] = []
    market_context: dict = {}
    market_snapshot: dict = {}
    decision_audit: list[dict] = []
    asset_scope: str = "all"
    asset_scope_label: str = "全部资产"


class IPOTradeCreate(BaseModel):
    ipo_id: str = ""
    code: str
    name: str = ""
    market: str
    platform: str = ""
    currency: str = "CNY"
    trade_type: str
    shares: float = Field(..., ge=0)
    price: float = Field(..., ge=0)
    fee: float = 0.0
    trade_date: str = ""
    follow_up_date: str = ""
    analysis_snapshot: dict = {}
    advice_snapshot: dict = {}
    note: str = ""

    @field_validator("market", mode="before")
    @classmethod
    def normalize_market(cls, value):
        return str(value or "").strip().upper()

    @field_validator("trade_type", mode="before")
    @classmethod
    def normalize_trade_type(cls, value):
        raw = str(value or "").strip().upper()
        if raw in {"APPLY", "申购", "已申购", "申购待回访"}:
            return "APPLY"
        if raw in {"SUBSCRIBE", "BUY", "WIN", "中签", "确认中签"}:
            return "SUBSCRIBE"
        if raw in {"NO_WIN", "NOT_WIN", "MISS", "未中签", "不中签"}:
            return "NO_WIN"
        if raw in {"SELL", "卖出"}:
            return "SELL"
        return raw


class IPOTradeResponse(BaseModel):
    id: int
    ipo_id: str
    code: str
    name: str
    market: str
    platform: str
    currency: str
    trade_type: str
    shares: float
    price: float
    fee: float
    trade_date: str
    follow_up_date: str = ""
    realized_pnl: float
    analysis_snapshot: dict = {}
    advice_snapshot: dict = {}
    note: str
    created_at: datetime

    class Config:
        from_attributes = True


class IPORealizedPnlResponse(BaseModel):
    realized_pnl: float = 0.0
    total_sell_amount: float = 0.0
    total_cost_basis: float = 0.0
    total_fee: float = 0.0
    closed_trades: int = 0
    open_positions: list[dict] = []


class IPOListRequest(BaseModel):
    markets: list[str] = ["A", "HK", "US"]
    limit: int = Field(30, ge=1, le=100)
    force_refresh: bool = False


class IPOAnalysisRequest(BaseModel):
    markets: list[str] = ["A", "HK", "US"]
    ipo_ids: list[str] = []
    items: list[dict] = []
    source_status: dict = {}
    limit: int = Field(30, ge=1, le=100)
    force_refresh: bool = False


class IPOListResponse(BaseModel):
    items: list[dict] = []
    source_status: dict = {}
    providers: dict = {}
    generated_at: str = ""


class IPOAnalysisResponse(BaseModel):
    summary: str = ""
    analyses: list[dict] = []
    market_view: dict = {}
    data_quality: dict = {}
    source_status: dict = {}
    generated_at: str = ""


class AIChatMessage(BaseModel):
    role: str
    content: str


class AIChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    history: list[AIChatMessage] = []
    include_live_quotes: bool = True


class AIChatResponse(BaseModel):
    answer: str
    model: str
    context_meta: dict = {}


class AIChatContextResponse(BaseModel):
    summary: dict = {}
    sample_questions: list[str] = []


class MarketLookupRequest(BaseModel):
    code: str
    market: str
    asset_type: str


class MarketLookupResponse(BaseModel):
    name: Optional[str] = None
    code: str
    market: str


class MarketQuoteRequest(BaseModel):
    code: str
    market: str
    asset_type: str
    force_refresh: bool = False


class MarketQuoteResponse(BaseModel):
    name: Optional[str] = None
    code: str
    market: str
    current_price: Optional[float] = None
    prev_close: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    source: Optional[str] = None


class MarketSearchRequest(BaseModel):
    keyword: str
    market: str
    asset_type: str


class MarketSearchItem(BaseModel):
    code: str
    name: str
    market: str


class MarketSearchResponse(BaseModel):
    results: list[MarketSearchItem]


class MarketHistoryRequest(BaseModel):
    code: str
    market: str
    asset_type: str
    period: str = "6m"
    interval: str = "day"
    force_refresh: bool = False


class MarketHistoryItem(BaseModel):
    date: str
    price: float
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None


class MarketHistoryResponse(BaseModel):
    code: str
    market: str
    history: list[MarketHistoryItem] = []


class MarketFundamentalsRequest(BaseModel):
    code: str
    market: str
    asset_type: str
    force_refresh: bool = False


class MarketFundamentalsResponse(BaseModel):
    code: str
    market: str
    fundamentals: dict = {}


class OcrAssetItem(BaseModel):
    asset_type: str = ""
    market: str = ""
    platform: str = ""
    code: str = ""
    name: str = ""
    shares: Optional[float] = None
    buy_price: Optional[float] = None
    buy_date: str = ""
    confidence: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    evidence: str = ""
    source_filename: str = ""
    status: str = "review"


class OcrParseResponse(BaseModel):
    assets: list[OcrAssetItem]


class AssetsBatchCreate(BaseModel):
    assets: list[AssetCreate]

class RecommendationStatsResponse(BaseModel):
    id: int
    added_count: int
    removed_count: int
    maintained_count: int
    total_after: int
    summary: str
    created_at: datetime

    class Config:
        from_attributes = True
