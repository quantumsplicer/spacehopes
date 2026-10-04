# Deploying for free, without a credit card (Render + Supabase)

This route needs **no credit or debit card**: one free **Render** web service runs the whole site, **Supabase** holds the database and the pictures, **Resend** sends email, **UptimeRobot** keeps the free service awake. The only cost is a domain name, and that is optional at the start.

```
Visitor ──> Render (free web service, one container) ──┬─ Caddy ─> website (Next.js)
                                                        └─────────> API (FastAPI) ──┬─> Supabase Postgres  (database)
                                                                                    ├─> Supabase Storage   (pictures, drawings)
                                                                                    └─> Resend             (email)
```

**I built and rehearsed exactly this container locally** under Render's 512 MB memory limit: fresh database, the first admin created automatically, browsing, sign-in, big-photo uploads (a 48-megapixel phone photo peaks at ~295 MB), drawing and publishing, backup and restore, and the throttling that cannot be dodged with fake IP headers. What I could not test from here is your real Render and Supabase accounts, so expect to paste a few values.

## Be honest about the trade-offs

| | What it means for you |
|---|---|
| **Slow first load** | The free Render service sleeps after 15 minutes without visitors; waking takes about a minute. UptimeRobot's 5-minute ping (step 6) keeps it awake. |
| **Small, shared CPU** | Pages render more slowly than on a paid server (often 1 to 2 seconds). Uploading a photo or saving a drawing can take several seconds. Fine for a personal site, not for heavy traffic. |
| **Small storage** | Supabase free: 500 MB database, 1 GB for pictures and backups, 50 MB per file. That is a few hundred posts and a thousand-odd photos. |
| **Supabase pausing** | Free projects pause after a week of inactivity. The site talks to the database every 30 seconds, so it stays active. If a project ever does pause, open the Supabase dashboard and click *Restore*. |
| **No server shell** | Render's free plan has no terminal. Admin tasks (reset a password, backup, restore) run from your own computer with `scripts/admin.sh` (step 8). |
| **Email limits** | Free Render blocks SMTP, so mail goes through a Gmail Apps Script relay (about 100 emails a day) or Resend (needs a domain). A post that is emailed to more than 100 subscribers in a day needs a bigger plan. |
| **Free tiers can change** | Check Render's and Supabase's pricing pages occasionally. |

If you later get a card and want a faster, always-on server, `docs/DEPLOY.md` (Oracle VM route) is ready; your data moves over with `scripts/admin.sh backup` and `restore`.

## 1. Supabase: database and files (about 15 minutes)

Make **two** free projects (free accounts get two). Project 1 is the live site, project 2 only holds backups, so one lost account does not lose everything.

For project 1 (call it `spacehopes`):

1. supabase.com > sign up (GitHub or email) > **New project**. Region: **Mumbai** (or Singapore). Choose a database password made only of **letters and numbers** (special characters break the connection string). Save it.
2. Click **Connect** (top of the project) > **Session pooler** and copy the connection string. It looks like `postgresql://postgres.PROJECTREF:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`. Put your password in. Add `?sslmode=require` at the end. This is `DATABASE_URL`. (Use the *session pooler*, not "direct": the free plan's direct connection is IPv6-only and Render can't reach it.)
3. **Storage** > **New bucket** > name `media`, keep it **private**.
4. **Project Settings > Storage > S3 Connection**: copy the **Endpoint** (it looks like `https://PROJECTREF.storage.supabase.co/storage/v1/s3`) and the **Region**. Click **New access key** and copy the Access key ID and Secret. These are `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`; the bucket is `S3_BUCKET=media`.

For project 2 (call it `spacehopes-backups`): do the same only for the storage part: create a private bucket `backups`, and copy its endpoint and keys. They become `S3_BACKUP_*`.

### Check your Supabase values before going further (2 minutes)

On your own computer, with Docker Desktop running, in the project folder:

```bash
cp .env.remote.example .env.remote      # then open .env.remote and fill in the values from above
bash scripts/admin.sh check
```

