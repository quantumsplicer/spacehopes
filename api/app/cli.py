"""Command line: python -m app.cli seed | backup | restore [name]"""
import asyncio
import base64
import datetime as dt
import io
import json
import os
import random
import secrets
import subprocess
import sys

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from PIL import Image, ImageDraw
from sqlalchemy import func, select, text

from .config import cfg
from .db import SessionLocal
from .models import (AuthFailure, Comment, DailyStat, Media, Post, PostDailyRead, PostTopic, Reaction, SiteSettings,
                     Subscriber, Topic, User, now)
from .services.passwords import hash_password
from .services import content, drawing, images, storage
from .services.security import anon_hash, token

STARTER_BLOCKLIST = ["idiot", "moron", "scum", "bastard", "harami", "kameena", "haramkhor", "kutta", "हरामी", "कमीना"]
TINTS = ["#cfe7e3", "#f6d9c6", "#d9e2f6", "#e6f2e8"]


# ---- Backups: encrypted pg_dump + media manifest, to the (R2) bucket -------------------------------------------

def _key(salt: bytes) -> bytes:
    return base64.urlsafe_b64encode(Scrypt(salt=salt, length=32, n=2**14, r=8, p=1).derive(cfg.backup_passphrase.encode()))


def _pg_url() -> str:
    """libpq form of DATABASE_URL (it spells the TLS option sslmode=, SQLAlchemy/asyncpg spell it ssl=)."""
    return cfg.database_url.replace("+asyncpg", "").replace("ssl=", "sslmode=")


def _strip(dump: bytes) -> bytes:
    """A newer pg_dump client can emit settings an older server rejects (transaction_timeout); the restore does not need them."""
    return b"\n".join(line for line in dump.split(b"\n") if not line.startswith(b"SET transaction_timeout"))


async def backup() -> str:
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d_%H%M")
    dump = subprocess.run(["pg_dump", "--no-owner", "--no-privileges", "--schema=public", "--clean", "--if-exists", _pg_url()], capture_output=True, check=True).stdout
    dump = _strip(dump)
    salt = os.urandom(16)
    blob = salt + Fernet(_key(salt)).encrypt(dump)
    try:
        await storage.ensure_bucket(backup=True)
    except Exception:  # noqa: BLE001  (a bucket-scoped token may not be allowed to create buckets)
        pass
    await storage.put(f"backups/{stamp}.sql.enc", blob, "application/octet-stream", backup=True)
    manifest = [m for m in await storage.list_all() if not m["key"].startswith("backups/")]
    await storage.put(f"backups/{stamp}.media.json", json.dumps(manifest).encode(), "application/json", backup=True)
    names = sorted(m["key"] for m in await storage.list_all(backup=True) if m["key"].startswith("backups/") and m["key"].endswith(".sql.enc"))
    for old in names[:-14]:  # keep the last 14
        await storage.delete_prefix(old, backup=True)
    print(f"backup written: backups/{stamp}.sql.enc ({len(blob)} bytes)")
    return stamp


async def restore(name: str | None = None):
    names = sorted(m["key"] for m in await storage.list_all(backup=True) if m["key"].startswith("backups/") and m["key"].endswith(".sql.enc"))
    if not names:
        sys.exit("No backups found.")
    key = f"backups/{name}.sql.enc" if name and not name.startswith("backups/") else (name or names[-1])
    got = await storage.get(key, backup=True)
    if not got:
        sys.exit(f"Backup not found: {key}")
    blob = got[0]
    dump = _strip(Fernet(_key(blob[:16])).decrypt(blob[16:]))
    subprocess.run(["psql", "-v", "ON_ERROR_STOP=1", "-q", _pg_url()], input=dump, check=True)
    print(f"restored from {key}")


# ---- Seed ------------------------------------------------------------------------------------------------------

def tinted(hexcol: str, w=960, h=600) -> bytes:
    base = tuple(int(hexcol[i:i + 2], 16) for i in (1, 3, 5))
    img = Image.new("RGB", (w, h), base)
    d = ImageDraw.Draw(img)
    dot = tuple(min(255, c + 14) for c in base)
    for y in range(0, h, 5):
        for x in range(0, w, 5):
            d.point((x, y), fill=dot)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def S(v):
    return round(v * 1600 / 962, 1)


