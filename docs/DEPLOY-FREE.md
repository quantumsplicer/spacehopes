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
| **Email needs a domain** | Resend only lets you email *other people* (subscribers, replies) from a domain you have verified. Until then it only reaches your own address. |
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

Until a mail service is added the site says "Email sign-up is not switched on yet" instead of pretending to send, and the Studio shows a red notice in Settings. Pick **one**:

**A. Brevo (easiest without a domain).** brevo.com > sign up (free, 300 emails a day, no card) > **Senders, Domains & dedicated IPs > Senders > Add a sender**: use an address you control (for example your Gmail) and click the confirmation link they email you. Then **SMTP & API > SMTP**: note the *login* and create an *SMTP key*. Set these in Render's Environment tab:

| Name | Value |
|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | the SMTP login Brevo shows |
| `SMTP_PASSWORD` | the SMTP key |
| `SMTP_TLS` | `true` |
| `MAIL_FROM` | `Space hopes <the sender address you verified>` |

Honest caveat: sending "from" a free Gmail address through Brevo works, but Gmail's own rules mean such emails often land in spam. For reliable delivery to subscribers, own a domain and verify it with Brevo or Resend.

**B. Gmail.** In the Google account turn on 2-step verification, create an *App password* (myaccount.google.com > Security > App passwords), then set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=your gmail address`, `SMTP_PASSWORD=the app password`, `SMTP_TLS=true`, `MAIL_FROM=Space hopes <your gmail address>`. Gmail allows about 500 emails a day.

**C. Resend (best once you own a domain).** resend.com > sign up > **API Keys** > create one (`RESEND_API_KEY`) and verify your domain (**Domains**: add the DNS records it lists), then `MAIL_FROM=Space hopes <hello@your-domain>`. Without a verified domain Resend only delivers to your own address. Free plan: 100 emails a day.

After saving the variables Render redeploys by itself. Test: subscribe on the site with your own address; the confirmation email should arrive within a minute.

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
   | `SMTP_*` / `RESEND_API_KEY`, `MAIL_FROM` | step 2 (can be added after the first deploy) |
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
