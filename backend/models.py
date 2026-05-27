from sqlalchemy import Column, Integer, String, Float, Text, DateTime, Boolean
from database import Base
from datetime import datetime


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    asset_type = Column(String(20), nullable=False)  # stock, offshore_fund, onshore_fund
    market = Column(String(10), nullable=False)  # A, HK, US
    platform = Column(String(50), nullable=False)
    code = Column(String(20), nullable=False)
    name = Column(String(100), default="")
    shares = Column(Float, nullable=False)
    buy_price = Column(Float, nullable=False)
    buy_date = Column(String(20), nullable=False)
    current_price = Column(Float, default=0.0)
    price_updated_at = Column(String(20), default="")
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AssetTransaction(Base):
    __tablename__ = "asset_transactions"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, nullable=False, index=True)
    trade_type = Column(String(10), nullable=False)  # buy, sell
    trade_date = Column(String(20), nullable=False)
    shares = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    fee = Column(Float, default=0.0)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class AnalysisRecord(Base):
    __tablename__ = "analysis_records"

    id = Column(Integer, primary_key=True, index=True)
    summary = Column(Text, default="")
    detail = Column(Text, default="")
    total_market_value = Column(Float, default=0.0)
    total_cost = Column(Float, default=0.0)
    total_pnl = Column(Float, default=0.0)
    total_pnl_percent = Column(Float, default=0.0)
    realized_pnl = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)


class Settings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InstalledSkill(Base):
    __tablename__ = "installed_skills"

    id = Column(Integer, primary_key=True, index=True)
    skill_id = Column(String(100), unique=True, nullable=False)
    enabled = Column(Boolean, default=True)
    installed_at = Column(DateTime, default=datetime.utcnow)


class Target(Base):
    __tablename__ = "targets"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), default="")
    name = Column(String(100), nullable=False)
    market = Column(String(10), default="A")
    asset_type = Column(String(20), default="stock")
    source = Column(String(20), default="manual")  # manual, ai_recommended
    reason = Column(Text, default="")
    priority = Column(String(10), default="MEDIUM")  # HIGH, MEDIUM, LOW
    risk_level = Column(String(10), default="MEDIUM")
    expected_return = Column(String(50), default="")
    status = Column(String(20), default="active")  # active, removed
    note = Column(Text, default="")
    ai_analysis = Column(Text, default="")
    last_analyzed_at = Column(String(20), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
