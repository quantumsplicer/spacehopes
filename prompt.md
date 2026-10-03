# Build brief: "Thoughts, unsigned" (anonymous writing site + private studio)

You are building a production-ready personal publishing platform:
- a **public site**: a feed of short Thoughts and longer Blogs, with images and hand-drawn colour drawings inside posts, public comments, an anonymous About page and a contact form;
- a **private Studio** (admin): writing, a drawing studio built for iPad and Apple Pencil, comment moderation, audience numbers and settings.

The approved designs are in `/design`. It contains screenshots of every screen: website desktop, website phone, Studio desktop and Studio phone. **Match them closely.** Where a screenshot and this brief disagree, the brief wins, and you should tell me about the conflict.

Work in phases (section 13). Before writing any code, read this whole brief and every image in `/design`, then reply with:
1. your plan,
2. the repo structure,
3. any questions.

Wait for my go-ahead. After each phase, stop, summarise what you built and how to run it, and wait.

---

## 1. Non-negotiable rules

- **Anonymous.** No real name, photo, designation, biography or achievements anywhere. The site name is a setting (placeholder `Name`), shown only as a small italic wordmark in the header. It is never shown large and never in the footer.
- **White background everywhere.** Colour comes only from the teal accent, soft tints, images and drawings. There are no large black areas.
- **Two post types only: Thought and Blog.** Drawings and images always live *inside* a post. There is no standalone sketch page, gallery or bookshelf.
- **Comments need only a name by default.** No account and no email. A Studio setting can switch the site to "signed-in readers only".
- **Copying is disabled on posts by default** (toggle in Settings).
- **Placeholders.** Any copy I haven't supplied goes in `[square brackets]`. Never use lorem ipsum.
- **No recurring cost beyond the domain.** Use open-source components and free tiers only, all runnable with Docker Compose on one free VM.
- **Security first.** The owner is a public official. Treat every input as hostile.
- **Accessibility.** WCAG 2.1 AA, a minimum 44×44px touch target, and every animation switched off under `prefers-reduced-motion`.

---

## 2. Stack

**Frontend: `/web`**
- Next.js 15 (App Router, TypeScript, Server Components where sensible).
- Tailwind CSS, with the tokens in section 3 as CSS variables.
- Fonts via `next/font/google`: **Source Serif 4** (headings, post text, italic thoughts) and **Public Sans** (all interface text).
- Motion: CSS keyframes and transitions for most effects. Use Motion (framer-motion) only for list re-ordering, layout changes and the tab indicator. Don't add GSAP.
- Editor: TipTap with a custom `/` menu and nodes for drawing, image, gallery and quote.
- Drawing: `perfect-freehand` plus a custom canvas engine (section 8).

**Backend: `/api`**
- FastAPI on Python 3.12, with Pydantic v2.
- SQLAlchemy 2 (async) and Alembic, on PostgreSQL 16.
- Pillow for images.
- `slowapi` for rate limits.
- `py_webauthn` (passkeys) and `pyotp` (TOTP).
- `nh3` for sanitising HTML.
- `boto3` for S3-compatible storage (Cloudflare R2 in production, MinIO locally).
- Resend for email, with SMTP as a fallback, behind an interface.
- APScheduler inside the API for scheduled publishing, image variants, daily stats rollups and backups. No Redis and no Celery.

**Infrastructure**
- `docker-compose.yml` with `web`, `api`, `db`, `minio` (dev only) and `caddy` (TLS and reverse proxy).
- Routes: `/` goes to web, `/api/*` goes to api, and the Studio lives at `/studio` (optionally on its own subdomain).
- Production target: one free VM, for example Oracle Cloud Always Free in the Mumbai or Hyderabad region, with Cloudflare's free plan in front for DNS, WAF, DDoS protection and Turnstile.
- Deliverables: `docs/DEPLOY.md`, `.env.example`, Makefile targets (`dev`, `test`, `migrate`, `seed`, `backup`, `restore`), and placeholder seed data.

---

## 3. Design system ("clean reader")

