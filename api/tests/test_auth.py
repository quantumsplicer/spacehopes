import datetime as dt

from sqlalchemy import select, text, update

from app.config import Config
from app.db import SessionLocal
from app.models import AuthFailure, Session, User, now
from app.services import passwords
from .conftest import PASSWORD, make_user, sign_in

L = "/api/v1/studio/auth/login"
NEW = "Aurora-Borealis-7-Glow"


async def age_failures(minutes=20):
    async with SessionLocal() as db:
        await db.execute(update(AuthFailure).values(created_at=now() - dt.timedelta(minutes=minutes)))
        await db.commit()


async def test_sign_in_sets_a_hardened_session_cookie(client):
    await make_user()
    r = await client.post(L, json={"login_id": "owner", "password": PASSWORD})
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert (await client.get("/api/v1/studio/auth/me")).json()["authenticated"] is True
    client.headers["x-csrf-token"] = r.json()["csrf"]
    assert (await client.get("/api/v1/studio/posts")).status_code == 200


async def test_login_id_is_case_insensitive_and_password_is_not(client):
    await make_user()
    assert (await client.post(L, json={"login_id": "  OWNER ", "password": PASSWORD})).status_code == 200
    client.cookies.clear()
    assert (await client.post(L, json={"login_id": "owner", "password": PASSWORD.lower()})).status_code == 401