def dome_doc() -> drawing.DrawingDoc:
    def st(i, tool, color, size, pts=None, shape=None):
        return {"id": f"s{i}", "tool": tool, "color": color, "size": size, "opacity": 1, "seed": i, "points": pts or [], "shape": shape}

    def sh(kind, a, b):
        return {"kind": kind, "a": [S(a[0]), S(a[1])], "b": [S(b[0]), S(b[1])]}

    import math
    dome = [[S(481 + 152 * math.cos(math.pi - t * math.pi / 24)), S(430 - 94 * math.sin(t * math.pi / 24)), 0.5] for t in range(25)]
    ground = [[S(124 + i * 29.7), S(614 - 5 * math.sin(i / 24 * math.pi)), 0.5] for i in range(25)]
    ink = [st(1, "pen", "#1a1a1a", 7, dome), st(2, "shape", "#1a1a1a", 7, shape=sh("rect", (252, 430), (710, 583))),
           st(3, "shape", "#1a1a1a", 7, shape=sh("line", (226, 583), (736, 583))), st(4, "shape", "#1a1a1a", 7, shape=sh("line", (481, 240), (481, 294)))]
    ink += [st(5 + i, "shape", "#8a8a8a", 4, shape=sh("line", (316 + 76 * i, 468), (316 + 76 * i, 583))) for i in range(5)]
    colour = [st(20, "shape", "#e8a317", 8, shape=sh("ellipse", (703, 218), (775, 290))), st(21, "shape", "#e8a317", 8, shape=sh("line", (739, 175), (739, 201))),
              st(22, "shape", "#e8a317", 8, shape=sh("line", (792, 254), (817, 254))),
              st(23, "shape", "#2f7d4f", 7, shape=sh("ellipse", (145, 456), (209, 536))), st(24, "shape", "#2f7d4f", 7, shape=sh("line", (177, 520), (177, 590))),
              st(25, "shape", "#2f7d4f", 7, shape=sh("ellipse", (765, 480), (813, 544))), st(26, "shape", "#2f7d4f", 7, shape=sh("line", (789, 540), (789, 590))),
              st(27, "pen", "#0f766e", 10, ground)]
    return drawing.DrawingDoc.model_validate({
        "version": 1, "width": 1600, "height": 1350,
        "layers": [{"id": "l1", "name": "Colour", "strokes": colour}, {"id": "l2", "name": "Ink", "strokes": ink},
                   {"id": "l3", "name": "Background", "strokes": []}]})


async def make_image(db, hexcol: str, alt: str) -> Media:
    out = images.process_image(tinted(hexcol))
    prefix = images.new_prefix()
    for name, (data, ctype) in out["files"].items():
        await storage.put(f"{prefix}/{name}", data, ctype)
    m = Media(kind="image", prefix=prefix, variants=out["variants"], width=out["width"], height=out["height"],
              blurhash=out["blurhash"], alt=alt, caption="")
    db.add(m)
    await db.flush()
    return m


async def make_drawing(db) -> Media:
    doc = dome_doc()
    png = drawing.render_png(doc, 1.0)
    files, variants = images.make_variants(Image.open(io.BytesIO(png)))
    files["full.png"] = (png, "image/png")
    variants["png"] = True
    svg = drawing.to_svg(doc)
    files["drawing.svg"] = (svg.encode(), "image/svg+xml")
    variants["svg"] = True
    prefix = images.new_prefix()
    for name, (data, ctype) in files.items():
        await storage.put(f"{prefix}/{name}", data, ctype)
    await storage.put(f"{prefix}/doc.json", doc.model_dump_json().encode(), "application/json")
    m = Media(kind="drawing", prefix=prefix, variants=variants, width=doc.width, height=doc.height, alt="[Alt text: a line drawing of a domed building with two trees and a sun]",
              caption="[Caption in the author's words]", drawing_json_key=f"{prefix}/doc.json")
    db.add(m)
    await db.flush()
    return m


