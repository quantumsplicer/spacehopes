import io
import json

from PIL import Image

from app.config import cfg

BOT = {"user-agent": "Googlebot/2.1"}


def png_bytes(size=(200, 120), mode="RGB", exif=False):
    img = Image.new(mode, size, (200, 30, 30) if mode == "RGB" else (200, 30, 30, 120))
    buf = io.BytesIO()
    kw = {}
    if exif:
        e = Image.Exif()
        e[0x010F] = "SecretCamera"
        e[0x8825] = {1: "N", 2: (28.0, 36.0, 0.0)}  # GPS block
        kw["exif"] = e
        img.save(buf, "JPEG", **kw)
    else:
        img.save(buf, "PNG")
    return buf.getvalue()


# ---- analytics counting rules -----------------------------------------------------------------------------

async def overview(c, period="30d"):
    return (await c.get(f"/api/v1/studio/stats/overview?period={period}")).json()


async def test_visitors_and_readers_counting(owner, make_blog):
    blog = await make_blog()
    thought = (await owner.post("/api/v1/studio/posts", json={"type": "thought"})).json()
    await owner.put(f"/api/v1/studio/posts/{thought['id']}", json={"body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hm"}]}]}})
    await owner.post(f"/api/v1/studio/posts/{thought['id']}/publish")

    await owner.post("/api/v1/track/visit")
    await owner.post("/api/v1/track/visit")
    await owner.post("/api/v1/track/read", json={"post_id": blog["id"]})
    await owner.post("/api/v1/track/read", json={"post_id": thought["id"]})  # thoughts are not "reads"
    await owner.post("/api/v1/track/visit", headers=BOT)  # bots are filtered
    await owner.post("/api/v1/track/read", json={"post_id": blog["id"]}, headers=BOT)
    await owner.post("/api/v1/track/read", json={"post_id": 99999})  # unknown post ignored

    o = await overview(owner)
    assert o["cards"]["visitors"]["value"] == 2
    assert o["cards"]["readers"]["value"] == 1
    assert o["cards"]["read_rate"]["value"] == 50.0
    assert o["top_blogs"][0]["id"] == blog["id"] and o["top_blogs"][0]["readers"] == 1
    assert o["series"][-1]["visitors"] == 2


async def test_subscriber_confirmation_counts_once(client, owner):
    await client.post("/api/v1/subscribe", json={"email": "Fan@Example.com"})
    subs = (await owner.get("/api/v1/studio/subscribers")).json()
    assert subs["counts"] == {"pending": 1}  # not counted until confirmed
    from app.db import SessionLocal
    from app.models import Subscriber
    from sqlalchemy import select
    async with SessionLocal() as db:
        tok = (await db.execute(select(Subscriber.token))).scalar()
    assert (await client.get(f"/api/v1/subscribe/confirm?token={tok}", follow_redirects=False)).status_code == 303
    await client.get(f"/api/v1/subscribe/confirm?token={tok}", follow_redirects=False)
    assert (await overview(owner))["cards"]["new_subscribers"]["value"] == 1


async def test_analytics_store_no_ip_or_user_agent(owner):
    from app.db import SessionLocal
    from sqlalchemy import text
    await owner.post("/api/v1/track/visit")
    async with SessionLocal() as db:
        cols = (await db.execute(text("select column_name from information_schema.columns where table_name in ('daily_stats','post_daily_reads')"))).scalars().all()
    assert set(cols) == {"date", "visitors", "readers", "new_subscribers", "post_id"}


# ---- uploads ---------------------------------------------------------------------------------------------------

async def upload(c, data, name="a.png", ctype="image/png"):
    return await c.post("/api/v1/studio/media/upload", files={"file": (name, data, ctype)})


async def test_upload_png_makes_webp_variants_and_blurhash(owner):
    r = await upload(owner, png_bytes((2200, 1400)))
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["variants"]["webp"] == [640, 1280, 2048] and m["blurhash"]
    f = await owner.get(f"/api/v1/media/{m['key']}/1280.webp")
    assert f.status_code == 200 and Image.open(io.BytesIO(f.content)).width == 1280


async def test_svg_and_other_files_rejected(owner):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    assert (await upload(owner, svg, "x.svg", "image/svg+xml")).status_code == 415
    assert (await upload(owner, b"<html><script>1</script></html>", "x.png", "image/png")).status_code == 415  # lying extension
    assert (await upload(owner, b"GIF89a....", "x.gif", "image/gif")).status_code == 415