**Colours**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | Every page |
| `--ink` | `#1a1a1a` | Headings, body text |
| `--ink-2` | `#4d4d4d` | Secondary text, excerpts |
| `--muted` | `#6b6b6b` | Dates, meta, help text |
| `--line` | `#ececec` | Hairlines, card borders |
| `--input` | `#d4d4d4` | Input and ghost-button borders |
| `--teal` | `#0f766e` | Accent: primary buttons, active states, links, the "Thought" label, the Visitors series |
| `--teal-tint` | `#effaf8` | Soft panels (subscribe, confirmations, active nav) |
| `--teal-line` | `#cfe7e3` | Borders on tinted panels |
| `--teal-soft` | `#9cc9c3` | The Readers series in charts |
| `--heart` | `#e0445a` | Liked state |
| `--flag-fg` / `--flag-bg` | `#b42318` / `#fdecec` | Flagged comments |
| `--sched-fg` / `--sched-bg` | `#3b4fb8` / `#eef2ff` | "Scheduled" status |
| Thumbnail tints | `#cfe7e3`, `#f6d9c6`, `#d9e2f6`, `#e6f2e8` | Image placeholders and fallback covers |

**Type**
- Headings and post text use Source Serif 4. The hero headline is about 124px on desktop and 58px on a phone.
- Blog titles in lists are 30px at weight 600. Thoughts are 26px italic.
- Post body text is 21px with a 1.75 line height, on a 680–728px column.
- Interface text uses Public Sans at 13–16px.

**Shape and layout**
- Shapes: buttons are 999px pills, at least 44px tall. Cards have a 16–18px radius, inputs 10px, and thumbnails 10–14px.
- Primary button: teal (or ink for "Start reading"). Secondary button: white with a `--input` border.
- Layout: a max-width 1240px container with side padding of `clamp(20px, 4vw, 64px)`.
- Header: 72px tall and sticky, white at 86% opacity with a 12px backdrop blur.
- The feed and sidebar sit in a flex layout: main column at least 600px, sidebar 300px and sticky.

**Motion** (all of it off under reduced motion)

| Name | Effect |
|---|---|
| `rise` | Opacity 0 to 1 and translateY 28px to 0, over 0.9s with `cubic-bezier(.2,.7,.2,1)`. Headlines rise word by word with an 80ms stagger. |
| `fade` | Opacity only, 0.6s. List rows fade in with a 50–60ms stagger. |
| `float` | The hero's latest-thought card drifts ±8px with a slight rotation, on a 7s loop. |
| `pulse` | The teal dot on the "New thought" badge pulses. |
| `draw` | Drawings draw themselves on first view using stroke-dashoffset, with each stroke group delayed. This is a one-time load effect only; there is no replay button. |
| `row hover` | Background goes to `#fafcfb`, the thumbnail scales to 1.05, the title underline grows left to right, and a "Read →" link slides in. |
| `lift` | Cards and buttons rise 3px on hover with a soft teal shadow. |
| `chip hover` | Topic chips fill teal. |
| `tabs` | The underline indicator slides between tabs over 0.45s, and the list filters with a fade. |
| `pointer glow` | A 600px radial teal glow at 8% opacity follows the pointer on the home hero, the Thought page and the About page. |
| `pop` | Success ticks and the liked heart scale in with a slight overshoot. |
| `progress` | A 3px teal reading-progress bar sits at the top of post pages. |

---

## 4. Public site (desktop and phone; match `/design`)

**Header:** the small italic `Name` wordmark, then Thoughts/Feed, About and Contact. The active page gets a teal underline. Next come a Search pill showing a `/` shortcut (it opens a command-palette style search) and a teal Subscribe button. On phones it collapses to the wordmark and a menu button.

**Footer:** one quiet line: "*Thoughts, unsigned.* Views expressed are my own." followed by Privacy, Comment policy and RSS.

### 4.1 Home `/`
- **Hero:**
  - A "New thought, [time ago]" badge with a pulsing dot.
  - The headline "Thoughts, *unsigned.*" in teal italic, rising word by word.
  - The intro line: "Short thoughts and longer blogs, written slowly and shared without a face. Read them for what they say, and leave yours beside them."
  - Two buttons: **Start reading** (ink, scrolls to the feed) and **Surprise me** (swaps the card for a random older Thought, via `GET /api/thoughts/random`).
  - On the right, a floating card shows the latest Thought in full.
  - The pointer glow follows the cursor across the hero.
- **Feed** (left):
  - Tabs: Everything, Thoughts, Blogs, with the sliding indicator, plus a "[N] posts" count.
  - Each row shows the type label (Thought in teal, Blog in ink), the date and the read time. Then comes the title: Blogs in bold serif with a one-line excerpt, Thoughts in full italic.
  - Each row has a heart button (one per browser, using an anonymous id in localStorage) and a comment count, with a thumbnail on the right. Thoughts with a drawing show a mini drawing instead.
  - Rows use the hover behaviour from section 3. A "See the whole feed" button closes the list.
