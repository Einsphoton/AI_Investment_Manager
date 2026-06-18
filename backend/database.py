from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

_db_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
os.makedirs(_db_dir, exist_ok=True)
_db_path = os.path.join(_db_dir, 'investment.db')
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_db_path}")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate():
    """Add columns missing in existing DB (SQLite's create_all doesn't alter)."""
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    for table, col_defs in [
        ("analysis_records", [("asset_id", "INTEGER REFERENCES assets(id)")]),
        ("assets", [("source", "VARCHAR(20) DEFAULT 'manual'")]),
        ("ipo_analysis_records", [
            ("markets", "VARCHAR(50) DEFAULT ''"),
            ("items_json", "TEXT DEFAULT '[]'"),
            ("result_json", "TEXT DEFAULT '{}'"),
            ("source_status_json", "TEXT DEFAULT '{}'"),
        ]),
        ("investment_advice_records", [
            ("ipo_advice_json", "TEXT DEFAULT '[]'"),
        ]),
        ("ipo_trade_records", [
            ("ipo_id", "VARCHAR(100) DEFAULT ''"),
            ("code", "VARCHAR(30) DEFAULT ''"),
            ("name", "VARCHAR(100) DEFAULT ''"),
            ("market", "VARCHAR(10) DEFAULT ''"),
            ("platform", "VARCHAR(50) DEFAULT ''"),
            ("currency", "VARCHAR(10) DEFAULT 'CNY'"),
            ("trade_type", "VARCHAR(20) DEFAULT ''"),
            ("shares", "FLOAT DEFAULT 0"),
            ("price", "FLOAT DEFAULT 0"),
            ("fee", "FLOAT DEFAULT 0"),
            ("trade_date", "VARCHAR(20) DEFAULT ''"),
            ("follow_up_date", "VARCHAR(20) DEFAULT ''"),
            ("realized_pnl", "FLOAT DEFAULT 0"),
            ("analysis_snapshot_json", "TEXT DEFAULT '{}'"),
            ("advice_snapshot_json", "TEXT DEFAULT '{}'"),
            ("note", "TEXT DEFAULT ''"),
            ("created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"),
        ]),
    ]:
        if not inspector.has_table(table):
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        for col_name, col_type in col_defs:
            if col_name not in existing:
                with engine.connect() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"))
                    conn.commit()


def init_db():
    import models
    Base.metadata.create_all(bind=engine)
    _migrate()
