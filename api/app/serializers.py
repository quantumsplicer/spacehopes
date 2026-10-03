from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Comment, Media, Post, Reaction
from .services import content


def media_out(m: Media | None) -> dict | None:
    if not m:
        return None
    return {
        "id": m.id, "kind": m.kind, "w": m.width, "h": m.height, "blurhash": m.blurhash, "alt": m.alt,
        "caption": m.caption, "v": int(m.updated_at.timestamp()), "key": m.prefix[2:],
        "variants": {"webp": m.variants.get("webp", []), "avif": m.variants.get("avif", []),
                     "png": bool(m.variants.get("png")), "svg": bool(m.variants.get("svg"))},
    }


async def counts(db: AsyncSession, ids: list[int]) -> tuple[dict[int, int], dict[int, int]]:
    if not ids:
        return {}, {}
    likes = dict((await db.execute(select(Reaction.post_id, func.count()).where(
        Reaction.post_id.in_(ids), Reaction.kind == "agree").group_by(Reaction.post_id))).all())
    comments = dict((await db.execute(select(Comment.post_id, func.count()).where(
        Comment.post_id.in_(ids), Comment.status == "approved").group_by(Comment.post_id))).all())
    return likes, comments


def iso(d):
    return d.isoformat() if d else None


async def cards(db: AsyncSession, posts: list[Post]) -> list[dict]:
    likes, comments = await counts(db, [p.id for p in posts])
    out = []
    for p in posts:
        out.append({
            "id": p.id, "type": p.type, "slug": p.slug, "title": p.title, "excerpt": p.excerpt,
            "text": content.lead_text(p.body_json) if p.type == "thought" else None,
            "published_at": iso(p.publish_at or p.created_at), "read_minutes": p.read_minutes,
            "likes": likes.get(p.id, 0), "comment_count": comments.get(p.id, 0),
            "topics": [{"slug": t.slug, "name": t.name} for t in p.topics],
            "thumb": media_out(p.cover),
        })
    return out


async def media_map(db: AsyncSession, body: dict) -> dict[str, dict]:
    ids = content.media_ids(body)
    if not ids:
        return {}
    rows = (await db.execute(select(Media).where(Media.id.in_(ids)))).scalars().all()
    return {str(m.id): media_out(m) for m in rows}
