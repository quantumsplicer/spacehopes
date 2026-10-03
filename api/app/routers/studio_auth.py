"""Studio sign-in with a login ID and password.

Defences, in order of what an attacker who can only see the login page would try:
  * guessing: every failure is recorded per connection AND per login ID, with exponentially growing waits (the
    answer is HTTP 429 + Retry-After), a scrypt hash that costs real memory/time, and a slowapi per-minute cap;
  * enumeration: unknown login IDs run the same scrypt and get the same message and the same throttling;
  * bots: Cloudflare Turnstile (when configured);
  * stealing a session: random token in an httpOnly, Secure, SameSite=Strict cookie, only its hash is stored,
    CSRF header + Origin check on every write, 12 h absolute / 30 min idle timeouts, sessions rotated on sign-in
    and on password change (all other sessions are revoked).
"""
import asyncio
import datetime as dt
import re

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select

from ..config import cfg
from ..deps import ABSOLUTE, DB, SESSION_COOKIE, Auth, Owner, Staff, _load, audit, limiter
from ..models import AuthFailure, Session, User, now
from ..routers.public import turnstile
from ..services.mail import send_safe
from ..services.passwords import LOGIN_ID, hash_password, policy_error, verify_or_dummy, verify_password
from ..services.security import _h, device_label, fingerprint, ip_only_hash, sha256, token

router = APIRouter()
BAD = "Incorrect login ID or password."
WINDOW = dt.timedelta(minutes=15)


def wait_seconds(failures: int, free: int, base: int = 15, cap: int = 900) -> int:
    """No wait for the first `free` failures, then 15 s, 30 s, 60 s ... up to 15 minutes."""
    return 0 if failures <= free else min(cap, base * 2 ** (failures - free - 1))


def _keys(request: Request, scope: str, ident: str) -> list[tuple[str, int]]:
    # (key, free attempts). The per-identity key is looser so a stranger cannot easily lock the real owner out,
    # but it still slows a distributed guessing attempt on one account.
    return [(_h("thr", scope, "ip", ip_only_hash(request)), 3), (_h("thr", scope, "id", ident.lower()), 6)]


async def check_throttle(db, request: Request, scope: str, ident: str):
    t = now()
    worst, msg = 0, ""
    for key, free in _keys(request, scope, ident):
        n, last = (await db.execute(select(func.count(), func.max(AuthFailure.created_at)).where(
            AuthFailure.key == key, AuthFailure.created_at > t - WINDOW))).one()
        if not n:
            continue
        left = int(wait_seconds(n, free) - (t - last).total_seconds())
        if left > worst:
            worst = left
    if worst > 0:
        raise HTTPException(429, detail={"message": f"Too many attempts. Try again in {worst} seconds.", "retry_after": worst},
                            headers={"Retry-After": str(worst)})


async def record_failure(db, request: Request, scope: str, ident: str):
    for key, _ in _keys(request, scope, ident):
        db.add(AuthFailure(key=key))
    await audit(db, request, None, f"auth.fail.{scope}")  # never stores what was typed
    await db.commit()


async def clear_failures(db, request: Request, scope: str, ident: str):
    await db.execute(delete(AuthFailure).where(AuthFailure.key.in_([k for k, _ in _keys(request, scope, ident)])))


def origin_ok(request: Request):
    o = request.headers.get("origin")
    if o and o.rstrip("/") != cfg.public_url.rstrip("/"):
        raise HTTPException(403, "Bad origin")


async def start_session(db, request: Request, response: Response, user: User) -> Session:
    raw = token()
    s = Session(id=sha256(raw), user_id=user.id, stage="full", csrf=token(), expires_at=now() + ABSOLUTE,
                ip_hash=fingerprint(request), user_agent=request.headers.get("user-agent", "")[:200])
    db.add(s)
    await db.commit()
    response.set_cookie(SESSION_COOKIE, raw, httponly=True, secure=not cfg.is_dev, samesite="strict", path="/")
    return s


class LoginIn(BaseModel):
    login_id: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    turnstile: str | None = None