- **Sidebar** (sticky):
  - An "About this notebook" line linking to About.
  - A subscribe box: email, then "Almost there. Check your inbox to confirm." (double opt-in).
  - The latest drawing, with its draw-in animation and a link to its post.
  - Topic chips.

### 4.2 Thoughts/Feed `/feed`
- The title "Thoughts/*Feed*", a one-line intro and a large rounded search field.
- The tabs bar stays pinned under the header while scrolling. Posts are grouped by month, with italic month labels, and use cursor pagination ("Load older posts").
- The sidebar has topics, a month archive with counts and a subscribe link.
- Search is full-text using Postgres `tsvector`, across titles, bodies and captions.

### 4.3 Blog `/p/[slug]`
- **Top:** the progress bar, a "Thoughts/Feed / **Blog**" breadcrumb, the title (bold serif, around 72px), the italic standfirst, and a meta row (date, read time, comment count, Share and Copy link).
- **Body:**
  - The cover image has an 18px radius and a gentle zoom on hover, with a caption.
  - Supported blocks: paragraph, heading, image, gallery (pair or swipeable), pull quote (teal left rule, italic), frameless drawing (opens a full-screen lightbox), YouTube embed and divider.
  - Every image and drawing opens in an accessible lightbox with swipe, arrow keys, Esc and focus trap.
- **Reactions:** the Agree heart (pops when tapped), "Worth thinking about", Share and Copy link.
- **Conversation** (section 6), then **Keep reading**: two related blogs as image cards plus one related thought as a teal-tint card, chosen by shared topics.

### 4.4 Thought `/t/[id]`
- The whole page is the thought: large italic serif, rising in, with the pointer glow. An optional drawing or up to 4 images sit below it.
- Then the reactions, the Conversation section and previous/next thought cards.

### 4.5 About `/about` (deliberately anonymous)
- An "About" label, then the quote rising word by word with "thinker." in teal: "Judge the thought, not the thinker. The words here are meant to stand on their own." The quote is editable in Settings and marked `[to be confirmed]`.
- Below it, a teal-tint card: "If you would like to know the person behind these pages, write to me." with a **Reach out** button.

### 4.6 Contact `/contact`
- The heading "Write *to me.*" and the line "Every message is read. A reply may take a little while."
- The form fields:
  - name and email;
  - a topic chosen from pills: A response to a post, General message, Media, Something else;
  - the message;
  - a consent checkbox linking to the privacy notice (DPDP Act 2023), with invisible Cloudflare Turnstile.
- On send, the form is replaced by a tick that pops in and "Received. Thank you."
- **There is no office address and no grievance-portal notice.** Either would reveal who the owner is.

### 4.7 Phone
Every public page has a phone layout, as in `/design`:
- the feed tabs pin under the header;
- posts have a floating "Add your thoughts" bar that opens the comment form as a bottom sheet;
- the drawing and the reactions sit inline.

---

## 5. Copy protection (Settings toggle, on by default)

On thoughts, blogs and the feed:
- disable text selection with `user-select: none`;
- block `copy`, `cut`, `contextmenu` and `dragstart`;
- disable the iOS long-press callout with `-webkit-touch-callout: none`;
- stop image saving and dragging.

When someone tries, show a small ink pill toast: "Copying is turned off. Use Share to send the link."

Form fields, the comment box and the Copy link button stay usable. Text must stay readable by screen readers and search engines. The README must say this is a deterrent: screenshots can't be blocked. An optional second toggle adds a faint server-side watermark to uploaded images and drawings.

---

## 6. Comments

- **Mode 1 (default): name only.** The reader enters "Your name" and "Your thoughts". There's no email and no account.
- **Mode 2: signed-in readers.** Readers sign in with Google OAuth or a one-time email code. Only their name is shown and the email is never displayed.
- **Review before showing** (on by default). After posting, the form becomes a teal-tint confirmation with a tick: "Thank you. Your comment is awaiting review. It will show up here once it has been read."
- **Display:**
  - Threads go one level deep. The owner's replies carry a teal "Author" badge and avatar.
  - Each comment has Like and Reply. Sort by most liked or newest; long comments fold after 6 lines.
  - Comments are plain text only, rendered escaped, with no clickable links.
