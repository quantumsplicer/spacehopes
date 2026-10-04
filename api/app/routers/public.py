import base64
import datetime as dt
import random
import re
import secrets
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import and_, delete, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..config import cfg
from ..deps import DB, READER_COOKIE, OptReader, get_settings, limiter, published_only, reader_cookie_value
from ..models import (Block, Comment, CommentLike, ContactMessage, DailyStat, Media, Post, PostDailyRead,
                      PostTopic, ReaderAccount, ReaderOtp, Reaction, Subscriber, Topic, now)
from ..serializers import cards, iso, media_map
from ..services import content, moderation, storage
from ..services.mail import send_safe, wrap_html
from ..services.security import anon_hash, fingerprint, hash_code, safe_eq, token

router = APIRouter()
TZ = ZoneInfo(cfg.timezone)
BOT = re.compile(r"bot|crawl|spider|slurp|curl|wget|python-requests|httpx|headless|lighthouse|preview|monitor|scan", re.I)


def published():
    return and_(Post.status == "published", or_(Post.publish_at.is_(None), Post.publish_at <= func.now()))


async def turnstile(token_: str | None, request: Request):
    secret = cfg.turnstile_secret
    if not secret or secret.startswith("1x0000"):  # unset, or Cloudflare's public always-pass test secret
        return
    if not token_:
        raise HTTPException(400, "Please try again.")
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.post("https://challenges.cloudflare.com/turnstile/v0/siteverify",
                             data={"secret": secret, "response": token_, "remoteip": request.client.host if request.client else ""})
        ok = r.json().get("success")
    except Exception:  # noqa: BLE001
        ok = False
    if not ok:
        raise HTTPException(400, "Bot check failed. Please try again.")


# ---- Feed ------------------------------------------------------------------------------------------------------

@router.get("/feed")
async def feed(db: DB, type: Literal["thought", "blog"] | None = None, cursor: str | None = None, q: str | None = None,
               topic: str | None = None, month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"), limit: int = 10):
    limit = max(1, min(limit, 30))
    cond = [published()]
    if type:
        cond.append(Post.type == type)
    if topic:
        cond.append(Post.id.in_(select(PostTopic.post_id).join(Topic).where(Topic.slug == topic)))
    if month:
        y, m = map(int, month.split("-"))
        start = dt.datetime(y, m, 1, tzinfo=TZ)
        end = dt.datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=TZ)
        cond.append(and_(Post.publish_at >= start, Post.publish_at < end))
    stmt = select(Post).where(*cond)
    total = None
    if q and q.strip():
        tsq = func.websearch_to_tsquery("english", q.strip()[:100])
        stmt = stmt.where(Post.search_tsv.op("@@")(tsq)).order_by(func.ts_rank(Post.search_tsv, tsq).desc(), Post.id.desc())
        offset = int(cursor[2:]) if cursor and cursor.startswith("o:") and cursor[2:].isdigit() else 0
        rows = (await db.execute(stmt.offset(offset).limit(limit + 1))).scalars().all()
        nxt = f"o:{offset + limit}" if len(rows) > limit else None
        if not cursor:
            total = (await db.execute(select(func.count()).select_from(Post).where(*cond, Post.search_tsv.op("@@")(tsq)))).scalar()
    else:
        if cursor:
            try:
                ts, pid = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
                ts_ = dt.datetime.fromisoformat(ts)
                stmt = stmt.where(or_(Post.publish_at < ts_, and_(Post.publish_at == ts_, Post.id < int(pid))))
            except Exception:  # noqa: BLE001
                raise HTTPException(400, "Bad cursor")
        rows = (await db.execute(stmt.order_by(Post.publish_at.desc(), Post.id.desc()).limit(limit + 1))).scalars().all()
        nxt = None
        if len(rows) > limit:
            last = rows[limit - 1]
            nxt = base64.urlsafe_b64encode(f"{last.publish_at.isoformat()}|{last.id}".encode()).decode()
        if not cursor:
            total = (await db.execute(select(func.count()).select_from(Post).where(*cond))).scalar()
    return {"items": await cards(db, rows[:limit]), "next_cursor": nxt, "total": total}