def P(text, **kw):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


async def seed(demo_stats: bool = True, owner_only: bool = False):
    await storage.ensure_bucket()
    async with SessionLocal() as db:
        s = await db.get(SiteSettings, 1)
        if not s:
            db.add(SiteSettings(id=1, blocklist=STARTER_BLOCKLIST))
            await db.flush()
        owner = (await db.execute(select(User).where(User.role == "owner"))).scalars().first()
        if not owner:
            owner = User(login_id="admin", email=cfg.owner_email.lower(), name="Owner", role="owner", must_change_password=True,
                         password_hash=hash_password(cfg.initial_admin_password))
            db.add(owner)
            await db.commit()
            print()
            print("==== STUDIO OWNER ====")
            print("Login ID: admin     Password: admin@123")
            print("This is the starting password. Change it in Studio > Settings > Security right after you sign in")
            print("(with ENV=prod the Studio refuses to do anything else until you do).")
            print()
        if owner_only:
            await db.commit()
            print("Owner and settings created. No sample posts (--owner-only).")
            return
        if (await db.execute(select(func.count()).select_from(Post))).scalar():
            print("Content already present; skipping sample posts.")
            await db.commit()
            return
        topics = [Topic(slug=f"topic-{n}", name=f"[Topic {n}]") for n in ("one", "two", "three", "four")]
        db.add_all(topics)
        imgs = [await make_image(db, t, f"[Alt text for placeholder picture {i + 1}]") for i, t in enumerate(TINTS)]
        dome = await make_drawing(db)
        t_now = now()

        def blog(title, standfirst, cover, extra, ago_days, tops, slug=None):
            body = {"type": "doc", "content": [P("[Opening paragraph of the blog.]"), P("[Second paragraph.]"),
                                                {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "[Section heading]"}]},
                                                P("[Paragraph.]")] + extra}
            body = content.normalize_body(body)
            text = content.plain_text(body)
            return Post(type="blog", title=title, standfirst=standfirst, body_json=body, body_text=text, excerpt=standfirst, slug=slug or content.slugify(title),
                        cover_media_id=cover.id, status="published", publish_at=t_now - dt.timedelta(days=ago_days), comments_open=True,
                        read_minutes=max(2, content.read_minutes(text)), topics=tops)

        rich = [{"type": "gallery", "attrs": {"items": [{"mediaId": imgs[1].id, "alt": "[Alt text]"}, {"mediaId": imgs[2].id, "alt": "[Alt text]"}], "caption": "[Caption for the pair]"}},
                {"type": "pullQuote", "content": [{"type": "text", "text": "[A line from the piece worth pulling out.]"}]},
                P("[Paragraph leading into the drawing.]"),
                {"type": "drawing", "attrs": {"mediaId": dome.id, "wide": True, "caption": "[Caption in the author's words]", "alt": "[Alt text: a domed building with two trees and a sun]"}},
                P("[Closing paragraph.]")]
        posts = [
            blog("[Blog title, clear and calm, up to three lines]", "[Standfirst: one or two sentences on what this piece argues.]", imgs[0], rich, 1, topics[:2]),
            blog("[Blog title]", "[One-line summary.]", imgs[1], [P("[Closing paragraph.]")], 6, topics[1:3], "blog-title-two"),
            blog("[Blog title]", "[One-line summary.]", imgs[2], [P("[Closing paragraph.]")], 12, topics[2:4], "blog-title-three"),
            blog("[Blog title]", "[One-line summary.]", imgs[3], [P("[Closing paragraph.]")], 38, topics[:1], "blog-title-four"),
        ]

        def thought(text, ago_h, media=None, tops=()):
            nodes = [P(text)] + ([{"type": "drawing", "attrs": {"mediaId": media.id, "caption": "", "alt": "[Alt text: a domed building with two trees and a sun]"}}] if media else [])
            body = content.normalize_body({"type": "doc", "content": nodes})
            return Post(type="thought", body_json=body, body_text=content.plain_text(body), excerpt=content.make_excerpt(body), status="published",
                        publish_at=t_now - dt.timedelta(hours=ago_h), cover_media_id=media.id if media else None, read_minutes=1, topics=list(tops))

        posts += [thought("[A short thought, shown in full right here in the list. One to four sentences.]", 2, tops=topics[:1]),
                  thought("[A thought with a drawing beside it.]", 30, dome, topics[1:2]),
                  thought("[Another short thought.]", 24 * 9, tops=topics[2:3]),
                  thought("[An older thought, from last month.]", 24 * 40)]
        db.add_all(posts)
        await db.flush()

        for p, n in zip(posts, (42, 27, 12, 8, 18, 33, 9, 5)):
            for _ in range(n):
                db.add(Reaction(post_id=p.id, kind="agree", anon_id_hash=anon_hash(secrets.token_hex(8))))
        first = posts[0]
        ok = Comment(post_id=first.id, author_name="Meera R.", body="[A comment, exactly as approved.]", status="approved", likes=4)
        db.add(ok)
        await db.flush()
        db.add(Comment(post_id=first.id, parent_id=ok.id, author_name="Author", is_author=True, body="[The author replies inline, one level in.]", status="approved", likes=1))
        db.add(Comment(post_id=first.id, author_name="Sanjay J.", body="[Another comment. Long comments fold after six lines.]", status="approved", likes=2))
        for n, b, f in (("Aarav K.", "[Comment text as submitted.]", []), ("Priya V.", "[Comment with links. Links are not clickable here.] http://a.example http://b.example http://c.example", ["3 links"]),
                        ("Meera R.", "[Comment text as submitted.]", []), ("Xavier X.", "[Comment text as submitted.]", ["possibly abusive"]), ("Sanjay J.", "[Comment text as submitted.]", [])):
            db.add(Comment(post_id=posts[1].id, author_name=n, body=b, status="waiting", flags=f, ip_hash=secrets.token_hex(16),
                           created_at=t_now - dt.timedelta(minutes=random.randint(5, 600))))
        for i in range(3):
            db.add(Subscriber(email=f"reader{i}@example.com", status="confirmed", token=token(), confirmed_at=t_now - dt.timedelta(days=i * 4)))
        db.add(Post(type="blog", title="[A draft blog]", body_json={"type": "doc", "content": [P("[Draft text.]")]}, body_text="[Draft text.]", status="draft", comments_open=True))
        if demo_stats:
            today = dt.datetime.now(dt.timezone.utc).date()
            v = 60
            blogs = posts[:4]
            for i in range(120, -1, -1):
                v = max(15, min(220, v + random.randint(-14, 16)))
                r = round(v * random.uniform(0.38, 0.58))
                d = today - dt.timedelta(days=i)
                db.add(DailyStat(date=d, visitors=v, readers=r, new_subscribers=random.choice((0, 0, 0, 1, 2))))
                w = [8, 4, 2, 1]
                for p, share in zip(blogs, w):
                    db.add(PostDailyRead(post_id=p.id, date=d, readers=max(0, round(r * share / sum(w)))))
            print("Demo analytics added (120 days of sample numbers). Run `make seed ARGS=--no-demo-stats` for a clean slate.")
        await db.commit()
        print(f"Seeded {len(posts)} sample posts with placeholder copy.")