- **Auto-checks** run on submit:
  - rate limit per IP-hash (5 per 10 minutes)
  - link count (flag if more than 1)
  - an English and Hindi blocklist (editable in Settings)
  - duplicate detection
  - a honeypot field
  - Turnstile
  Flagged comments always need a human decision.
- **Blocking** uses a salted hash of IP and user agent. Raw IPs are never stored.
- **Hidden comments** are kept for the record, never hard-deleted.

---

## 7. Studio `/studio` (desktop and phone; match `/design`)

**Shell:** a light sidebar (not dark), `#fcfcfc` with a right hairline. It holds the italic `Name` wordmark with a "Studio" pill, then Overview, Posts, Drawings, Media, Comments (with a teal count badge), Subscribers and Settings. The active item gets a teal tint. At the bottom, a card shows "Signed in with passkey", the last sign-in and a "View the site" link.

On phones the Studio uses a bottom tab bar: Overview, Write, Comments and Settings.

### 7.1 Sign in
- A centred card on white with a soft teal glow.
- Step 1: "Welcome back." with **Sign in with passkey** (WebAuthn) and a "Use a recovery code" link.
- Step 2: "One more step." with six digit boxes for the TOTP code.
- Note on the card: "Every sign-in is recorded and you get an email alert."
- Sessions: httpOnly, Secure, SameSite=Strict cookies, with CSRF protection, a 12-hour absolute timeout and a 30-minute idle timeout.
- Roles: **owner**, and an optional **editor** who can draft and moderate but can't publish or change settings.
- Every action goes into an append-only `audit_log`.

### 7.2 Overview (match the A2 design exactly)
- **Header:** "Overview" with a subtitle describing the period ("Last 30 days, compared with the period before"). A period switch (Today, 30 days, 90 days, All time) sits next to the New thought and New blog buttons.
- **Four summary cards**, each with the number, a change chip versus the previous period, a sparkline and a one-line definition:
  1. **Visitors** (teal-tint card): times the site was opened, **one per browser session**, any page.
  2. **Readers:** blog pages opened, **one per blog per browser session**. Thoughts are read in the feed, so they aren't counted as reads.
  3. **Read rate:** readers divided by visitors.
  4. **New subscribers:** people who confirmed their email in the period.
- **Chart: "Visitors and readers" by day.**
  - Paired bars: Visitors in teal, Readers in `--teal-soft`.
  - A y-axis with gridlines, and date labels along the bottom.
  - Clicking a day shows a dark tooltip with that day's figures.
  - Legend buttons hide or show each series. Bars animate when the period changes.
- **Needs your attention:** counters for comments waiting, flagged comments, drafts and the next scheduled post, each with its action (Review, Check, Continue, Open). Footnote: "Counted without cookies or personal data. Bots are filtered out."
- **Top blogs by readers:** rank, title, an animated proportional bar with the count, and comments.
- **Latest activity:** new comments, confirmed subscribers, publishes and flags, each with a coloured dot.
- **Phone version:** Visitors and Readers cards, a teal "Comments waiting" card, New thought and New blog buttons, and a Recent list.

### 7.3 Editor
- **Top bar:** "Draft, saved [time]" with a pulsing dot, a Thought / Blog switch, then Preview, Schedule and Publish (teal).
- **Thought:** a large italic textarea ("Write a thought. One to four sentences.") plus one optional drawing or up to 4 images.
- **Blog:** title, standfirst, then the block editor.
- **The "+" and `/` menu:** Drawing (listed first in teal; opens the studio and inserts the result), Image, Gallery, Heading, Quote and Divider.
- **Images:**
  - On-image toolbar: Replace, Crop, Wide, Remove.
  - Caption, and **required** alt text (Publish is blocked without it).
  - Upload by drag, paste or bulk select. Accept JPG, PNG, WebP and HEIC; reject SVG.
  - The server re-encodes each image into WebP and AVIF at 640, 1280 and 2048 wide, strips all EXIF and GPS data ("Location data is removed on upload"), and stores a blurhash.
- **Side panel:** cover, excerpt, topics, a "Comments open" switch, a publish date, and version history.
- **Autosave** every 5 seconds, with conflict detection. Scheduled posts are published by the scheduler.
- **Phone "Write" screen:** the Thought / Blog switch, the italic textarea, a drawing preview, Draw and Photo buttons, and Publish.

### 7.4 Drawing studio (iPad and Apple Pencil first; the hardest part, so do it well)