@router.post("/login")
@limiter.limit("20/minute")
async def login(body: LoginIn, request: Request, response: Response, db: DB):
    origin_ok(request)
    ident = body.login_id.strip().lower()
    await check_throttle(db, request, "login", ident)
    await turnstile(body.turnstile, request)
    user = (await db.execute(select(User).where(User.login_id == ident))).scalar_one_or_none()
    # scrypt takes ~100 ms; run it off the event loop. Unknown users get the same work (verify_or_dummy).
    ok = await asyncio.to_thread(verify_or_dummy, body.password, user.password_hash if user else None)
    if not (user and ok):
        await record_failure(db, request, "login", ident)
        # a failure that crosses a threshold already shows the wait on the next attempt; the message stays generic
        raise HTTPException(401, BAD)
    await clear_failures(db, request, "login", ident)
    prev_at, prev_dev = user.last_login_at, user.last_login_device
    dev = device_label(request.headers.get("user-agent", ""))
    user.last_login_at, user.last_login_device = now(), dev
    # any session cookie sent along is replaced: a fresh session on every sign-in
    old = request.cookies.get(SESSION_COOKIE)
    if old:
        await db.execute(delete(Session).where(Session.id == sha256(old)))
    await audit(db, request, user.id, "auth.signin", detail={"device": dev})
    s = await start_session(db, request, response, user)
    asyncio.create_task(send_safe(user.email, "New sign-in to your Studio",
                                  f"Someone signed in to the Studio just now ({dev}). If this was not you, change your password "
                                  "straight away from Settings."))
    return {"csrf": s.csrf, "must_change": user.must_change_password,
            "previous_login_at": prev_at.isoformat() if prev_at else None, "previous_device": prev_dev}


@router.get("/me")
async def me(request: Request, db: DB):
    try:
        a = await _load(request, db, need_full=False, write=False)
    except HTTPException:
        return {"authenticated": False}
    u = a.user
    return {"authenticated": a.session.stage == "full", "csrf": a.session.csrf, "must_change": u.must_change_password,
            "user": {"id": u.id, "login_id": u.login_id, "email": u.email, "name": u.name, "role": u.role},
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None, "last_login_device": u.last_login_device}


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: DB):
    origin_ok(request)
    raw = request.cookies.get(SESSION_COOKIE)
    if raw:
        await db.execute(delete(Session).where(Session.id == sha256(raw)))
        await db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


class PasswordIn(BaseModel):
    old_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)
    new_login_id: str | None = Field(default=None, max_length=64)


@router.post("/password")
@limiter.limit("10/minute")
async def change_password(body: PasswordIn, request: Request, response: Response, a: Staff, db: DB):
    """Change the password (and optionally the login ID). The current password must be confirmed first, with its own
    throttle, so a stolen session alone cannot take over the account."""
    u = a.user
    await check_throttle(db, request, "pw", str(u.id))
    if not await asyncio.to_thread(verify_password, body.old_password, u.password_hash):
        await record_failure(db, request, "pw", str(u.id))
        raise HTTPException(401, "The current password is not right.")
    new_login = (body.new_login_id or u.login_id).strip().lower()
    if not LOGIN_ID.match(new_login):
        raise HTTPException(422, "A login ID is 3 to 32 characters: lower-case letters, numbers, dot, dash or underscore.")
    if new_login != u.login_id and (await db.execute(select(User.id).where(User.login_id == new_login))).first():
        raise HTTPException(409, "That login ID is taken.")
    err = policy_error(body.new_password, new_login, body.old_password)
    if err:
        raise HTTPException(422, err)
    await clear_failures(db, request, "pw", str(u.id))
    u.password_hash = await asyncio.to_thread(hash_password, body.new_password)
    u.login_id, u.must_change_password, u.password_changed_at = new_login, False, now()
    # revoke every session (including this one) and hand back a fresh one
    await db.execute(delete(Session).where(Session.user_id == u.id))
    await audit(db, request, u.id, "auth.password_changed", detail={"login_id_changed": new_login != a.user.login_id})
    s = await start_session(db, request, response, u)
    asyncio.create_task(send_safe(u.email, "Your Studio password was changed",
                                  "Your Studio password was just changed and you were signed out everywhere else. "
                                  "If this was not you, you need to reset it with the server operator immediately."))
    return {"ok": True, "csrf": s.csrf, "login_id": new_login}


class NewEditor(BaseModel):
    login_id: str = Field(max_length=64)
    email: EmailStr
    name: str = Field(default="", max_length=80)
    password: str = Field(max_length=256)


@router.post("/editors", status_code=201)
async def create_editor(body: NewEditor, request: Request, a: Owner, db: DB):
    """Owner adds an editor (draft + moderate only). The owner chooses a first password and shares it privately;
    the editor must change it at first sign-in."""
    login = body.login_id.strip().lower()
    if not LOGIN_ID.match(login):
        raise HTTPException(422, "A login ID is 3 to 32 characters: lower-case letters, numbers, dot, dash or underscore.")
    err = policy_error(body.password, login)
    if err:
        raise HTTPException(422, err)
    if (await db.execute(select(User.id).where((User.login_id == login) | (User.email == body.email.lower())))).first():
        raise HTTPException(409, "That login ID or email already has an account.")
    u = User(login_id=login, email=body.email.lower(), name=body.name, role="editor", must_change_password=True,
             password_hash=await asyncio.to_thread(hash_password, body.password))
    db.add(u)
    await db.flush()
    await audit(db, request, a.user.id, "user.editor_created", target=str(u.id))
    await db.commit()
    return {"id": u.id, "login_id": login}