async def e2e_user():
    """Dev only: (re)create a throwaway owner for browser tests and print its credentials as JSON."""
    if not cfg.is_dev:
        sys.exit("e2e-user only runs with ENV=dev")
    password = "E2e-Test-Pass-" + secrets.token_hex(6)
    async with SessionLocal() as db:
        u = (await db.execute(select(User).where(User.login_id == "e2e"))).scalar_one_or_none()
        if not u:
            u = User(login_id="e2e", email="e2e@example.com", name="E2E", role="owner", password_hash="x")
            db.add(u)
        u.password_hash, u.must_change_password = hash_password(password), False
        await db.execute(text("DELETE FROM auth_failures"))
        # let repeated test runs comment again: forget the fingerprint on earlier test comments
        await db.execute(text("UPDATE comments SET ip_hash = NULL WHERE author_name LIKE 'E2E%'"))
        await db.commit()
    print(json.dumps({"login_id": "e2e", "password": password}))


async def check():
    """Connection test for a new deployment: database, media bucket and backup bucket. Prints what to fix."""
    from sqlalchemy import text as _t
    ok = True

    def line(name, good, detail=""):
        nonlocal ok
        ok = ok and good
        print(f"  {'OK    ' if good else 'FAILED'}  {name}" + (f"  ({detail})" if detail else ""))

    print("Checking your settings (secrets are never printed):")
    try:
        async with SessionLocal() as db:
            await db.execute(_t("SELECT 1"))
            ver = (await db.execute(_t("SHOW server_version"))).scalar()
        line("Database connection", True, f"PostgreSQL {ver}")
    except Exception as e:  # noqa: BLE001
        hint = "wrong password, or you used the Direct connection instead of the Session pooler" if "password" in str(e).lower() or "tenant" in str(e).lower() or "network" in str(e).lower() else type(e).__name__
        line("Database connection", False, hint)
    for label, backup in (("Media bucket", False), ("Backup bucket", True)):
        try:
            import asyncio as _a
            await _a.to_thread(lambda: storage.client(backup).head_bucket(Bucket=storage.bucket(backup)))
            line(label + " '" + storage.bucket(backup) + "'", True)
        except Exception as e:  # noqa: BLE001
            code = getattr(e, "response", {}).get("Error", {}).get("Code", type(e).__name__)
            line(label + " '" + storage.bucket(backup) + "'", False,
                 {"404": "bucket does not exist: create it in Supabase > Storage", "NoSuchBucket": "bucket does not exist: create it in Supabase > Storage",
                  "403": "keys rejected or wrong region", "SignatureDoesNotMatch": "wrong secret key or region", "InvalidAccessKeyId": "wrong access key"}.get(code, code))
    print()
    print("All good." if ok else "Fix the items marked FAILED, then run this again.")