**Layout**
- Top bar: Cancel, caption, Undo, Redo, zoom %, a **Pencil only** switch and a teal **Add to post** button.
- A floating vertical tool rail on the left, a white canvas in the centre, and a Layers card on the right.
- A floating bottom bar for size, opacity and colour.

**Tools:** Pen, Pencil, **Colour pencil** (grainy texture that responds to pressure), Marker, Brush, Eraser (stroke and pixel), Lasso (move, scale, recolour), Shapes (line, rectangle, ellipse, auto-straighten on hold) and Text.

**Colour**
- 13 swatches: Black `#1a1a1a`, Graphite `#4a4a4a`, Silver `#a3a3a3`, White, Crimson `#c62828`, Rose `#e57399`, Saffron `#e8a317`, Ochre `#c9a227`, Leaf `#2f7d4f`, Teal `#0f766e`, Indigo `#3b4fb8`, Violet `#6a3fb5`, Earth `#795548`.
- Plus a custom colour picker and recent colours. The selected swatch scales up and gets a teal ring.
- Colour works on every tool. Three sizes and an opacity slider sit beside the swatches.

**Input**
- Pointer Events with `touch-action: none`, reading pressure, tilt and `altitudeAngle`.
- Use `getCoalescedEvents()` where supported.
- Pencil-only mode ignores touch for drawing, which gives palm rejection.
- Two fingers pan and pinch-zoom; a two-finger tap undoes and a three-finger tap redoes.
- Suppress Scribble, the magnifier loupe, text selection and double-tap zoom.

**Rendering**
- Use perfect-freehand outlines.
- Cache committed strokes per layer on offscreen canvases, and redraw only the live stroke each frame with `requestAnimationFrame`.
- Stay smooth with more than 2,000 strokes, using DPR-aware sizing with a cap for Safari memory limits.
- Target under 16ms per frame on a 2021 iPad Pro, with a dev-only FPS overlay.

**Layers:** at least 5, which can be reordered, hidden and locked. Offer an optional "Import a photo to trace" layer.

**Save**
- The source of truth is a vector JSON document: layers, then strokes, each with points [x, y, pressure], tool, colour, size, opacity and seed.
- On save, also render a transparent PNG and WebP (1x and 2x) and an SVG where possible.
- Reopening a drawing loads the JSON so it stays editable.
- Autosave drafts to IndexedDB.

**Do not** build stroke replay or time-lapse. Write `docs/DRAWING.md`.

### 7.5 Comments (moderation)
- The header shows "Commenting: name only, reviewed first", with a Change link to Settings.
- Tabs: Waiting, Approved, Hidden and Spam, each with a count. The active tab gets a teal underline.
- Each row shows: tinted initials, name, which post, time, the comment in serif, a status chip ("Looks fine" in teal, or "Flagged: …" in red), and the actions Approve (teal), Reply (posted as Author), Hide and Block.
- Rows fade out as they're handled, ending at the empty state: a tick and "All caught up."
- On phones, each comment is a card with Approve, Hide and "…".

### 7.6 Settings
- **Who can comment:** two radio cards, "Anyone, with just a name" (default) and "Only signed-in readers". A live preview on the right shows exactly what readers will see.
- **Switches:**
  - Review comments before they appear (on).
  - Turn off copying on posts (on).
  - Watermark images and drawings (off).
- **Also editable:** site name, About quote, footer line, social links and blocklist words.

---

## 8. Analytics (privacy-first: no cookies, no third-party scripts)

- **Visitor:** on the first page load of a browser session, if `sessionStorage.v` is unset, POST `/api/track/visit` and set the flag.
- **Reader:** on a Blog page, if `sessionStorage['r:'+postId]` is unset, POST `/api/track/read` and set the flag.
- **Storage:** only aggregates, in `daily_stats(date, visitors, readers, new_subscribers)` and `post_daily_reads(post_id, date, readers)`. Never store IPs or user agents for analytics.
- Bot filtering uses user-agent and rate limits.
- The Overview's comparisons, sparklines and read rate are computed from these tables.

---

## 9. Data model (minimum)