async def test_exif_and_gps_are_stripped(owner):
    raw = png_bytes((900, 600), exif=True)
    assert Image.open(io.BytesIO(raw)).getexif().get(0x010F) == "SecretCamera"
    m = (await upload(owner, raw, "p.jpg", "image/jpeg")).json()
    for w in m["variants"]["webp"]:
        out = Image.open(io.BytesIO((await owner.get(f"/api/v1/media/{m['key']}/{w}.webp")).content))
        assert not out.getexif() and b"SecretCamera" not in out.info.get("exif", b"") and b"GPS" not in out.info.get("exif", b"")


async def test_oversize_upload_refused(owner, monkeypatch):
    monkeypatch.setattr(cfg, "max_upload_bytes", 1000)
    assert (await upload(owner, png_bytes((600, 600)))).status_code == 413


async def test_upload_needs_login(client):
    assert (await upload(client, png_bytes())).status_code == 401


async def test_drawing_round_trip_keeps_vector_json(owner):
    doc = {"version": 1, "width": 800, "height": 600, "layers": [{"id": "l1", "name": "Ink", "strokes": [
        {"id": "s1", "tool": "pen", "color": "#1a1a1a", "size": 6, "opacity": 1, "seed": 1, "points": [[10, 10, 0.5], [200, 100, 0.7], [300, 90, 0.4]]}]}]}
    r = await owner.post("/api/v1/studio/media/drawing", data={"doc": json.dumps(doc), "caption": "c"},
                         files={"png": ("d.png", png_bytes((1600, 1200), "RGBA"), "image/png")})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["kind"] == "drawing" and m["variants"]["svg"] and m["variants"]["png"]
    back = (await owner.get(f"/api/v1/studio/media/{m['id']}/drawing")).json()
    assert back["layers"][0]["strokes"][0]["points"][1] == [200, 100, 0.7]
    svg = (await owner.get(f"/api/v1/media/{m['key']}/drawing.svg")).text
    assert "<path" in svg and "stroke-dashoffset" in svg and "<script" not in svg
    bad = dict(doc, layers=[{"id": "l", "name": "x", "strokes": [{"id": "s", "tool": "pen", "color": "red;}<script>", "size": 3, "opacity": 1}]}])
    r = await owner.post("/api/v1/studio/media/drawing", data={"doc": json.dumps(bad)}, files={"png": ("d.png", png_bytes(), "image/png")})
    assert r.status_code == 422


async def test_publish_blocked_without_alt_text(owner):
    m = (await upload(owner, png_bytes())).json()
    pid = (await owner.post("/api/v1/studio/posts", json={"type": "blog"})).json()["id"]
    body = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "words"}]},
                                       {"type": "image", "attrs": {"mediaId": m["id"], "alt": "", "caption": ""}}]}
    await owner.put(f"/api/v1/studio/posts/{pid}", json={"title": "T", "body": body})
    r = await owner.post(f"/api/v1/studio/posts/{pid}/publish")
    assert r.status_code == 422 and "alt" in r.json()["detail"].lower()
    body["content"][1]["attrs"]["alt"] = "A red rectangle"
    await owner.put(f"/api/v1/studio/posts/{pid}", json={"body": body})
    assert (await owner.post(f"/api/v1/studio/posts/{pid}/publish")).status_code == 200


# ---- settings, scheduling, conflicts ---------------------------------------------------------------------------

async def test_settings_update_and_public_view(owner):
    r = await owner.put("/api/v1/studio/settings", json={"site_name": "Quill", "disable_copy": False})
    assert r.status_code == 200 and r.json()["site_name"] == "Quill"
    pub = (await owner.get("/api/v1/settings/public")).json()
    assert pub["site_name"] == "Quill" and pub["disable_copy"] is False and "blocklist" not in pub


async def test_scheduled_post_goes_live_via_scheduler(owner, make_blog):
    import datetime as dt
    from app.scheduler import publish_due
    from app.db import SessionLocal
    from app.models import Post, now
    from sqlalchemy import update
    p = await make_blog(publish=False)
    when = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)).isoformat()
    r = await owner.post(f"/api/v1/studio/posts/{p['id']}/schedule", json={"publish_at": when})
    assert r.status_code == 200 and r.json()["status"] == "scheduled"
    assert (await owner.get("/api/v1/feed")).json()["total"] == 0
    async with SessionLocal() as db:
        await db.execute(update(Post).where(Post.id == p["id"]).values(publish_at=now() - dt.timedelta(seconds=5)))
        await db.commit()
    await publish_due()
    assert (await owner.get("/api/v1/feed")).json()["total"] == 1


