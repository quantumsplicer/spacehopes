import os
import subprocess
import sys

# A throwaway database and bucket: tests never touch development data.
BASE = os.environ.get("DATABASE_URL", "postgresql+asyncpg://thoughts:thoughts@db:5432/thoughts")
TEST_URL = BASE.rsplit("/", 1)[0] + "/thoughts_test"
os.environ.update(DATABASE_URL=TEST_URL, S3_BUCKET="thoughts-test", RATE_LIMIT_ENABLED="false", ENV="dev")

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import cfg  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def database():
    import asyncio

    async def make():
        admin = BASE.replace("+asyncpg", "").rsplit("/", 1)[0] + "/postgres"
        conn = await asyncpg.connect(admin)
        await conn.execute("DROP DATABASE IF EXISTS thoughts_test WITH (FORCE)")
        await conn.execute("CREATE DATABASE thoughts_test")
        await conn.close()
    asyncio.run(make())
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, env=os.environ)
    yield


@pytest_asyncio.fixture(scope="session")
async def app_client(database):
    from app.main import app
    from app.services import storage
    await storage.ensure_bucket()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", headers={"user-agent": "Mozilla/5.0 (pytest)"}) as c:
        yield c


@pytest_asyncio.fixture
async def client(app_client):
    app_client.cookies.clear()
    app_client.headers.pop("x-csrf-token", None)
    return app_client


@pytest_asyncio.fixture(autouse=True)
async def clean(database):
    from app.db import SessionLocal
    async with SessionLocal() as db:
        await db.execute(text("""TRUNCATE comments, blocks, reactions, subscribers, contact_messages, daily_stats, post_daily_reads,
            post_topics, post_versions, posts, media, topics, sessions, auth_failures,
            reader_otps, reader_accounts, users, settings RESTART IDENTITY CASCADE"""))
        await db.commit()


PASSWORD = "Correct-Horse-9-Battery"


async def make_user(role="owner", login="owner", password=PASSWORD, must_change=False):
    from app.db import SessionLocal
    from app.models import User
    from app.services.passwords import hash_password
    async with SessionLocal() as db:
        db.add(User(login_id=login, email=f"{login}@example.com", name=role, role=role, password_hash=hash_password(password),
                    must_change_password=must_change))
        await db.commit()
    return login, password


async def sign_in(client, login="owner", password=PASSWORD):
    r = await client.post("/api/v1/studio/auth/login", json={"login_id": login, "password": password})
    assert r.status_code == 200, r.text
    client.headers["x-csrf-token"] = r.json()["csrf"]
    return r


@pytest_asyncio.fixture
async def owner(client):
    await make_user("owner", "owner")
    await sign_in(client, "owner")
    return client


@pytest_asyncio.fixture
async def make_blog(owner):
    async def go(title="A real title", text="Some words to read.", publish=True):
        r = await owner.post("/api/v1/studio/posts", json={"type": "blog"})
        pid = r.json()["id"]
        body = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}
        r = await owner.put(f"/api/v1/studio/posts/{pid}", json={"title": title, "body": body})
        assert r.status_code == 200, r.text
        if publish:
            r = await owner.post(f"/api/v1/studio/posts/{pid}/publish")
            assert r.status_code == 200, r.text
        return r.json()
    return go