- `users`, `webauthn_credentials`, `totp_secrets`, `sessions`, `audit_log`
- `posts`: id, type (thought or blog), slug, title?, standfirst?, body_json, body_text, excerpt, cover_media_id?, status (draft, scheduled or published), publish_at, comments_open, search_tsv, created_at, updated_at
- `post_versions`, `topics`, `post_topics`
- `media`: id, kind (image or drawing), keys and variants, width, height, blurhash, alt, caption, drawing_json_key?
- `comments`: id, post_id, parent_id?, author_name, reader_account_id?, body, status (waiting, approved, hidden or spam), flags, ip_hash, likes, created_at
- `reader_accounts`, `blocks`, `reactions` (post_id, kind, anon_id_hash: unique together)
- `subscribers`, `contact_messages`
- `settings` (single row)
- `daily_stats`, `post_daily_reads`

---

## 10. API (`/api/v1`; OpenAPI docs in dev only)

**Public**
- `GET /feed?type=&cursor=&q=`
- `GET /posts/{slug}`, `GET /thoughts/{id}`, `GET /posts/{id}/related`
- `GET /thoughts/latest`, `GET /thoughts/random?exclude=`
- `GET|POST /posts/{id}/comments`, `POST /comments/{id}/like`
- `POST /posts/{id}/reactions`
- `POST /subscribe`, `GET /subscribe/confirm`, `GET /unsubscribe`
- `POST /contact`
- `POST /track/visit`, `POST /track/read`
- `GET /settings/public`
- Reader auth: `/reader/google/*` and `/reader/otp/*`

**Studio (auth required)**
- Auth: WebAuthn register and login, TOTP, sessions
- Posts: CRUD, versions, publish and schedule
- Media upload (streamed) and drawing save/load
- Comments: list and bulk actions
- Settings
- `GET /stats/overview?period=` (everything the Overview needs in one response)
- Subscribers export, contact messages, audit log

---

## 11. Security checklist

- **Headers:** strict CSP with nonces, `frame-ancestors 'none'`, HSTS, Referrer-Policy and Permissions-Policy.
- **Validation:** Pydantic on every input, with length caps (name 60 characters, comment 2,000 characters).
- **Uploads:** magic-byte check, size cap, decompression-bomb guard, re-encode everything, randomised keys, and a private bucket served through signed or proxied URLs.
- **Database:** ORM or parameterised SQL only.
- **Rate limits:** on all public POSTs, plus brute-force lockout on Studio auth.
- **Secrets:** from the environment only. Nothing sensitive in logs.
- **Logs:** keep security logs for 180 days (CERT-In).
- **Backups:** nightly encrypted `pg_dump` plus a media manifest to R2, with a tested `make restore`.
- **Dependencies:** pin versions, and run `pip-audit` and `npm audit` in CI.

---

## 12. Quality bar

- **Tests:**
  - pytest for auth, both comment modes, moderation, the visitor/reader counting rules, uploads and settings.
  - Playwright for these journeys: read a blog; comment with a name only; comment in sign-in mode; subscribe; send a contact message; the owner writes a blog with an image and a drawing, moderates, and sees the Overview numbers change.
- **Lighthouse:** 95+ on Performance, Accessibility, Best Practices and SEO for Home, Feed and Blog on mobile.
- **Responsive:** down to 360px.
- **SEO:** server-rendered pages, sitemap, RSS and OG images. Copy protection stays in the UI only.
- **Docs:** `README.md`, `docs/DEPLOY.md`, `docs/DRAWING.md`, `docs/SECURITY.md` and `docs/OWNER-GUIDE.md` (plain-language guide for the owner).

---

## 13. Phases (stop after each)

1. **Foundation.** Monorepo, Docker Compose, schema and migrations, settings, design tokens and fonts, header and footer, motion utilities, seed data.
2. **Public reading.** Home (hero, glow, floating card, Surprise me, feed tabs, row hovers, sidebar), Feed, Blog, Thought, About and Contact, with phone layouts.
3. **Studio core.** Passkey and TOTP sign-in, the Studio shell, Editor (Thought and Blog, blocks, image pipeline, autosave, schedule), and the phone Write screen.
4. **Drawing studio.** Engine, tools, colour pencil, palette, layers, save and reopen, editor integration. Test on a real iPad and report.
5. **Conversation.** Both comment modes, moderation (desktop and phone), reactions, Author replies, blocklist and Settings.
6. **Audience.** Visitor and reader tracking, rollups, the full Overview (desktop and phone), subscribers and email.
7. **Protection and hardening.** Copy protection, watermark, security headers, rate limits, backups, audit log, and the full test pass.
8. **Polish and deploy.** A motion pass against section 3, reduced-motion checks, Lighthouse fixes, deploy docs and the owner guide.