async def test_autosave_conflict_detection(owner):
    p = (await owner.post("/api/v1/studio/posts", json={"type": "blog"})).json()
    r1 = await owner.put(f"/api/v1/studio/posts/{p['id']}", json={"title": "One", "base_updated_at": p["updated_at"]})
    assert r1.status_code == 200
    r2 = await owner.put(f"/api/v1/studio/posts/{p['id']}", json={"title": "Two", "base_updated_at": p["updated_at"]})  # stale
    assert r2.status_code == 409 and r2.json()["detail"]["latest"]["title"] == "One"


async def test_feed_search_and_cursor(owner, make_blog):
    for i in range(3):
        await make_blog(title=f"Gardening note {i}", text="roses and tulips")
    await make_blog(title="Other", text="something else entirely")
    f = (await owner.get("/api/v1/feed?q=roses")).json()
    assert f["total"] == 3
    page = (await owner.get("/api/v1/feed?limit=2")).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    nxt = (await owner.get(f"/api/v1/feed?limit=2&cursor={page['next_cursor']}")).json()
    assert len(nxt["items"]) == 2 and not nxt["next_cursor"]
    assert not {i["id"] for i in page["items"]} & {i["id"] for i in nxt["items"]}


# ---- deleting media, and honest email behaviour ----------------------------------------------------------------

async def test_unused_media_can_be_deleted_but_used_media_is_protected(owner, make_blog):
    m = (await upload(owner, png_bytes())).json()
    r = await owner.delete(f"/api/v1/studio/media/{m['id']}")
    assert r.status_code == 204
    assert (await owner.get(f"/api/v1/media/{m['key']}/640.webp")).status_code == 404  # the files are gone too

    m2 = (await upload(owner, png_bytes())).json()
    pid = (await owner.post("/api/v1/studio/posts", json={"type": "blog"})).json()["id"]
    body = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "words"}]},
                                       {"type": "image", "attrs": {"mediaId": m2["id"], "alt": "A picture", "caption": ""}}]}
    await owner.put(f"/api/v1/studio/posts/{pid}", json={"title": "My post", "body": body})
    r = await owner.delete(f"/api/v1/studio/media/{m2['id']}")
    assert r.status_code == 409 and "My post" in r.json()["detail"]  # says where it is used

    m3 = (await upload(owner, png_bytes())).json()
    await owner.put(f"/api/v1/studio/posts/{pid}", json={"cover_media_id": m3["id"]})
    assert (await owner.delete(f"/api/v1/studio/media/{m3['id']}")).status_code == 409  # a blog cover counts as use


async def test_drawings_can_be_deleted_too(owner):
    doc = {"version": 1, "width": 800, "height": 600, "layers": [{"id": "l1", "name": "Ink", "strokes": []}]}
    m = (await owner.post("/api/v1/studio/media/drawing", data={"doc": json.dumps(doc)}, files={"png": ("d.png", png_bytes((800, 600), "RGBA"), "image/png")})).json()
    assert (await owner.delete(f"/api/v1/studio/media/{m['id']}")).status_code == 204
    assert (await owner.get(f"/api/v1/studio/media/{m['id']}/drawing")).status_code == 404


async def test_subscribe_is_honest_when_no_mail_service_is_set_up(client, monkeypatch):
    from app.config import Config
    monkeypatch.setattr(Config, "mail_configured", property(lambda self: False))
    r = await client.post("/api/v1/subscribe", json={"email": "someone@example.com"})
    assert r.status_code == 503 and "not switched on" in r.json()["detail"]
    r = await client.post("/api/v1/reader/otp/request", json={"email": "someone@example.com", "name": "S"})
    assert r.status_code == 503


async def test_surprise_me_shows_every_thought_before_repeating(owner):
    ids = []
    for i in range(3):
        pid = (await owner.post("/api/v1/studio/posts", json={"type": "thought"})).json()["id"]
        body = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"thought number {i}"}]}]}
        await owner.put(f"/api/v1/studio/posts/{pid}", json={"body": body})
        assert (await owner.post(f"/api/v1/studio/posts/{pid}/publish")).status_code == 200
        ids.append(pid)
    seen = [ids[0]]
    for _ in range(2):  # two more clicks reach the other two thoughts, never an already-seen one
        r = await owner.get(f"/api/v1/thoughts/random?exclude={','.join(map(str, seen))}")
        assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
        assert r.json()["id"] not in seen
        seen.append(r.json()["id"])
    assert set(seen) == set(ids)
    # everything has been seen: a new round starts, but never repeats the one just shown
    for _ in range(6):
        nxt = (await owner.get(f"/api/v1/thoughts/random?exclude={','.join(map(str, seen))}")).json()["id"]
        assert nxt != seen[-1]
        seen = [nxt]
    assert (await owner.get("/api/v1/thoughts/random?exclude=abc,,1")).status_code == 200  # junk in the list is ignored