async def ensure_owner():
    """Runs at every start on hosts without a shell: creates the settings row and the starting owner login only if there
    is no owner yet (so it never touches a password you have already changed)."""
    async with SessionLocal() as db:
        if not await db.get(SiteSettings, 1):
            db.add(SiteSettings(id=1, blocklist=STARTER_BLOCKLIST))
            await db.flush()
        if not (await db.execute(select(User.id).where(User.role == "owner").limit(1))).first():
            db.add(User(login_id="admin", email=cfg.owner_email.lower(), name="Owner", role="owner", must_change_password=True,
                        password_hash=hash_password(cfg.initial_admin_password)))
            print("Created the starting owner login: admin (it must be changed at first sign-in).")
        await db.commit()


async def reset_password(login_id: str):
    """Operator tool: set a new random password for a login ID; the owner must change it at the next sign-in."""
    password = secrets.token_urlsafe(12) + "-Aa1!"
    async with SessionLocal() as db:
        u = (await db.execute(select(User).where(User.login_id == login_id.strip().lower()))).scalar_one_or_none()
        if not u:
            sys.exit("No such login ID.")
        u.password_hash, u.must_change_password = hash_password(password), True
        await db.execute(text("DELETE FROM sessions WHERE user_id = :u"), {"u": u.id})
        await db.execute(text("DELETE FROM auth_failures"))
        await db.commit()
    print(f"New password for {login_id}: {password}")
    print("All sessions were ended. It must be changed at the next sign-in.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "seed":
        asyncio.run(seed("--no-demo-stats" not in sys.argv, "--owner-only" in sys.argv))
    elif cmd == "check":
        asyncio.run(check())
    elif cmd == "ensure-owner":
        asyncio.run(ensure_owner())
    elif cmd == "reset-password" and len(sys.argv) > 2:
        asyncio.run(reset_password(sys.argv[2]))
    elif cmd == "e2e-user":
        asyncio.run(e2e_user())
    elif cmd == "backup":
        asyncio.run(backup())
    elif cmd == "restore":
        asyncio.run(restore(sys.argv[2] if len(sys.argv) > 2 else None))
    else:
        sys.exit("usage: python -m app.cli check | seed [--no-demo-stats | --owner-only] | backup | restore [name] | reset-password <login_id>")