async def test_wrong_password_and_unknown_user_look_identical(client):
    await make_user()
    a = await client.post(L, json={"login_id": "owner", "password": "nope-nope-nope"})
    b = await client.post(L, json={"login_id": "nobody", "password": "nope-nope-nope"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json() == {"detail": "Incorrect login ID or password."}


async def test_passwords_are_stored_as_salted_scrypt_hashes(client):
    await make_user()
    async with SessionLocal() as db:
        h = (await db.execute(select(User.password_hash))).scalar()
    assert h.startswith("scrypt$") and PASSWORD not in h
    assert passwords.hash_password(PASSWORD) != passwords.hash_password(PASSWORD)  # random salt per hash
    assert passwords.verify_password(PASSWORD, h) and not passwords.verify_password("x", h)


async def test_guessing_is_throttled_with_growing_waits(client):
    await make_user()
    codes = []
    for i in range(6):
        r = await client.post(L, json={"login_id": "owner", "password": f"guess-{i}"})
        codes.append(r.status_code)
    assert codes[:4] == [401, 401, 401, 401]  # the first three are free; the 4th failure starts a wait
    assert codes[4] == 429
    r = await client.post(L, json={"login_id": "owner", "password": PASSWORD})  # even the right password waits
    assert r.status_code == 429 and r.json()["detail"]["retry_after"] > 0 and r.headers["retry-after"]
    await age_failures()
    assert (await client.post(L, json={"login_id": "owner", "password": PASSWORD})).status_code == 200


async def test_throttle_covers_unknown_ids_too(client):
    codes = [(await client.post(L, json={"login_id": "ghost", "password": "x" * 12})).status_code for _ in range(6)]
    assert codes[-1] == 429  # no way to tell real accounts from fake ones by how the throttle behaves


async def test_success_clears_the_failure_count(client):
    await make_user()
    for i in range(3):
        await client.post(L, json={"login_id": "owner", "password": "bad"})
    assert (await client.post(L, json={"login_id": "owner", "password": PASSWORD})).status_code == 200
    async with SessionLocal() as db:
        assert (await db.execute(select(AuthFailure))).first() is None


async def test_sign_in_replaces_the_session_and_logout_ends_it(client):
    await make_user()
    r1 = await client.post(L, json={"login_id": "owner", "password": PASSWORD})
    first = client.cookies.get("sid")
    await client.post(L, json={"login_id": "owner", "password": PASSWORD})
    assert client.cookies.get("sid") != first
    client.headers["x-csrf-token"] = r1.json()["csrf"]
    assert (await client.get("/api/v1/studio/posts")).status_code == 200
    await client.post("/api/v1/studio/auth/logout")
    assert (await client.get("/api/v1/studio/posts")).status_code == 401


async def test_login_rejects_foreign_origin(client):
    await make_user()
    r = await client.post(L, json={"login_id": "owner", "password": PASSWORD}, headers={"origin": "https://evil.example"})
    assert r.status_code == 403


async def test_csrf_and_origin_on_writes(owner):
    token = owner.headers.pop("x-csrf-token")
    assert (await owner.post("/api/v1/studio/posts", json={"type": "thought"})).status_code == 403
    owner.headers["x-csrf-token"] = token
    assert (await owner.post("/api/v1/studio/posts", json={"type": "thought"})).status_code == 201
    owner.headers["origin"] = "https://evil.example"
    assert (await owner.post("/api/v1/studio/posts", json={"type": "thought"})).status_code == 403
    owner.headers.pop("origin")


async def test_idle_timeout(owner):
    async with SessionLocal() as db:
        s = (await db.execute(select(Session))).scalars().first()
        s.last_seen_at = now() - dt.timedelta(minutes=31)
        await db.commit()
    assert (await owner.get("/api/v1/studio/posts")).status_code == 401


async def test_absolute_timeout(owner):
    async with SessionLocal() as db:
        s = (await db.execute(select(Session))).scalars().first()
        s.expires_at = now() - dt.timedelta(seconds=1)
        await db.commit()
    assert (await owner.get("/api/v1/studio/posts")).status_code == 401


# ---- changing the password -----------------------------------------------------------------------------------

P = "/api/v1/studio/auth/password"


async def test_change_password_needs_the_old_one(owner):
    r = await owner.post(P, json={"old_password": "wrong-wrong-1A!", "new_password": NEW})
    assert r.status_code == 401 and "current password" in r.json()["detail"]


async def test_old_password_guessing_on_the_change_form_is_throttled(owner):
    codes = [(await owner.post(P, json={"old_password": f"wrong-{i}", "new_password": NEW})).status_code for i in range(6)]
    assert codes[-1] == 429
    assert (await owner.post(P, json={"old_password": PASSWORD, "new_password": NEW})).status_code == 429


async def test_weak_new_passwords_are_refused(owner):
    for bad in ["short1A!", "admin@123", "alllowercaseletters", "Owner-Owner-Owner1", PASSWORD, "aaaaaaaaaaaaaaaaA1!", "password-Password1"]:
        r = await owner.post(P, json={"old_password": PASSWORD, "new_password": bad})
        assert r.status_code == 422, bad


async def test_change_password_rotates_and_revokes_sessions(client):
    await make_user()
    await sign_in(client)
    old_cookie = client.cookies.get("sid")
    other = await client.post(L, json={"login_id": "owner", "password": PASSWORD})  # a second session
    client.headers["x-csrf-token"] = other.json()["csrf"]
    r = await client.post(P, json={"old_password": PASSWORD, "new_password": NEW, "new_login_id": "Chief.Editor"})
    assert r.status_code == 200 and r.json()["login_id"] == "chief.editor"
    client.headers["x-csrf-token"] = r.json()["csrf"]
    assert (await client.get("/api/v1/studio/posts")).status_code == 200  # the fresh session works
    stale = client.cookies.get("sid")
    client.cookies.clear(); client.cookies.set("sid", old_cookie)
    assert (await client.get("/api/v1/studio/posts")).status_code == 401  # every earlier session is dead
    client.cookies.clear(); client.cookies.set("sid", stale)
    client.cookies.clear()
    assert (await client.post(L, json={"login_id": "owner", "password": PASSWORD})).status_code == 401
    assert (await client.post(L, json={"login_id": "chief.editor", "password": NEW})).status_code == 200


async def test_login_id_must_be_valid_and_unique(client):
    await make_user("owner", "owner")
    await make_user("editor", "writer")
    await sign_in(client)
    assert (await client.post(P, json={"old_password": PASSWORD, "new_password": NEW, "new_login_id": "writer"})).status_code == 409
    assert (await client.post(P, json={"old_password": PASSWORD, "new_password": NEW, "new_login_id": "a b"})).status_code == 422


async def test_default_password_must_be_changed_outside_dev(client, monkeypatch):
    await make_user("owner", "admin", "admin@123", must_change=True)
    await sign_in(client, "admin", "admin@123")
    assert (await client.get("/api/v1/studio/auth/me")).json()["must_change"] is True
    assert (await client.get("/api/v1/studio/posts")).status_code == 200  # dev: only a banner
    monkeypatch.setattr(Config, "enforce_password_change", property(lambda self: True))
    r = await client.get("/api/v1/studio/posts")
    assert r.status_code == 403 and r.json()["detail"] == "password_change_required"
    r = await client.post(P, json={"old_password": "admin@123", "new_password": NEW})
    assert r.status_code == 200
    client.headers["x-csrf-token"] = r.json()["csrf"]
    assert (await client.get("/api/v1/studio/posts")).status_code == 200


async def test_editor_cannot_publish_or_change_settings(client):
    await make_user("editor", "ed")
    await sign_in(client, "ed")
    pid = (await client.post("/api/v1/studio/posts", json={"type": "thought"})).json()["id"]
    body = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hi"}]}]}
    assert (await client.put(f"/api/v1/studio/posts/{pid}", json={"body": body})).status_code == 200
    assert (await client.post(f"/api/v1/studio/posts/{pid}/publish")).status_code == 403
    assert (await client.put("/api/v1/studio/settings", json={"watermark": True})).status_code == 403
    assert (await client.get("/api/v1/studio/audit-log")).status_code == 403


async def test_audit_log_is_append_only_and_never_holds_typed_secrets(owner):
    await owner.post(L, json={"login_id": "owner", "password": "TopSecret-typed-123"})  # a failure is audited
    async with SessionLocal() as db:
        rows = (await db.execute(text("SELECT action, detail::text FROM audit_log"))).all()
        assert not any("TopSecret" in (d or "") for _, d in rows)
        try:
            await db.execute(text("DELETE FROM audit_log"))
            await db.commit()
            assert False, "delete should have been blocked"
        except Exception as e:  # noqa: BLE001
            assert "append-only" in str(e)
