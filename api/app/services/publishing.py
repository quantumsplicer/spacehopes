import asyncio
import html
import logging

from sqlalchemy import select

from ..config import cfg
from ..models import Post, Subscriber, now
from . import content
from .mail import send_safe, wrap_html

log = logging.getLogger("publishing")


class PublishError(ValueError):
    pass


def validate_for_publish(p: Post):
    body = p.body_json or {"content": []}
    if p.type == "blog":
        if not (p.title or "").strip():
            raise PublishError("Add a title before publishing.")
        if not content.plain_text(body):
            raise PublishError("The blog is empty.")
    else:
        if not content.lead_text(body) and not content.media_ids(body):
            raise PublishError("Write a thought first.")
    n = content.missing_alt(body)
    if n:
        raise PublishError(f"Add alt text to {n} image{'s' if n != 1 else ''} before publishing. It is read aloud to people who cannot see them.")


async def unique_slug(db, title: str, post_id: int) -> str:
    base = content.slugify(title)
    slug, i = base, 2
    while (await db.execute(select(Post.id).where(Post.slug == slug, Post.id != post_id))).first():
        slug, i = f"{base}-{i}", i + 1
    return slug


async def publish(db, p: Post, when=None):
    validate_for_publish(p)
    if p.type == "blog" and not p.slug:
        p.slug = await unique_slug(db, p.title or "post", p.id)
    p.status = "published"
    p.publish_at = when or now()
    await db.commit()
    asyncio.create_task(notify_subscribers(p.id))


async def notify_subscribers(post_id: int):
    from ..db import SessionLocal
    async with SessionLocal() as db:
        p = await db.get(Post, post_id)
        if not p or p.status != "published":
            return
        subs = (await db.execute(select(Subscriber).where(Subscriber.status == "confirmed"))).scalars().all()
        title = p.title or content.lead_text(p.body_json)[:60]
        url = f"{cfg.public_url}/p/{p.slug}" if p.type == "blog" else f"{cfg.public_url}/t/{p.id}"
        teaser = p.excerpt or content.lead_text(p.body_json)
        etitle, eteaser = html.escape(title), html.escape(teaser)
        for s in subs:
            unsub = f"{cfg.public_url}/api/v1/unsubscribe?token={s.token}"
            await send_safe(s.email, title, f"{teaser}\n\nRead it: {url}\n\nUnsubscribe: {unsub}",
                            wrap_html(f'<p style="font-size:22px;font-style:italic">{etitle}</p><p>{eteaser}</p>'
                                      f'<p><a href="{url}" style="color:#0f766e">Read it →</a></p>'
                                      f'<p style="color:#6b6b6b;font-size:13px"><a href="{unsub}" style="color:#6b6b6b">Unsubscribe</a></p>'))
