from sqlalchemy import select

from app.db import SessionLocal
from app.models import ReaderOtp, now
from app.services.security import hash_code
import datetime as dt

H = {"x-anon-id": "abcdefgh12345678"}


async def post_comment(client, pid, **kw):
    data = {"name": "Asha", "body": "A kind thought."} | kw
    return await client.post(f"/api/v1/posts/{pid}/comments", json=data)


async def test_name_only_comment_waits_for_review(client, make_blog):
    p = await make_blog()
    r = await post_comment(client, p["id"])
    assert r.status_code == 201 and r.json()["status"] == "waiting"
    assert (await client.get(f"/api/v1/posts/{p['id']}/comments")).json()["total"] == 0  # not shown yet
    c = (await client.get("/api/v1/studio/comments?status=waiting")).json()
    assert c["counts"]["waiting"] == 1
    cid = c["items"][0]["id"]
    await client.post("/api/v1/studio/comments/bulk", json={"ids": [cid], "action": "approve"})
    shown = (await client.get(f"/api/v1/posts/{p['id']}/comments")).json()
    assert shown["total"] == 1 and shown["items"][0]["name"] == "Asha"


async def test_review_off_publishes_immediately_but_flags_still_wait(client, make_blog):
    p = await make_blog()
    await client.put("/api/v1/studio/settings", json={"review_comments": False})
    r = await post_comment(client, p["id"])
    assert r.json()["status"] == "approved"
    r = await post_comment(client, p["id"], body="see http://a.example and http://b.example now")
    assert r.json()["status"] == "waiting"
    flags = (await client.get("/api/v1/studio/comments?status=waiting")).json()["items"][0]["flags"]
    assert "2 links" in flags


async def test_comments_are_plain_text(client, make_blog):
    p = await make_blog()
    await client.put("/api/v1/studio/settings", json={"review_comments": False})
    await post_comment(client, p["id"], body="<script>alert(1)</script>hello <b>x</b>")
    body = (await client.get(f"/api/v1/posts/{p['id']}/comments")).json()["items"][0]["body"]
    assert "<script" not in body and "hello" in body


async def test_blocklist_duplicate_and_honeypot(client, make_blog):
    p = await make_blog()
    await client.put("/api/v1/studio/settings", json={"blocklist": ["Moron"]})
    await post_comment(client, p["id"], body="you are a moron")
    await post_comment(client, p["id"], body="same words")
    await post_comment(client, p["id"], body="Same words")
    r = await post_comment(client, p["id"], body="gotcha", website="http://spam")
    assert r.status_code == 201
    w = (await client.get("/api/v1/studio/comments?status=waiting")).json()
    flags = [f for i in w["items"] for f in i["flags"]]
    assert "possibly abusive" in flags and "duplicate" in flags
    assert w["counts"]["spam"] == 1


async def test_rate_limit_five_per_ten_minutes(client, make_blog):
    p = await make_blog()
    codes = [(await post_comment(client, p["id"], body=f"thought number {i}")).status_code for i in range(6)]
    assert codes == [201] * 5 + [429]


async def test_name_is_required_in_name_mode(client, make_blog):
    p = await make_blog()
    assert (await post_comment(client, p["id"], name="")).status_code == 422
    assert (await post_comment(client, p["id"], name="x" * 61)).status_code == 422
    assert (await post_comment(client, p["id"], body="x" * 2001)).status_code == 422


async def test_signed_in_mode_requires_a_reader_session(client, make_blog):
    p = await make_blog()
    await client.put("/api/v1/studio/settings", json={"comment_mode": "signed_in", "review_comments": False})
    assert (await post_comment(client, p["id"])).status_code == 401
    client.cookies.delete("sid")
    async with SessionLocal() as db:
        db.add(ReaderOtp(email="reader@example.com", name="Ravi", code_hash=hash_code("123456"), expires_at=now() + dt.timedelta(minutes=5)))
        await db.commit()
    assert (await client.post("/api/v1/reader/otp/verify", json={"email": "reader@example.com", "code": "000000"})).status_code == 400
    r = await client.post("/api/v1/reader/otp/verify", json={"email": "reader@example.com", "code": "123456"})
    assert r.status_code == 200 and r.json()["name"] == "Ravi"
    r = await post_comment(client, p["id"], name="ignored")
    assert r.status_code == 201 and r.json()["status"] == "approved"
    shown = (await client.get(f"/api/v1/posts/{p['id']}/comments")).json()["items"][0]
    assert shown["name"] == "Ravi" and "email" not in str(shown)  # the account email is never exposed


async def test_author_reply_block_and_hide(client, make_blog):
    p = await make_blog()
    await client.put("/api/v1/studio/settings", json={"review_comments": False})
    await post_comment(client, p["id"])
    top = (await client.get(f"/api/v1/posts/{p['id']}/comments")).json()["items"][0]
    r = await client.post(f"/api/v1/studio/comments/{top['id']}/reply", json={"body": "Thank you."})
    assert r.status_code == 201
    shown = (await client.get(f"/api/v1/posts/{p['id']}/comments")).json()["items"][0]
    assert shown["replies"][0]["is_author"] is True and shown["replies"][0]["name"] == "Author"
    assert (await client.post(f"/api/v1/studio/comments/{top['id']}/block")).status_code == 200
    assert (await post_comment(client, p["id"])).status_code == 403  # blocked fingerprint
    hidden = (await client.get("/api/v1/studio/comments?status=hidden")).json()
    assert hidden["counts"]["hidden"] >= 1  # hidden, never hard-deleted


async def test_likes_are_once_per_browser(client, make_blog):
    p = await make_blog()
    await client.put("/api/v1/studio/settings", json={"review_comments": False})
    await post_comment(client, p["id"])
    cid = (await client.get(f"/api/v1/posts/{p['id']}/comments")).json()["items"][0]["id"]
    assert (await client.post(f"/api/v1/comments/{cid}/like", headers=H)).json() == {"likes": 1, "liked": True}
    assert (await client.post(f"/api/v1/comments/{cid}/like", headers=H)).json() == {"likes": 0, "liked": False}