@router.get("/topics")
async def topics(db: DB):
    rows = (await db.execute(
        select(Topic, func.count(Post.id)).join(PostTopic, PostTopic.topic_id == Topic.id).join(Post, Post.id == PostTopic.post_id)
        .where(published()).group_by(Topic.id).order_by(func.count(Post.id).desc(), Topic.name))).all()
    return [{"slug": t.slug, "name": t.name, "count": c} for t, c in rows]


@router.get("/drawings/latest")
async def latest_drawing(db: DB):
    """The newest drawing that appears in a published post (for the home sidebar)."""
    from sqlalchemy import String, cast
    for m in (await db.execute(select(Media).where(Media.kind == "drawing").order_by(Media.created_at.desc()).limit(12))).scalars():
        p = (await db.execute(select(Post).where(published(), cast(Post.body_json, String).op("~")(rf'"mediaId": {m.id}[,}}\s]'))
                              .order_by(Post.publish_at.desc()).limit(1))).scalar_one_or_none()
        if p:
            from ..serializers import media_out
            return {"media": media_out(m), "post": {"id": p.id, "type": p.type, "slug": p.slug, "title": p.title, "text": content.lead_text(p.body_json)}}
    return None


@router.get("/archive")
async def archive(db: DB):
    m = func.to_char(func.timezone(cfg.timezone, Post.publish_at), "YYYY-MM")
    rows = (await db.execute(select(m, func.count()).where(published()).group_by(m).order_by(m.desc()))).all()
    return [{"month": k, "count": c} for k, c in rows]


# ---- Posts ---------------------------------------------------------------------------------------------------

async def full_post(db, p: Post) -> dict:
    (card,) = await cards(db, [p])
    return {**card, "standfirst": p.standfirst, "body": p.body_json, "media": await media_map(db, p.body_json),
            "comments_open": p.comments_open, "cover": card["thumb"]}