It prints `OK` or `FAILED` (with what to fix) for the database, the media bucket and the backup bucket. It never prints your secrets. `.env.remote` is git-ignored; delete it when you are done, or keep it for later admin tasks (step 8).

## 2. Email (needed for subscriptions and reader sign-in codes)

**Render's free plan blocks the usual email ports (25, 465 and 587)**, so ordinary SMTP (Gmail, Brevo and so on) cannot work from it. Email has to travel over HTTPS. Until it is set up the site says "Email sign-up is not switched on yet" and the Studio shows a red notice in Settings.

**Option A (recommended): send from your Gmail address through a small Google Apps Script.** Free, about 5 minutes, no Google Cloud project, and the mail really leaves from your Gmail account (so it is trusted by Gmail). A normal Gmail account can send about **100 emails a day** this way.

1. Sign in to the Gmail account that should send (for example `spacehopes@gmail.com`) and open script.google.com > **New project**.
2. Replace the code with the contents of `docs/mail-relay.gs`. Change `PASTE-THE-SECRET-HERE` to a long random secret (any 40+ random letters and digits; keep a copy). The same value goes into Render as `APPS_SCRIPT_MAIL_SECRET`.
3. Choose the function **authorize** at the top and click **Run** once. Google asks you to approve sending email: click through (*Advanced > Go to project (unsafe)* is normal for your own script).
4. **Deploy > New deployment**, type **Web app**, *Execute as:* **Me**, *Who has access:* **Anyone**, **Deploy**. Copy the **Web app URL** (it ends in `/exec`).
5. In Render's Environment tab add:

   | Name | Value |
   |---|---|
   | `APPS_SCRIPT_MAIL_URL` | the Web app URL from step 4 |
   | `APPS_SCRIPT_MAIL_SECRET` | the secret from step 2 |
   | `MAIL_FROM` | `Space hopes <spacehopes@gmail.com>` (the Gmail address; it is the display name that matters) |

6. Render redeploys. Then check it from your computer: `bash scripts/admin.sh test-email you@example.com` (needs `.env.remote` with the same three values). It prints SENT, or the exact reason it failed.

Anyone who knows the URL but not the secret cannot send anything. If the secret ever leaks, change it in the script, deploy a **new version**, and update Render.

**Option B: Resend (best once you own a domain).** resend.com > sign up > **API Keys** (`RESEND_API_KEY`) and verify your domain under **Domains**, then `MAIL_FROM=Space hopes <hello@your-domain>`. Resend is also HTTPS, so it works on Render. Free plan: 100 emails a day. Without a verified domain it only delivers to your own address.

