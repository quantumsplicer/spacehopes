import csv
import datetime as dt
import io
import json
import re
import secrets
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, cast, delete, func, or_, select, String

from ..config import cfg
from ..deps import DB, Owner, Staff, audit, get_settings
from ..models import (AuditLog, Block, Comment, ContactMessage, DailyStat, Media, Post, PostDailyRead, PostTopic,
                      PostVersion, Reaction, Subscriber, Topic, now)
from ..serializers import cards, iso, media_map, media_out
from ..services import content, drawing, images, storage
from ..services.publishing import PublishError, publish, unique_slug, validate_for_publish

router = APIRouter()
TZ = ZoneInfo(cfg.timezone)


# ---- Posts -----------------------------------------------------------------------------------------------------

class PostIn(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    standfirst: str | None = Field(default=None, max_length=500)
    body: dict | None = None
    excerpt: str | None = Field(default=None, max_length=500)
    cover_media_id: int | None = None
    topics: list[str] | None = None
    comments_open: bool | None = None
    type: Literal["thought", "blog"] | None = None
    base_updated_at: str | None = None  # conflict detection


async def studio_post(db, p: Post) -> dict:
    (card,) = await cards(db, [p])
    return {**card, "standfirst": p.standfirst, "status": p.status, "body": p.body_json, "media": await media_map(db, p.body_json),
            "comments_open": p.comments_open, "excerpt_custom": p.excerpt, "updated_at": p.updated_at.isoformat(),
            "created_at": iso(p.created_at), "publish_at": iso(p.publish_at), "cover_media_id": p.cover_media_id}


async def get_topics(db, names: list[str]) -> list[Topic]:
    out = []
    for n in names[:12]:
        n = content.clean(n, 60).strip()
        if not n:
            continue
        slug = content.slugify(n)
        t = (await db.execute(select(Topic).where(Topic.slug == slug))).scalar_one_or_none()
        if not t:
            t = Topic(slug=slug, name=n)
            db.add(t)
            await db.flush()
        out.append(t)
    return out


@router.post("/posts", status_code=201)
async def create_post(body: PostIn, request: Request, a: Staff, db: DB):
    p = Post(type=body.type or "thought", body_json={"type": "doc", "content": []}, status="draft", title=None)
    db.add(p)
    await db.flush()
    await audit(db, request, a.user.id, "post.created", target=str(p.id))
    await db.commit()
    await db.refresh(p)
    return await studio_post(db, p)


@router.get("/posts")
async def list_posts(a: Staff, db: DB, status: str | None = None, type: str | None = None, q: str | None = None):
    stmt = select(Post).order_by(Post.updated_at.desc()).limit(200)
    if status:
        stmt = stmt.where(Post.status == status)
    if type:
        stmt = stmt.where(Post.type == type)
    if q:
        stmt = stmt.where(or_(Post.title.ilike(f"%{q[:60]}%"), Post.body_text.ilike(f"%{q[:60]}%")))
    rows = (await db.execute(stmt)).scalars().all()
    reads = dict((await db.execute(select(PostDailyRead.post_id, func.sum(PostDailyRead.readers)).group_by(PostDailyRead.post_id))).all())
    pend = dict((await db.execute(select(Comment.post_id, func.count()).where(Comment.status == "waiting").group_by(Comment.post_id))).all())
    cs = await cards(db, list(rows))
    return [{**c, "status": p.status, "updated_at": p.updated_at.isoformat(), "publish_at": iso(p.publish_at),
             "readers": int(reads.get(p.id, 0)), "waiting": pend.get(p.id, 0), "text": content.lead_text(p.body_json)}
            for c, p in zip(cs, rows)]


@router.get("/posts/{post_id}")
async def get_post(post_id: int, a: Staff, db: DB):
    p = await db.get(Post, post_id)
    if not p:
        raise HTTPException(404)
    return await studio_post(db, p)


@router.put("/posts/{post_id}")
async def update_post(post_id: int, body: PostIn, request: Request, a: Staff, db: DB):
    p = await db.get(Post, post_id)
    if not p:
        raise HTTPException(404)
    if a.user.role != "owner" and p.status != "draft":
        raise HTTPException(403, "Editors can only change drafts.")
    if body.base_updated_at:
        try:
            if dt.datetime.fromisoformat(body.base_updated_at) != p.updated_at:
                raise HTTPException(409, detail={"message": "This post was changed somewhere else.", "latest": await studio_post(db, p)})
        except ValueError:
            raise HTTPException(400, "Bad timestamp")
    if body.type and body.type != p.type and p.status == "draft":
        p.type = body.type
    if body.title is not None:
        p.title = content.clean(body.title, 240).strip() or None
    if body.standfirst is not None:
        p.standfirst = content.clean(body.standfirst, 500).strip() or None
    if body.body is not None:
        try:
            nb = content.normalize_body(body.body)
        except ValueError as e:
            raise HTTPException(422, str(e))
        ids = set(content.media_ids(nb))
        if ids:
            have = set((await db.execute(select(Media.id).where(Media.id.in_(ids)))).scalars().all())
            if ids - have:
                raise HTTPException(422, "A picture in this post no longer exists.")
        if p.type == "thought":  # one text block, then one drawing or up to 4 images
            pics = [n for n in nb["content"] if n["type"] in ("image", "drawing")]
            drawn = [n for n in pics if n["type"] == "drawing"]
            pics = drawn[:1] if drawn else pics[:4]
            nb["content"] = [n for n in nb["content"] if n["type"] == "paragraph"][:1] + pics
        p.body_json = nb
        p.body_text = content.plain_text(nb)
        p.read_minutes = content.read_minutes(p.body_text)
    if p.type == "thought":
        mids = content.media_ids(p.body_json)
        p.cover_media_id = mids[0] if mids else None
    elif "cover_media_id" in body.model_fields_set:
        p.cover_media_id = body.cover_media_id
    if body.excerpt is not None:
        p.excerpt = content.clean(body.excerpt, 500).strip()
    if not p.excerpt or body.excerpt == "":
        p.excerpt = content.make_excerpt(p.body_json)
    if body.topics is not None:
        p.topics = await get_topics(db, body.topics)
    if body.comments_open is not None:
        p.comments_open = body.comments_open
    p.updated_at = now()
    last = (await db.execute(select(PostVersion).where(PostVersion.post_id == p.id).order_by(PostVersion.created_at.desc()).limit(1))).scalar_one_or_none()
    if body.body is not None and (not last or now() - last.created_at > dt.timedelta(minutes=2)) and p.body_text:
        db.add(PostVersion(post_id=p.id, title=p.title, standfirst=p.standfirst, body_json=p.body_json, author_id=a.user.id))
    await db.commit()
    await db.refresh(p)
    return await studio_post(db, p)


@router.get("/posts/{post_id}/versions")
async def versions(post_id: int, a: Staff, db: DB):
    rows = (await db.execute(select(PostVersion).where(PostVersion.post_id == post_id).order_by(PostVersion.created_at.desc()).limit(50))).scalars().all()
    return [{"id": v.id, "created_at": iso(v.created_at), "title": v.title, "words": len(content.plain_text(v.body_json).split())} for v in rows]


@router.post("/posts/{post_id}/versions/{vid}/restore")
async def restore_version(post_id: int, vid: int, request: Request, a: Staff, db: DB):
    p, v = await db.get(Post, post_id), await db.get(PostVersion, vid)
    if not p or not v or v.post_id != post_id:
        raise HTTPException(404)
    if a.user.role != "owner" and p.status != "draft":
        raise HTTPException(403)
    db.add(PostVersion(post_id=p.id, title=p.title, standfirst=p.standfirst, body_json=p.body_json, author_id=a.user.id))
    p.title, p.standfirst, p.body_json = v.title, v.standfirst, v.body_json
    p.body_text = content.plain_text(p.body_json)
    p.excerpt = content.make_excerpt(p.body_json)
    p.updated_at = now()
    await audit(db, request, a.user.id, "post.version_restored", target=str(p.id))
    await db.commit()
    await db.refresh(p)
    return await studio_post(db, p)


@router.post("/posts/{post_id}/publish")
async def publish_post(post_id: int, request: Request, a: Owner, db: DB):
    p = await db.get(Post, post_id)
    if not p:
        raise HTTPException(404)
    try:
        await publish(db, p)
    except PublishError as e:
        raise HTTPException(422, str(e))
    await audit(db, request, a.user.id, "post.published", target=str(p.id))
    await db.commit()
    await db.refresh(p)
    return await studio_post(db, p)


class ScheduleIn(BaseModel):
    publish_at: dt.datetime


@router.post("/posts/{post_id}/schedule")
async def schedule_post(post_id: int, body: ScheduleIn, request: Request, a: Owner, db: DB):
    p = await db.get(Post, post_id)
    if not p:
        raise HTTPException(404)
    when = body.publish_at if body.publish_at.tzinfo else body.publish_at.replace(tzinfo=TZ)
    if when <= now() + dt.timedelta(seconds=30):
        raise HTTPException(422, "Pick a time in the future.")
    try:
        validate_for_publish(p)
    except PublishError as e:
        raise HTTPException(422, str(e))
    if p.type == "blog" and not p.slug:
        p.slug = await unique_slug(db, p.title or "post", p.id)
    p.status, p.publish_at = "scheduled", when
    await audit(db, request, a.user.id, "post.scheduled", target=str(p.id), detail={"at": when.isoformat()})
    await db.commit()
    await db.refresh(p)
    return await studio_post(db, p)


@router.post("/posts/{post_id}/unpublish")
async def unpublish(post_id: int, request: Request, a: Owner, db: DB):
    p = await db.get(Post, post_id)
    if not p:
        raise HTTPException(404)
    p.status, p.publish_at = "draft", None
    await audit(db, request, a.user.id, "post.unpublished", target=str(p.id))
    await db.commit()
    await db.refresh(p)
    return await studio_post(db, p)


@router.delete("/posts/{post_id}", status_code=204)
async def delete_post(post_id: int, request: Request, a: Owner, db: DB):
    p = await db.get(Post, post_id)
    if p:
        await audit(db, request, a.user.id, "post.deleted", target=str(post_id), detail={"title": p.title})
        await db.delete(p)
        await db.commit()


@router.get("/topics")
async def all_topics(a: Staff, db: DB):
    return [{"slug": t.slug, "name": t.name} for t in (await db.execute(select(Topic).order_by(Topic.name))).scalars()]


# ---- Media ---------------------------------------------------------------------------------------------------

async def read_capped(f: UploadFile, cap: int) -> bytes:
    buf = bytearray()
    while chunk := await f.read(1024 * 1024):
        buf += chunk
        if len(buf) > cap:
            raise HTTPException(413, "That file is too large.")
    return bytes(buf)


async def put_files(prefix: str, files: dict):
    for name, (data, ctype) in files.items():
        await storage.put(f"{prefix}/{name}", data, ctype)


@router.post("/media/upload", status_code=201)
async def upload(request: Request, a: Staff, db: DB, file: UploadFile = File(...)):
    data = await read_capped(file, cfg.max_upload_bytes)
    st = await get_settings(db)
    import asyncio
    try:
        out = await images.run_limited(images.process_image, data, st.site_name if st.watermark else None)
    except images.UploadError as e:
        raise HTTPException(415, str(e))
    prefix = images.new_prefix()
    await put_files(prefix, out["files"])
    m = Media(kind="image", prefix=prefix, variants=out["variants"], width=out["width"], height=out["height"], blurhash=out["blurhash"])
    db.add(m)
    await audit(db, request, a.user.id, "media.uploaded")
    await db.commit()
    return media_out(m)


@router.post("/media/drawing", status_code=201)
async def save_drawing(request: Request, a: Staff, db: DB, doc: str = Form(...), png: UploadFile = File(...),
                       media_id: int | None = Form(None), caption: str = Form(""), alt: str = Form("")):
    if len(doc) > 9_000_000:
        raise HTTPException(413, "This drawing is too large to save.")
    try:
        parsed = drawing.DrawingDoc.model_validate_json(doc)
    except Exception:  # noqa: BLE001
        raise HTTPException(422, "The drawing file is not valid.")
    raw = await read_capped(png, cfg.max_upload_bytes)
    if images.sniff(raw) != "png":
        raise HTTPException(415, "Expected a PNG.")
    st = await get_settings(db)
    import asyncio
    from PIL import Image
    def work():
        img = Image.open(io.BytesIO(raw))
        img.load()
        wm = st.site_name if st.watermark else None
        files, variants = images.make_variants(img, wm)
        full = io.BytesIO()
        (images._watermark(img, wm) if wm else img.convert("RGBA")).save(full, "PNG", optimize=True)
        files["full.png"] = (full.getvalue(), "image/png")
        variants["png"] = True
        svg = drawing.to_svg(parsed)
        if svg:
            files["drawing.svg"] = (svg.encode(), "image/svg+xml")
            variants["svg"] = True
        return img.width, img.height, images.hash_of(img.convert("RGBA").convert("RGB")), files, variants
    try:
        w, h, bh, files, variants = await images.run_limited(work)
    except Exception:  # noqa: BLE001
        raise HTTPException(415, "The picture could not be read.")
    m = await db.get(Media, media_id) if media_id else None
    if m and m.kind != "drawing":
        raise HTTPException(400, "Not a drawing.")
    if not m:
        m = Media(kind="drawing", prefix=images.new_prefix(), width=w, height=h, variants={})
        db.add(m)
    else:
        await storage.delete_prefix(m.prefix + "/")
    await put_files(m.prefix, files)
    await storage.put(f"{m.prefix}/doc.json", parsed.model_dump_json().encode(), "application/json")
    m.drawing_json_key = f"{m.prefix}/doc.json"
    m.variants, m.width, m.height, m.blurhash = variants, w, h, bh
    m.caption = content.clean(caption, 300)
    m.alt = content.clean(alt, 300) or m.alt
    m.updated_at = now()
    await audit(db, request, a.user.id, "media.drawing_saved")
    await db.commit()
    return media_out(m)


@router.get("/media")
async def list_media(a: Staff, db: DB, kind: Literal["image", "drawing"] | None = None, limit: int = 60, offset: int = 0):
    stmt = select(Media).order_by(Media.created_at.desc()).offset(offset).limit(min(limit, 100))
    if kind:
        stmt = stmt.where(Media.kind == kind)
    return [media_out(m) for m in (await db.execute(stmt)).scalars()]


@router.get("/media/{media_id}/drawing")
async def drawing_doc(media_id: int, a: Staff, db: DB):
    m = await db.get(Media, media_id)
    if not m or not m.drawing_json_key:
        raise HTTPException(404)
    got = await storage.get(m.drawing_json_key)
    if not got:
        raise HTTPException(404)
    return Response(got[0], media_type="application/json", headers={"Cache-Control": "no-store"})


class MediaPatch(BaseModel):
    alt: str | None = Field(default=None, max_length=300)
    caption: str | None = Field(default=None, max_length=300)


@router.patch("/media/{media_id}")
async def patch_media(media_id: int, body: MediaPatch, a: Staff, db: DB):
    m = await db.get(Media, media_id)
    if not m:
        raise HTTPException(404)
    if body.alt is not None:
        m.alt = content.clean(body.alt, 300)
    if body.caption is not None:
        m.caption = content.clean(body.caption, 300)
    await db.commit()
    return media_out(m)


@router.delete("/media/{media_id}", status_code=204)
async def delete_media(media_id: int, request: Request, a: Owner, db: DB):
    m = await db.get(Media, media_id)
    if not m:
        return
    used = (await db.execute(select(Post).where(or_(
        cast(Post.body_json, String).op("~")(rf'"mediaId": {media_id}[,}}\s]'), Post.cover_media_id == media_id)).limit(4))).scalars().all()
    if used:
        names = ", ".join(f"“{(p.title or content.lead_text(p.body_json) or 'untitled')[:40]}”" for p in used[:3])
        raise HTTPException(409, f"This {'drawing' if m.kind == 'drawing' else 'picture'} is used in {names}"
                                 f"{' and more' if len(used) > 3 else ''}. Remove it from the post first, then delete it.")
    await storage.delete_prefix(m.prefix + "/")
    await db.delete(m)
    await audit(db, request, a.user.id, "media.deleted", target=str(media_id))
    await db.commit()


# ---- Comments --------------------------------------------------------------------------------------------------

def sc(c: Comment) -> dict:
    return {"id": c.id, "name": c.author_name, "body": c.body, "status": c.status, "flags": c.flags or [], "is_author": c.is_author,
            "created_at": iso(c.created_at), "likes": c.likes, "parent_id": c.parent_id, "blocked_hint": bool(c.ip_hash),
            "post": {"id": c.post.id, "title": c.post.title or (content.lead_text(c.post.body_json)[:50] + "…"), "type": c.post.type, "slug": c.post.slug}}


@router.get("/comments")
async def studio_comments(a: Staff, db: DB, status: Literal["waiting", "approved", "hidden", "spam"] = "waiting", limit: int = 100):
    rows = (await db.execute(select(Comment).where(Comment.status == status).order_by(Comment.created_at.desc() if status != "waiting" else Comment.created_at).limit(min(limit, 200)))).scalars().all()
    counts = dict((await db.execute(select(Comment.status, func.count()).group_by(Comment.status))).all())
    return {"items": [sc(c) for c in rows], "counts": {k: counts.get(k, 0) for k in ("waiting", "approved", "hidden", "spam")}}


class Bulk(BaseModel):
    ids: list[int] = Field(max_length=100)
    action: Literal["approve", "hide", "spam", "waiting"]


@router.post("/comments/bulk")
async def comments_bulk(body: Bulk, request: Request, a: Staff, db: DB):
    status = {"approve": "approved", "hide": "hidden", "spam": "spam", "waiting": "waiting"}[body.action]
    rows = (await db.execute(select(Comment).where(Comment.id.in_(body.ids)))).scalars().all()
    for c in rows:
        c.status = status  # hidden comments are kept for the record; nothing is ever hard-deleted
    await audit(db, request, a.user.id, f"comment.{body.action}", detail={"ids": body.ids})
    await db.commit()
    return {"ok": True, "count": len(rows)}


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


@router.post("/comments/{comment_id}/reply", status_code=201)
async def comment_reply(comment_id: int, body: ReplyIn, request: Request, a: Staff, db: DB):
    c = await db.get(Comment, comment_id)
    if not c:
        raise HTTPException(404)
    root = await db.get(Comment, c.parent_id) if c.parent_id else c
    if root.status != "approved":
        root.status = "approved"  # a reply is shown beneath its comment, so the comment must be visible
    r = Comment(post_id=root.post_id, parent_id=root.id, author_name="Author", is_author=True,
                body=content.clean(body.body, 2000), status="approved", flags=[])
    db.add(r)
    await audit(db, request, a.user.id, "comment.replied", target=str(root.id))
    await db.commit()
    return {"ok": True, "id": r.id}


@router.post("/comments/{comment_id}/block")
async def comment_block(comment_id: int, request: Request, a: Staff, db: DB):
    c = await db.get(Comment, comment_id)
    if not c or not c.ip_hash:
        raise HTTPException(404)
    if not (await db.execute(select(Block.id).where(Block.ip_hash == c.ip_hash))).first():
        db.add(Block(ip_hash=c.ip_hash, reason=f"From comment {c.id}"))
    others = (await db.execute(select(Comment).where(Comment.ip_hash == c.ip_hash, Comment.status.in_(("waiting", "approved"))))).scalars().all()
    for o in others:
        o.status = "hidden"
    await audit(db, request, a.user.id, "comment.blocked", target=str(c.id))
    await db.commit()
    return {"ok": True, "hidden": len(others)}


# ---- Settings --------------------------------------------------------------------------------------------------

class SocialLink(BaseModel):
    label: str = Field(max_length=30)
    url: str = Field(max_length=300, pattern=r"^https?://")


class SettingsIn(BaseModel):
    comment_mode: Literal["name", "signed_in"] | None = None
    review_comments: bool | None = None
    disable_copy: bool | None = None
    watermark: bool | None = None
    site_name: str | None = Field(default=None, min_length=1, max_length=60)
    about_quote: str | None = Field(default=None, max_length=400)
    about_byline: str | None = Field(default=None, max_length=120)
    about_quote_confirmed: bool | None = None
    footer_line: str | None = Field(default=None, max_length=200)
    social_links: list[SocialLink] | None = Field(default=None, max_length=8)


def settings_out(s) -> dict:
    return {k: getattr(s, k) for k in ("comment_mode", "review_comments", "disable_copy", "watermark", "site_name", "about_quote", "about_byline",
                                       "about_quote_confirmed", "footer_line", "social_links")}


@router.get("/settings")
async def get_set(a: Staff, db: DB):
    return {**settings_out(await get_settings(db)), "mail_configured": cfg.mail_configured}


@router.put("/settings")
async def put_set(body: SettingsIn, request: Request, a: Owner, db: DB):
    s = await get_settings(db)
    data = body.model_dump(exclude_unset=True)
    for k in ("site_name", "about_quote", "about_byline", "footer_line"):
        if k in data:
            data[k] = content.clean(data[k], 400).strip()
    for k, v in data.items():
        setattr(s, k, v)
    await audit(db, request, a.user.id, "settings.updated", detail={"keys": list(data)})
    await db.commit()
    return settings_out(s)


# ---- Stats -----------------------------------------------------------------------------------------------------

def pct(cur, prev):
    if not prev:
        return None
    return round((cur - prev) / prev * 100)


@router.get("/stats/overview")
async def overview(a: Staff, db: DB, period: Literal["today", "30d", "90d", "all"] = "30d"):
    today = dt.datetime.now(TZ).date()
    first = (await db.execute(select(func.min(DailyStat.date)))).scalar()
    if period == "all":
        start = first or today
        n = (today - start).days + 1
        prev_range = None
    else:
        n = {"today": 1, "30d": 30, "90d": 90}[period]
        start = today - dt.timedelta(days=n - 1)
        prev_range = (start - dt.timedelta(days=n), start - dt.timedelta(days=1))
    chart_days = 7 if period == "today" else min(n, 180)
    chart_start = today - dt.timedelta(days=chart_days - 1)
    lo = min(start, chart_start, prev_range[0] if prev_range else start)
    rows = {r.date: r for r in (await db.execute(select(DailyStat).where(DailyStat.date >= lo))).scalars()}

    def total(d0, d1, f):
        return sum(getattr(rows[d], f) for d in rows if d0 <= d <= d1)

    def spark(f):
        days = [start + dt.timedelta(days=i) for i in range(n)] if n > 1 else [chart_start + dt.timedelta(days=i) for i in range(chart_days)]
        return [getattr(rows[d], f) if d in rows else 0 for d in days]

    cur = {f: total(start, today, f) for f in ("visitors", "readers", "new_subscribers")}
    prev = {f: total(prev_range[0], prev_range[1], f) for f in cur} if prev_range else None
    rate = round(cur["readers"] / cur["visitors"] * 100, 1) if cur["visitors"] else 0
    prate = round(prev["readers"] / prev["visitors"] * 100, 1) if prev and prev["visitors"] else None
    sp_rate = [round(r / v * 100, 1) if v else 0 for v, r in zip(spark("visitors"), spark("readers"))]
    cards_ = {
        "visitors": {"value": cur["visitors"], "delta": pct(cur["visitors"], prev["visitors"]) if prev else None, "spark": spark("visitors")},
        "readers": {"value": cur["readers"], "delta": pct(cur["readers"], prev["readers"]) if prev else None, "spark": spark("readers")},
        "read_rate": {"value": rate, "delta": round(rate - prate, 1) if prate is not None else None, "spark": sp_rate},
        "new_subscribers": {"value": cur["new_subscribers"], "delta": (cur["new_subscribers"] - prev["new_subscribers"]) if prev else None,
                            "spark": spark("new_subscribers")},
    }
    series = []
    for i in range(chart_days):
        d = chart_start + dt.timedelta(days=i)
        r = rows.get(d)
        series.append({"date": d.isoformat(), "visitors": r.visitors if r else 0, "readers": r.readers if r else 0})

    top = (await db.execute(
        select(Post, func.sum(PostDailyRead.readers).label("r")).join(PostDailyRead, PostDailyRead.post_id == Post.id)
        .where(PostDailyRead.date >= start).group_by(Post.id).order_by(func.sum(PostDailyRead.readers).desc()).limit(5))).all()
    ccount = dict((await db.execute(select(Comment.post_id, func.count()).where(Comment.status == "approved").group_by(Comment.post_id))).all())
    top_blogs = [{"rank": i + 1, "id": p.id, "title": p.title, "slug": p.slug, "readers": int(r), "comments": ccount.get(p.id, 0)} for i, (p, r) in enumerate(top)]

    waiting = (await db.execute(select(func.count(), func.min(Comment.created_at)).where(Comment.status == "waiting"))).one()
    flagged = (await db.execute(select(func.count()).where(Comment.status == "waiting", func.jsonb_array_length(Comment.flags) > 0))).scalar()
    drafts = (await db.execute(select(func.count(), func.max(Post.updated_at)).where(Post.status == "draft"))).one()
    sched = (await db.execute(select(Post).where(Post.status == "scheduled").order_by(Post.publish_at).limit(1))).scalar_one_or_none()
    attention = {
        "waiting": waiting[0], "oldest_waiting": iso(waiting[1]), "flagged": flagged, "drafts": drafts[0], "last_draft_edit": iso(drafts[1]),
        "scheduled_count": (await db.execute(select(func.count()).where(Post.status == "scheduled"))).scalar(),
        "next_scheduled": {"id": sched.id, "title": sched.title or content.lead_text(sched.body_json)[:40], "at": iso(sched.publish_at)} if sched else None,
    }

    ev = []
    for c in (await db.execute(select(Comment).where(Comment.is_author.is_(False)).order_by(Comment.created_at.desc()).limit(8))).scalars():
        t = c.post.title or content.lead_text(c.post.body_json)[:40]
        if c.flags:
            ev.append({"kind": "flag", "text": f"Comment flagged for {', '.join(c.flags)}", "at": iso(c.created_at)})
        else:
            ev.append({"kind": "comment", "text": f"New comment on {t}", "at": iso(c.created_at)})
    for s in (await db.execute(select(Subscriber).where(Subscriber.confirmed_at.is_not(None)).order_by(Subscriber.confirmed_at.desc()).limit(4))).scalars():
        ev.append({"kind": "subscriber", "text": "A new subscriber confirmed", "at": iso(s.confirmed_at)})
    for p in (await db.execute(select(Post).where(Post.status == "published").order_by(Post.publish_at.desc()).limit(4))).scalars():
        ev.append({"kind": "publish", "text": f"You published {p.title or 'a thought'}" if p.type == "blog" else f"You published a thought: {content.lead_text(p.body_json)[:40]}", "at": iso(p.publish_at)})
    ev.sort(key=lambda e: e["at"] or "", reverse=True)

    recent = (await db.execute(select(Post).order_by(Post.updated_at.desc()).limit(3))).scalars().all()
    reads = dict((await db.execute(select(PostDailyRead.post_id, func.sum(PostDailyRead.readers)).group_by(PostDailyRead.post_id))).all())
    return {"period": period, "days": n, "cards": cards_, "series": series, "attention": attention, "top_blogs": top_blogs,
            "activity": ev[:8], "start": start.isoformat(), "end": today.isoformat(),
            "recent": [{"id": p.id, "type": p.type, "title": p.title or content.lead_text(p.body_json)[:60], "status": p.status,
                        "readers": int(reads.get(p.id, 0))} for p in recent]}


# ---- Subscribers, messages, audit ----------------------------------------------------------------------

@router.get("/subscribers")
async def subscribers(a: Staff, db: DB):
    rows = (await db.execute(select(Subscriber).order_by(Subscriber.created_at.desc()).limit(1000))).scalars().all()
    counts = dict((await db.execute(select(Subscriber.status, func.count()).group_by(Subscriber.status))).all())
    return {"items": [{"id": s.id, "email": s.email, "status": s.status, "created_at": iso(s.created_at), "confirmed_at": iso(s.confirmed_at)} for s in rows],
            "counts": counts}


@router.get("/subscribers/export.csv")
async def export_subs(request: Request, a: Owner, db: DB):
    rows = (await db.execute(select(Subscriber).where(Subscriber.status == "confirmed"))).scalars().all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["email", "confirmed_at"])
    for s in rows:
        w.writerow([("'" + s.email) if s.email[:1] in "=+-@" else s.email, iso(s.confirmed_at)])
    await audit(db, request, a.user.id, "subscribers.exported")
    await db.commit()
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=subscribers.csv"})


@router.get("/contact-messages")
async def messages(a: Staff, db: DB):
    rows = (await db.execute(select(ContactMessage).order_by(ContactMessage.created_at.desc()).limit(200))).scalars().all()
    return [{"id": m.id, "name": m.name, "email": m.email, "topic": m.topic, "message": m.message, "created_at": iso(m.created_at), "is_read": m.is_read} for m in rows]


@router.post("/contact-messages/{mid}/read", status_code=204)
async def mark_read(mid: int, a: Staff, db: DB):
    m = await db.get(ContactMessage, mid)
    if m:
        m.is_read = True
        await db.commit()


@router.get("/audit-log")
async def audit_log(a: Owner, db: DB, limit: int = 100, offset: int = 0):
    rows = (await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).offset(offset).limit(min(limit, 200)))).scalars().all()
    return [{"id": r.id, "at": iso(r.at), "user_id": r.user_id, "action": r.action, "target": r.target, "detail": r.detail} for r in rows]