@router.get("/posts/{slug}")
async def post_by_slug(slug: str, db: DB):
    p = (await db.execute(select(Post).where(Post.slug == slug, Post.type == "blog", published()))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Not found")
    return await full_post(db, p)


@router.get("/thoughts/latest")
async def latest_thought(db: DB):
    p = (await db.execute(select(Post).where(Post.type == "thought", published()).order_by(Post.publish_at.desc(), Post.id.desc()).limit(1))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "No thoughts yet")
    (c,) = await cards(db, [p])
    return c


@router.get("/thoughts/random")
async def random_thought(db: DB, response: Response, exclude: str | None = None):
    """A random thought, avoiding the ids in `exclude` (comma separated: the ones already shown). When every thought has
    been shown, it starts a new round, only avoiding the most recent one so it never repeats back to back."""
    response.headers["Cache-Control"] = "no-store"
    seen = [int(x) for x in (exclude or "").split(",") if x.strip().isdigit()][:100]
    ids = (await db.execute(select(Post.id).where(Post.type == "thought", published()))).scalars().all()
    if not ids:
        raise HTTPException(404, "No thoughts yet")
    fresh = [i for i in ids if i not in seen]
    if not fresh:
        fresh = [i for i in ids if i != (seen[-1] if seen else None)] or ids
    p = await db.get(Post, random.choice(fresh))
    (c,) = await cards(db, [p])
    return c


@router.get("/thoughts/{post_id}")
async def thought(post_id: int, db: DB):
    p = (await db.execute(select(Post).where(Post.id == post_id, Post.type == "thought", published()))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Not found")
    base = and_(Post.type == "thought", published())
    prev = (await db.execute(select(Post).where(base, tuple_(Post.publish_at, Post.id) < tuple_(p.publish_at, p.id))
                             .order_by(Post.publish_at.desc(), Post.id.desc()).limit(1))).scalar_one_or_none()
    nxt = (await db.execute(select(Post).where(base, tuple_(Post.publish_at, Post.id) > tuple_(p.publish_at, p.id))
                            .order_by(Post.publish_at, Post.id).limit(1))).scalar_one_or_none()
    out = await full_post(db, p)
    out["text"] = content.lead_text(p.body_json)
    f = lambda x: {"id": x.id, "text": content.lead_text(x.body_json)} if x else None  # noqa: E731
    return {**out, "prev": f(prev), "next": f(nxt)}


@router.get("/posts/{post_id}/related")
async def related(post_id: int, db: DB):
    p = await published_only(db, post_id)
    tids = [t.id for t in p.topics]

    async def pick(kind: str, n: int):
        shared = func.count(PostTopic.topic_id)
        q = select(Post).outerjoin(PostTopic, and_(PostTopic.post_id == Post.id, PostTopic.topic_id.in_(tids or [0]))) \
            .where(published(), Post.type == kind, Post.id != p.id).group_by(Post.id) \
            .order_by(shared.desc(), Post.publish_at.desc()).limit(n)
        return (await db.execute(q)).scalars().all()

    blogs, thoughts = await pick("blog", 2), await pick("thought", 1)
    return {"blogs": await cards(db, list(blogs)), "thoughts": await cards(db, list(thoughts))}


# ---- Reactions ---------------------------------------------------------------------------------------------

class ReactIn(BaseModel):
    kind: Literal["agree", "think"]


async def reaction_state(db, post_id: int, anon: str | None):
    rows = dict((await db.execute(select(Reaction.kind, func.count()).where(Reaction.post_id == post_id).group_by(Reaction.kind))).all())
    mine = []
    if anon:
        mine = (await db.execute(select(Reaction.kind).where(Reaction.post_id == post_id, Reaction.anon_id_hash == anon_hash(anon)))).scalars().all()
    return {"agree": rows.get("agree", 0), "think": rows.get("think", 0), "mine": list(mine)}


@router.get("/posts/{post_id}/reactions")
async def get_reactions(post_id: int, request: Request, db: DB):
    await published_only(db, post_id)
    return await reaction_state(db, post_id, request.headers.get("x-anon-id"))


@router.post("/posts/{post_id}/reactions")
@limiter.limit("60/minute")
async def react(post_id: int, body: ReactIn, request: Request, db: DB):
    await published_only(db, post_id)
    anon = request.headers.get("x-anon-id", "")
    if not 8 <= len(anon) <= 80:
        raise HTTPException(400, "Missing anonymous id")
    h = anon_hash(anon)
    existing = (await db.execute(select(Reaction).where(Reaction.post_id == post_id, Reaction.kind == body.kind, Reaction.anon_id_hash == h))).scalar_one_or_none()
    if existing:
        await db.delete(existing)
    else:
        db.add(Reaction(post_id=post_id, kind=body.kind, anon_id_hash=h))
    await db.commit()
    return await reaction_state(db, post_id, anon)


# ---- Comments ----------------------------------------------------------------------------------------------

def comment_out(c: Comment, replies: list | None = None) -> dict:
    return {"id": c.id, "name": "Author" if c.is_author else c.author_name, "body": c.body, "created_at": iso(c.created_at),
            "likes": c.likes, "is_author": c.is_author, "replies": replies or []}


@router.get("/posts/{post_id}/comments")
async def list_comments(post_id: int, db: DB, sort: Literal["liked", "new"] = "liked", offset: int = 0, limit: int = 10):
    await published_only(db, post_id)
    limit = max(1, min(limit, 30))
    base = and_(Comment.post_id == post_id, Comment.status == "approved")
    total = (await db.execute(select(func.count()).select_from(Comment).where(base))).scalar()
    order = [Comment.likes.desc(), Comment.created_at.desc()] if sort == "liked" else [Comment.created_at.desc()]
    tops = (await db.execute(select(Comment).where(base, Comment.parent_id.is_(None)).order_by(*order).offset(offset).limit(limit + 1))).scalars().all()
    has_more = len(tops) > limit
    tops = tops[:limit]
    reps = (await db.execute(select(Comment).where(base, Comment.parent_id.in_([c.id for c in tops] or [0])).order_by(Comment.created_at))).scalars().all()
    by: dict[int, list] = {}
    for r in reps:
        by.setdefault(r.parent_id, []).append(comment_out(r))
    return {"items": [comment_out(c, by.get(c.id)) for c in tops], "total": total, "has_more": has_more}


class CommentIn(BaseModel):
    name: str = Field(default="", max_length=60)
    body: str = Field(min_length=1, max_length=2000)
    parent_id: int | None = None
    website: str = ""  # honeypot: real people never fill this
    turnstile: str | None = None


LINK = re.compile(r"https?://|www\.|\b[a-z0-9-]+\.(com|net|org|in|io|co|xyz|ru|info)\b", re.I)


@router.post("/posts/{post_id}/comments", status_code=201)
@limiter.limit("20/hour")
async def post_comment(post_id: int, body: CommentIn, request: Request, db: DB, reader: OptReader):
    post = await published_only(db, post_id)
    st = await get_settings(db)
    if not post.comments_open:
        raise HTTPException(403, "Comments are closed on this post.")
    await turnstile(body.turnstile, request)
    fp = fingerprint(request)
    if (await db.execute(select(Block.id).where(Block.ip_hash == fp))).first():
        raise HTTPException(403, "You cannot comment here.")
    if st.comment_mode == "signed_in":
        if not reader:
            raise HTTPException(401, "Please sign in to comment.")
        name = reader.display_name
    else:
        name = re.sub(r"\s+", " ", body.name).strip()
        if not name:
            raise HTTPException(422, "Please add your name.")
    text = content.clean(body.body, 2000).strip()
    if not text:
        raise HTTPException(422, "Please write something.")
    parent = None
    if body.parent_id:
        parent = await db.get(Comment, body.parent_id)
        if not parent or parent.post_id != post_id or parent.status != "approved":
            raise HTTPException(404, "That comment is not available.")
        if parent.parent_id:
            parent = await db.get(Comment, parent.parent_id)  # threads go one level deep
    if body.website.strip():  # honeypot tripped: pretend success, store as spam
        db.add(Comment(post_id=post_id, author_name=name[:60], body=text, status="spam", flags=["honeypot"], ip_hash=fp))
        await db.commit()
        return {"status": "waiting"}
    recent = (await db.execute(select(func.count()).select_from(Comment).where(
        Comment.ip_hash == fp, Comment.created_at > now() - dt.timedelta(minutes=10)))).scalar()
    if recent >= 5:
        raise HTTPException(429, "You are commenting too quickly. Please wait a little.")
    flags = []
    links = len(LINK.findall(text))
    if links > 1:
        flags.append(f"{links} links")
    low = text.lower()
    if moderation.looks_abusive(text) or moderation.looks_abusive(name):  # generous on purpose: see services/moderation.py
        flags.append("possibly abusive")
    dup = (await db.execute(select(Comment.id).where(Comment.post_id == post_id, func.lower(Comment.body) == low).limit(1))).first()
    if dup:
        flags.append("duplicate")
    status = "waiting" if (st.review_comments or flags) else "approved"
    c = Comment(post_id=post_id, parent_id=parent.id if parent else None, author_name=name[:60], body=text,
                reader_account_id=reader.id if reader else None, status=status, flags=flags, ip_hash=fp)
    db.add(c)
    await db.commit()
    return {"status": status, "comment": comment_out(c) if status == "approved" else None}


@router.post("/comments/{comment_id}/like")
@limiter.limit("60/minute")
async def like_comment(comment_id: int, request: Request, db: DB):
    anon = request.headers.get("x-anon-id", "")
    if not 8 <= len(anon) <= 80:
        raise HTTPException(400, "Missing anonymous id")
    c = await db.get(Comment, comment_id)
    if not c or c.status != "approved":
        raise HTTPException(404, "Not found")
    h = anon_hash(anon)
    ex = await db.get(CommentLike, (comment_id, h))
    if ex:
        await db.delete(ex)
        c.likes = max(0, c.likes - 1)
        liked = False
    else:
        db.add(CommentLike(comment_id=comment_id, anon_hash=h))
        c.likes += 1
        liked = True
    await db.commit()
    return {"likes": c.likes, "liked": liked}


# ---- Subscribe ---------------------------------------------------------------------------------------------

class SubscribeIn(BaseModel):
    email: EmailStr
    website: str = ""
    turnstile: str | None = None


@router.post("/subscribe", status_code=202)
@limiter.limit("5/hour")
async def subscribe(body: SubscribeIn, request: Request, db: DB, bg: BackgroundTasks):
    if body.website:
        return {"ok": True}
    if not cfg.mail_configured:  # be honest rather than say "check your inbox" when nothing can be sent
        raise HTTPException(503, "Email sign-up is not switched on yet. Please check back soon.")
    await turnstile(body.turnstile, request)
    email = body.email.lower()
    sub = (await db.execute(select(Subscriber).where(Subscriber.email == email))).scalar_one_or_none()
    if sub and sub.status == "confirmed":
        return {"ok": True}  # same answer either way: do not reveal who is subscribed
    if not sub:
        sub = Subscriber(email=email, token=token())
        db.add(sub)
    else:
        sub.status, sub.token = "pending", token()
    await db.commit()
    link = f"{cfg.public_url}/api/v1/subscribe/confirm?token={sub.token}"
    bg.add_task(send_safe, email, "Confirm your subscription",
                f"Please confirm that you would like an email for each new post:\n\n{link}\n\nIf this was not you, ignore this message.",
                wrap_html(f'<p>Please confirm that you would like an email for each new post.</p><p><a href="{link}" style="color:#0f766e">Yes, confirm</a></p>'
                          "<p style=\"color:#6b6b6b;font-size:14px\">If this was not you, ignore this message.</p>"))
    return {"ok": True}


async def bump_daily(db, field: str, n: int = 1):
    today = dt.datetime.now(TZ).date()
    stmt = pg_insert(DailyStat).values(date=today, **{field: n})
    await db.execute(stmt.on_conflict_do_update(index_elements=[DailyStat.date], set_={field: getattr(DailyStat, field) + n}))


@router.get("/subscribe/confirm")
async def confirm(token: str, db: DB):
    sub = (await db.execute(select(Subscriber).where(Subscriber.token == token[:80]))).scalar_one_or_none()
    if not sub:
        return RedirectResponse(f"{cfg.public_url}/subscribed?ok=0", 303)
    if sub.status != "confirmed":
        sub.status, sub.confirmed_at = "confirmed", now()
        await bump_daily(db, "new_subscribers")
        await db.commit()
    return RedirectResponse(f"{cfg.public_url}/subscribed?ok=1", 303)


@router.get("/unsubscribe")
async def unsubscribe(token: str, db: DB):
    sub = (await db.execute(select(Subscriber).where(Subscriber.token == token[:80]))).scalar_one_or_none()
    if sub:
        sub.status = "unsubscribed"
        await db.commit()
    return RedirectResponse(f"{cfg.public_url}/subscribed?ok=2", 303)


# ---- Contact -----------------------------------------------------------------------------------------------

class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    topic: Literal["A response to a post", "General message", "Media", "Something else"]
    message: str = Field(min_length=3, max_length=4000)
    consent: bool
    website: str = ""
    turnstile: str | None = None


@router.post("/contact", status_code=201)
@limiter.limit("3/hour")
async def contact(body: ContactIn, request: Request, db: DB, bg: BackgroundTasks):
    if not body.consent:
        raise HTTPException(422, "Please agree to the privacy notice.")
    if body.website:
        return {"ok": True}
    await turnstile(body.turnstile, request)
    m = ContactMessage(name=content.clean(body.name, 80), email=body.email.lower(), topic=body.topic,
                       message=content.clean(body.message, 4000))
    db.add(m)
    await db.commit()
    bg.add_task(send_safe, cfg.owner_email, "New message through the contact form",
                f"From: {m.name} <{m.email}>\nAbout: {m.topic}\n\n{m.message}")
    return {"ok": True}


# ---- Analytics: aggregates only; no cookies, no IPs, no user agents stored ---------------------------

@router.post("/track/visit", status_code=204)
@limiter.limit("30/minute")
async def track_visit(request: Request, db: DB):
    if BOT.search(request.headers.get("user-agent", "")) or not request.headers.get("user-agent"):
        return Response(status_code=204)
    await bump_daily(db, "visitors")
    await db.commit()
    return Response(status_code=204)


class ReadIn(BaseModel):
    post_id: int


@router.post("/track/read", status_code=204)
@limiter.limit("60/minute")
async def track_read(body: ReadIn, request: Request, db: DB):
    if BOT.search(request.headers.get("user-agent", "")) or not request.headers.get("user-agent"):
        return Response(status_code=204)
    p = (await db.execute(select(Post).where(Post.id == body.post_id, Post.type == "blog", published()))).scalar_one_or_none()
    if not p:
        return Response(status_code=204)
    today = dt.datetime.now(TZ).date()
    await bump_daily(db, "readers")
    await db.execute(pg_insert(PostDailyRead).values(post_id=p.id, date=today, readers=1).on_conflict_do_update(
        index_elements=[PostDailyRead.post_id, PostDailyRead.date], set_={"readers": PostDailyRead.readers + 1}))
    await db.commit()
    return Response(status_code=204)


# ---- Public settings ---------------------------------------------------------------------------------

@router.get("/settings/public")
async def public_settings(db: DB):
    s = await get_settings(db)
    return {"site_name": s.site_name, "about_quote": s.about_quote, "about_byline": s.about_byline, "about_quote_confirmed": s.about_quote_confirmed,
            "footer_line": s.footer_line, "social_links": s.social_links, "comment_mode": s.comment_mode,
            "review_comments": s.review_comments, "disable_copy": s.disable_copy,
            "turnstile_site_key": cfg.turnstile_site_key, "google_enabled": bool(cfg.google_client_id)}


# ---- Media (private bucket, proxied) -----------------------------------------------------------------

MEDIA_NAME = re.compile(r"^(\d{3,4}\.(webp|avif)|full\.png|drawing\.svg)$")


@router.get("/media/{key}/{name}")
async def media_file(key: str, name: str, db: DB):
    if not MEDIA_NAME.match(name) or not re.match(r"^[A-Za-z0-9]{10,40}$", key):
        raise HTTPException(404)
    m = (await db.execute(select(Media).where(Media.prefix == f"m/{key}"))).scalar_one_or_none()
    if not m:
        raise HTTPException(404)
    got = await storage.get(f"{m.prefix}/{name}")
    if not got:
        raise HTTPException(404)
    data, ctype = got
    headers = {"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}
    if name.endswith(".svg"):
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
        ctype = "image/svg+xml"
    return Response(data, media_type=ctype, headers=headers)


# ---- Reader sign-in (only used when "signed-in readers only" is on) --------------------------------------

class OtpReq(BaseModel):
    email: EmailStr
    name: str = Field(default="", max_length=60)
    turnstile: str | None = None


@router.post("/reader/otp/request", status_code=202)
@limiter.limit("5/hour")
async def otp_request(body: OtpReq, request: Request, db: DB, bg: BackgroundTasks):
    if not cfg.mail_configured:
        raise HTTPException(503, "Sign-in by email code is not switched on yet.")
    await turnstile(body.turnstile, request)
    email = body.email.lower()
    code = f"{secrets.randbelow(10**6):06d}"
    await db.execute(delete(ReaderOtp).where(ReaderOtp.email == email))
    db.add(ReaderOtp(email=email, name=content.clean(body.name, 60).strip(), code_hash=hash_code(code),
                     expires_at=now() + dt.timedelta(minutes=10)))
    await db.commit()
    bg.add_task(send_safe, email, "Your sign-in code", f"Your one-time code is {code}. It works for 10 minutes.",
                wrap_html(f'<p>Your one-time code:</p><p style="font-size:32px;letter-spacing:6px;margin:8px 0">{code}</p>'
                          '<p style="color:#6b6b6b;font-size:14px">It works for 10 minutes.</p>'))
    return {"ok": True}


class OtpVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


def set_reader_cookie(resp: Response, rid: int):
    resp.set_cookie(READER_COOKIE, reader_cookie_value(rid), max_age=60 * 60 * 24 * 30, httponly=True,
                    secure=not cfg.is_dev, samesite="strict", path="/")


@router.post("/reader/otp/verify")
@limiter.limit("20/hour")
async def otp_verify(body: OtpVerify, request: Request, response: Response, db: DB):
    email = body.email.lower()
    otp = (await db.execute(select(ReaderOtp).where(ReaderOtp.email == email))).scalar_one_or_none()
    if not otp or otp.expires_at < now() or otp.attempts >= 5:
        raise HTTPException(400, "That code has expired. Please ask for a new one.")
    otp.attempts += 1
    if not safe_eq(otp.code_hash, hash_code(body.code)):
        await db.commit()
        raise HTTPException(400, "That code is not right.")
    acct = (await db.execute(select(ReaderAccount).where(ReaderAccount.email == email))).scalar_one_or_none()
    if not acct:
        acct = ReaderAccount(email=email, display_name=otp.name or "Reader", provider="otp")
        db.add(acct)
        await db.flush()
    elif otp.name:
        acct.display_name = otp.name
    await db.delete(otp)
    await db.commit()
    set_reader_cookie(response, acct.id)
    return {"name": acct.display_name}


@router.get("/reader/me")
async def reader_me(reader: OptReader):
    return {"name": reader.display_name} if reader else {"name": None}


@router.post("/reader/logout", status_code=204)
async def reader_logout(response: Response):
    response.delete_cookie(READER_COOKIE, path="/")


@router.get("/reader/google/start")
async def google_start(request: Request):
    if not cfg.google_client_id:
        raise HTTPException(501, "Google sign-in is not set up. Use the email code instead.")
    state = token()
    url = ("https://accounts.google.com/o/oauth2/v2/auth?response_type=code&scope=openid%20profile"
           f"&client_id={cfg.google_client_id}&redirect_uri={cfg.public_url}/api/v1/reader/google/callback&state={state}")
    r = RedirectResponse(url, 303)
    r.set_cookie("g_state", state, max_age=600, httponly=True, secure=not cfg.is_dev, samesite="lax", path="/api/v1/reader/google")
    return r


@router.get("/reader/google/callback")
async def google_callback(request: Request, db: DB, code: str = "", state: str = ""):
    if not cfg.google_client_id or not state or not safe_eq(state, request.cookies.get("g_state", "")):
        raise HTTPException(400, "Sign-in failed. Please try again.")
    async with httpx.AsyncClient(timeout=10) as c:
        t = (await c.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": cfg.google_client_id, "client_secret": cfg.google_client_secret,
            "redirect_uri": f"{cfg.public_url}/api/v1/reader/google/callback", "grant_type": "authorization_code"})).json()
        info = (await c.get("https://openidconnect.googleapis.com/v1/userinfo",
                            headers={"Authorization": f"Bearer {t.get('access_token', '')}"})).json()
    if "sub" not in info:
        raise HTTPException(400, "Sign-in failed. Please try again.")
    email = f"google:{info['sub']}"  # we store only an opaque id; the Google email is never kept
    acct = (await db.execute(select(ReaderAccount).where(ReaderAccount.email == email))).scalar_one_or_none()
    if not acct:
        acct = ReaderAccount(email=email, display_name=(info.get("given_name") or "Reader")[:60], provider="google")
        db.add(acct)
        await db.flush()
    await db.commit()
    r = RedirectResponse(f"{cfg.public_url}/", 303)
    set_reader_cookie(r, acct.id)
    return r
