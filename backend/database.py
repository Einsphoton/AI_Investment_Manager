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


def init_db():
    import models
    Base.metadata.create_all(bind=engine)
