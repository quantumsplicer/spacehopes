from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from .config import cfg

engine = create_async_engine(cfg.database_url, pool_pre_ping=True, pool_size=5, max_overflow=3)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    async with SessionLocal() as session:
        yield session