(Plain SMTP with `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` is still supported for hosts that allow it, such as the VM route in `docs/DEPLOY.md`, but not on Render's free plan.)

After saving, subscribe on the site with your own address; the confirmation email should arrive within a minute (check spam the first time).

## 3. Cloudflare Turnstile (optional, 5 minutes)

A free Cloudflare account (no card) > Turnstile > add a site > widget mode **Invisible**. Use its site key and secret as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`. Skip this and the forms still work, protected by the hidden trap field and rate limits, just without the bot check.

## 4. Put the project on GitHub

Create a **private** repository at github.com, then in the project folder:

```bash
git add -A
git commit -m "Space hopes"
git remote add origin https://github.com/YOU/spacehopes.git
git push -u origin master
```

(`.env` files are git-ignored. Never commit keys.)

## 5. Render: create the service (about 20 minutes, most of it the first build)

1. render.com > sign up with GitHub (no card needed for the free plan).
2. **New + > Blueprint** > pick your repository. Render reads `render.yaml` and shows a service called `space-hopes` on the **Free** plan, region **Singapore**.
3. It asks for the values marked "you fill these in". Paste them from steps 1 to 3:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | step 1.2 |
   | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, and `S3_REGION` (already `ap-south-1`: change it to the region on Supabase's S3 page if different) | step 1.4 |
   | `S3_BACKUP_ENDPOINT`, `S3_BACKUP_ACCESS_KEY`, `S3_BACKUP_SECRET_KEY`, `S3_BACKUP_BUCKET` | project 2 |
   | `INITIAL_ADMIN_PASSWORD` | a temporary password only you know. The repository is public, so do **not** rely on the documented `admin@123`: a stranger could sign in first. You replace this password the first time you sign in |
   | `OWNER_EMAIL` | your private email: sign-in alerts and contact-form messages go here |
   | `APPS_SCRIPT_MAIL_URL`, `APPS_SCRIPT_MAIL_SECRET`, `MAIL_FROM` (or `RESEND_API_KEY`) | step 2 (can be added after the first deploy) |
   | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | step 3 (or leave empty) |
   | `PUBLIC_URL` | leave empty at first: the site uses its own `https://space-hopes.onrender.com`-style address. If you add a domain later, set this to `https://your-domain` |

   `SECRET_KEY`, `IP_SALT` and `BACKUP_PASSPHRASE` are generated for you. **Open the Environment tab afterwards and copy `BACKUP_PASSPHRASE` into a password manager**: without it a backup cannot be restored.
4. Click **Apply**. The first build takes 10 to 15 minutes. When it says *Live*, open the URL.

The first start creates the tables and the starting login by itself.

## 6. Sign in, then keep it awake

1. Go to `https://YOUR-SERVICE.onrender.com/studio/login` and sign in with login **`admin`** and the `INITIAL_ADMIN_PASSWORD` you chose. The Studio makes you choose your own password before it lets you do anything else. Then fill in Settings (site name, About quote, LinkedIn link) and write.
2. **UptimeRobot** (uptimerobot.com, free, no card): add an *HTTP(s)* monitor for `https://YOUR-SERVICE.onrender.com/api/health`, interval 5 minutes, with email alerts. This keeps the free service awake, which the scheduled posts and the nightly backup rely on.

Use **one** address for the site and the Studio (either the onrender.com address or your domain, not both): sign-in checks that requests come from the address in `PUBLIC_URL`.

## 7. A domain (when you have one)

Render > your service > **Settings > Custom Domains** > add `your-domain` and `www.your-domain` and create the DNS records Render shows (a CNAME to the onrender.com address; at your registrar, or in Cloudflare with the cloud set to **DNS only**, grey). Render issues the HTTPS certificate. Then set `PUBLIC_URL=https://your-domain` in Environment, save (it redeploys), and verify the domain in Resend.

## 8. Admin tasks from your computer

Render's free plan has no terminal, so reset passwords, take backups and restore from your own machine (Docker Desktop must be running):

```bash
cp .env.remote.example .env.remote     # then fill it with the same values as in Render's Environment tab
bash scripts/admin.sh reset-password admin   # prints a new password; you must change it at the next sign-in
bash scripts/admin.sh backup
bash scripts/admin.sh restore                # DANGER: replaces the live database with the newest backup
```

Backups also run **by themselves every night at 03:00 IST** (while the service is awake) into the backups project, keeping the newest 14. Practise one restore into a scratch Supabase project in your first week.

## 9. Before you announce it

- [ ] The starting password is changed.
- [ ] `BACKUP_PASSPHRASE` is saved somewhere safe, and one backup exists in the backups project.
- [ ] The privacy notice and comment policy are rewritten and reviewed (`web/app/(site)/privacy/page.tsx` and `comment-policy/page.tsx`, all text in `[brackets]`); delete the placeholder sample posts.
- [ ] UptimeRobot shows the service as up, and a sign-in alert email reaches your inbox.
- [ ] `https://YOUR-ADDRESS/api/docs` shows 404.

## Rehearse it on your computer first (optional)

`make render-rehearsal` builds the very same container and runs it with a 512 MB limit against a throwaway database and file store: http://localhost:8090 (sign in with `admin` / `admin@123`; mail inbox at http://localhost:8026). `make render-rehearsal-down` removes it.
