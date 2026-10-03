import datetime as dt
import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from itsdangerous import BadSignature, TimestampSigner
from slowapi import Limiter
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import cfg
from .db import get_db
from .models import AuditLog, ReaderAccount, Session, SiteSettings, User, now
from .services.security import client_ip, fingerprint, safe_eq, sha256

log = logging.getLogger("security")
limiter = Limiter(key_func=client_ip, enabled=cfg.rate_limit_enabled)

DB = Annotated[AsyncSession, Depends(get_db)]
SESSION_COOKIE = "sid"
READER_COOKIE = "reader"
ABSOLUTE = dt.timedelta(hours=12)
IDLE = dt.timedelta(minutes=30)
signer = TimestampSigner(cfg.secret_key, salt="reader")


async def get_settings(db: AsyncSession) -> SiteSettings:
    s = await db.get(SiteSettings, 1)
    if s is None:
        s = SiteSettings(id=1)
        db.add(s)
        await db.commit()
    return s


async def audit(db: AsyncSession, request: Request | None, user_id: int | None, action: str,
                target: str | None = None, detail: dict | None = None):
    db.add(AuditLog(user_id=user_id, action=action, target=target, detail=detail,
                    ip_hash=fingerprint(request) if request else None))
    log.info("audit user=%s action=%s target=%s", user_id, action, target)  # no personal data in logs


# ---- Studio sessions -------------------------------------------------------------------------------------------

class Auth:
    def __init__(self, user: User, session: Session):
        self.user, self.session = user, session


async def _load(request: Request, db: AsyncSession, need_full: bool, write: bool) -> Auth:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Not signed in")
    s = await db.get(Session, sha256(token))
    t = now()
    if not s or s.expires_at < t or t - s.last_seen_at > IDLE:
        if s:
            await db.delete(s)
            await db.commit()
        raise HTTPException(401, "Session expired")
    if need_full and s.stage != "full":
        raise HTTPException(401, "Second step required")
    if write or request.method not in ("GET", "HEAD", "OPTIONS"):
        if not safe_eq(request.headers.get("x-csrf-token", ""), s.csrf):
            raise HTTPException(403, "Bad CSRF token")
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != cfg.public_url.rstrip("/"):
            raise HTTPException(403, "Bad origin")
    s.last_seen_at = t
    user = await db.get(User, s.user_id)
    if not user:
        raise HTTPException(401, "No such user")
    if need_full and user.must_change_password and cfg.enforce_password_change and not request.url.path.endswith("/auth/password"):
        raise HTTPException(403, "password_change_required")  # the starting password must be replaced before anything else
    await db.commit()
    return Auth(user, s)


async def pre_auth(request: Request, db: DB) -> Auth:
    return await _load(request, db, need_full=False, write=False)


async def staff(request: Request, db: DB) -> Auth:
    """Owner or editor, signed in."""
    return await _load(request, db, need_full=True, write=False)


async def owner(request: Request, db: DB) -> Auth:
    a = await _load(request, db, need_full=True, write=False)
    if a.user.role != "owner":
        raise HTTPException(403, "Owner only")
    return a


Staff = Annotated[Auth, Depends(staff)]
Owner = Annotated[Auth, Depends(owner)]


# ---- Reader sessions (sign-in mode) --------------------------------------------------------------------------

def reader_cookie_value(reader_id: int) -> str:
    return signer.sign(str(reader_id)).decode()


async def optional_reader(request: Request, db: DB) -> ReaderAccount | None:
    raw = request.cookies.get(READER_COOKIE)
    if not raw:
        return None
    try:
        rid = int(signer.unsign(raw, max_age=60 * 60 * 24 * 30).decode())
    except (BadSignature, ValueError):
        return None
    return await db.get(ReaderAccount, rid)


OptReader = Annotated[ReaderAccount | None, Depends(optional_reader)]


async def reaping(db: AsyncSession):
    t = now()
    await db.execute(update(Session).where(Session.expires_at < t).values(stage="expired"))
    await db.commit()


async def published_only(db: AsyncSession, post_id: int):
    from .models import Post
    p = (await db.execute(select(Post).where(Post.id == post_id, Post.status == "published"))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Not found")
    return p
