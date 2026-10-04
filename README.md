# Space hopes

The website of **Saravanan Murugan, IAS**, and a private Studio. Short **Thoughts** and longer **Blogs**, with pictures and hand-drawn colour drawings inside posts, public comments, an anonymous About page and a contact form. The Studio is where the owner writes, draws (built for iPad and Apple Pencil), moderates comments and reads audience numbers.

Design: `design/` (22 screens). Brief: `prompt.md`. **Going live:** `docs/DEPLOY-FREE.md` (no card: Render + Supabase) or `docs/DEPLOY.md` (a VM, e.g. Oracle Cloud free).

## Run it on your computer

You need **Docker Desktop**. Nothing else.

```bash
cp .env.example .env     # already done for you in this checkout; edit before any real deployment
make dev                 # builds and starts everything
make seed                # sample content + the owner account (login ID admin, password admin@123: change it)
```

| What | Where |
|---|---|
| The site | http://localhost:8080 |
| The Studio | http://localhost:8080/studio |
| Every email the site sends (confirmations, codes, alerts) | http://localhost:8025 (Mailpit) |

**First sign-in.** The starting login is **ID `admin`, password `admin@123`**. Sign in at `/studio/login`, then change the password straight away in *Settings > Security* (you can change the login ID there too). While the starting password is in use the Studio shows a red banner; with `ENV=prod` it refuses to do anything else until it is changed. `make seed` creates this account on a fresh database.

The sample posts, comments, subscribers and 120 days of analytics are placeholders and demo numbers (copy is in `[square brackets]`). For a clean slate use `make seed ARGS=--no-demo-stats` on an empty database, then delete the sample posts in *Studio > Posts*.

### Commands

| `make` | |
|---|---|
| `dev` / `down` / `logs` | start, stop, follow logs |
| `migrate` | apply database migrations (also automatic on start) |
| `seed` | placeholder content and the owner account |
| `test` | backend tests (95), on a throwaway database and bucket |
| `e2e` | browser journeys (Playwright, 12), see below |
| `backup` / `restore` | encrypted `pg_dump` + media manifest to the bucket; `make restore` replaces the current database with the newest backup (`NAME=...` for another) |
| `audit` | `pip-audit` and `npm audit` (also in CI) |

Browser tests need `cd web && npm ci && npx playwright install chromium` once.

## What is where

```
web/      Next.js 15 (App Router, TypeScript), Tailwind, TipTap editor, drawing engine
api/      FastAPI, SQLAlchemy 2 (async), Alembic, Pillow, py_webauthn, pyotp, APScheduler
docker/   Caddy (TLS and reverse proxy)
docs/     DEPLOY, DRAWING, SECURITY, OWNER-GUIDE
```

Compose services: `db` (Postgres 16), `s3` (dev object store), `mailpit` (dev mail), `api`, `web`, `caddy`. `/` goes to web, `/api/*` to api, the Studio lives at `/studio`.

## Things you should know (conflicts and deviations from the brief)

1. **No MinIO.** MinIO no longer publishes its Docker images (Docker Hub repo removed, `quay.io` refuses anonymous pulls), so the local `minio` service is **Scality CloudServer** (`zenko/cloudserver`), which speaks the same S3 API. Production still targets Cloudflare R2; nothing in the code is specific to either.
2. **Copying is a deterrent, not protection.** Selection, copy, cut, right-click, drag and the iOS long-press callout are blocked on posts and the feed, with the toast *"Copying is turned off. Use Share to send the link."* Screenshots cannot be blocked. Text stays readable to screen readers and search engines. The optional watermark is applied at upload time (server side) to new images and drawings.
3. **Real iPad testing has not been done.** The drawing engine is written for Pencil (pressure, tilt, coalesced events, palm rejection, two- and three-finger taps) and checked with mouse/pen-style pointer events in desktop Chromium. It needs an hour on a real iPad before you rely on it. See `docs/DRAWING.md` for what to check.
4. **Lighthouse (95+) has not been measured.** No Lighthouse run was possible here. The pages are server-rendered, use self-hosted fonts, responsive AVIF/WebP images with blurhash, and no third-party scripts except the invisible Turnstile widget on forms. Measure after deploying (see `docs/DEPLOY.md`).
5. **Turnstile** uses Cloudflare's public always-pass *test* keys locally.
6. **Design vs brief.** The brief wins. Differences: the drawing studio starts with three layers as in the screenshot but allows up to 12; the Contact page shows RSS only until you add social links in Settings (the design's X and Instagram would identify the owner); the *About* quote's `[to be confirmed]` marker appears in Settings only, never on the public page.
7. **"Daily stats rollups"**: counts go straight into `daily_stats` and `post_daily_reads` as aggregates (one atomic upsert per event), so no separate rollup job is needed. Scheduled publishing, housekeeping and the nightly encrypted backup run inside the API with APScheduler. Image variants are made while the upload request runs.
8. **Security logs (180 days).** The `audit_log` table is append-only (a database trigger blocks changes) and is never pruned. Keep container logs for 180 days in your log host (see `docs/SECURITY.md`).
9. Docker note for this machine: another Compose project called `thoughts-unsigned` already existed here (older containers on ports 80/443/3010/5433/8010/9000). This stack uses its own project name `tu-site` and port 8080 so the two do not interfere. Building the API image under the old project name replaced that project's `thoughts-unsigned-api:latest` image tag once, before the rename (its running containers were not touched).

## Tests

* `make test`: sign-in (scrypt hashes, generic errors, server throttling with growing waits, session rotation, password change and revocation, default-password enforcement, CSRF, origin, idle and absolute timeouts, roles, append-only audit log), both comment modes, moderation, abusive-word screening (disguised spellings included), duplicate, honeypot and rate limit, visitor and reader counting rules, uploads (magic bytes, SVG rejected, EXIF/GPS stripped, size cap, variants, blurhash), drawings round trip, scheduling, conflicts, search and pagination.
* `make e2e`: read a blog; comment with a name only; comment in signed-in mode (code read from Mailpit); subscribe (double opt-in); send a contact message; copy-block toast; search palette; the owner writes a blog with an image and a drawing, is blocked by missing alt text, publishes, moderates a comment and sees Overview numbers move; Studio phone layout.

The browser tests sign in through the real login form (with a throwaway `e2e` account created by `python -m app.cli e2e-user`, dev only) and also cover the front-end lock-out countdown and changing the password in the dashboard.
