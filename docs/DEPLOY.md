# Deploying Space hopes on a VM (Oracle Cloud free VM + Cloudflare)

> No card, or Oracle signup fails? Use **`docs/DEPLOY-FREE.md`** (Render + Supabase) instead.

One free always-on server runs the whole site with Docker Compose. Cloudflare (free) sits in front for the domain, protection and caching; Cloudflare R2 (free tier) stores pictures and backups; Resend (free tier) sends email. **The only cost is the domain.**

```
Visitor ──> Cloudflare (DNS, WAF, DDoS, Turnstile) ──> Oracle VM ──> Caddy (HTTPS) ──┬─> web  (Next.js)
                                                                                     └─> api  (FastAPI) ──> Postgres (on the VM)
                                                                                                        └─> R2 (pictures, drawings, backups)
```

Everything below was tested on a local copy of the production setup: fresh database and migrations, HTTPS through Caddy, `ENV=prod` behaviour, forced password change, and throttling that cannot be dodged with fake IP headers. What could not be tested from here is your real Oracle, Cloudflare and Resend accounts.

## What to know first (honest drawbacks)

* **Idle reclamation.** Oracle may reclaim a free VM that stays idle for 7 days (CPU, network and, on ARM, memory all under 20%). A quiet site can look idle. The VM size below keeps memory use above the line, and uptime monitoring plus off-site backups mean the worst case is a 30-minute rebuild (section 8).
* **"Out of capacity".** Free ARM machines in busy regions (Mumbai, Hyderabad) are often full. Retry later or in another availability domain. Upgrading the account to **Pay As You Go** (you still pay nothing inside the free limits) usually fixes it. Note that reclamation applies to upgraded accounts too.
* **You are the operator.** Security updates are automatic (the setup script turns them on), but you should look at it monthly. It is one machine, so there is no failover.
* **Email limit.** Resend's free plan sends 100 emails a day (3,000 a month). A post emails every confirmed subscriber, so a list over 100 needs a paid plan or another provider.

## 1. Accounts (about 30 minutes)

1. **Cloudflare** (free): add your domain and change its nameservers at your registrar as Cloudflare tells you.
2. **R2** (Cloudflare dashboard > R2; it asks for a payment method but the free tier is 10 GB, no egress fees): create two buckets, `spacehopes-media` and `spacehopes-backups`. Create an API token for each (*Object Read & Write*, limited to that bucket). Ideally put the backups bucket on a *different* Cloudflare account, so one lost account does not lose everything. Note the endpoint `https://<account-id>.r2.cloudflarestorage.com`.
3. **Turnstile** (Cloudflare dashboard): add a widget for your domain, mode **Invisible**. Note the site key and secret.
4. **Resend**: add your domain and add the DNS records it shows (set those records to *DNS only*, grey cloud). Create an API key. Sending as `hello@your-domain`.
5. **Oracle Cloud**: sign up at oracle.com/cloud/free. Pick your **home region** carefully (Mumbai or Hyderabad); it cannot be changed.
6. **GitHub**: create a *private* repository and push this project (`.env` is git-ignored). From the project folder:
   ```bash
   git add -A && git commit -m "Space hopes"
   git remote add origin git@github.com:YOU/spacehopes.git && git push -u origin master
   ```

## 2. Create the VM (about 15 minutes)

Oracle console > **Compute > Instances > Create instance**:

* **Image:** Canonical Ubuntu 24.04. **Shape:** *VM.Standard.A1.Flex* with **2 OCPUs and 6 GB** memory (this stack uses roughly 1.5 GB, which keeps memory use above Oracle's idle line; 12 GB would not).
* **Boot volume:** 100 GB. **SSH keys:** paste your public key (or let Oracle generate one and save it).
* **Networking:** public IPv4 on. Afterwards, *Networking > Reserved public IPs* and attach one so the address never changes.
* In the VCN's **Security List**, add ingress rules for TCP **80** and **443** from `0.0.0.0/0`.

## 3. DNS

Cloudflare > DNS > add an **A** record `@` pointing at the VM's public IP, **proxied** (orange cloud). Add `www` too if you want it (and a redirect rule to the bare domain). SSL/TLS mode: **Full (strict)**.

## 4. Set up the VM

```bash
ssh ubuntu@YOUR_VM_IP
git clone git@github.com:YOU/spacehopes.git thoughts   # use a deploy key or a token for a private repo
cd thoughts
bash scripts/vm-setup.sh        # Docker, swap, firewall, key-only SSH, fail2ban, automatic updates
exit                            # log back in once so the docker group applies
ssh ubuntu@YOUR_VM_IP && cd thoughts
bash scripts/gen-env.sh your-domain.com you@private-address.com
nano .env                       # add the R2 keys (media and backups), Resend key, Turnstile keys
```

`gen-env.sh` creates all the random secrets. **Copy `BACKUP_PASSPHRASE` somewhere safe and offline**: without it a backup cannot be restored.

## 5. Start it

```bash
make prod            # builds and starts everything (first build takes ~10 minutes on ARM)
make prod-seed       # creates the owner account only, with no sample posts
```

Open `https://your-domain.com/studio/login` and sign in with **`admin` / `admin@123`**. In production the Studio will not let you do anything else until you set your own password (Settings > Security). Then:

1. Settings: site name, About quote and name, footer line, LinkedIn link, blocklist words, who can comment.
2. Replace the placeholder privacy notice and comment policy (`web/app/(site)/privacy/page.tsx`, `comment-policy/page.tsx`; all text in `[brackets]`) after a legal review, then `git pull && make prod`.
3. Write the first posts.

## 6. Cloudflare hardening (free)

* **Security > Bots:** turn on *Bot Fight Mode*.
* **Security > WAF > Rate limiting rule:** path starts with `/api/v1/studio/auth/` → 10 requests per minute per IP → block for 10 minutes. (The app already throttles guessing; this stops it earlier.)
* **Caching > Cache Rules:** cache `/_next/static/*` and `/api/v1/media/*` ("Eligible for cache", respect origin headers).
* **SSL/TLS > Edge certificates:** Always Use HTTPS on; minimum TLS 1.2.
* Optional, stricter: in Oracle's Security List allow 80/443 only from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/), so the server can only be reached through Cloudflare.

## 7. Keep an eye on it

* **UptimeRobot** (free, 5-minute checks): monitor `https://your-domain.com/api/health` and the home page, with email alerts. This also gives the VM a little steady traffic.
* Look at memory use once: `docker stats --no-stream`. If the whole VM sits under 20% memory the reclamation risk goes up; shrinking the shape to 1 OCPU / 4 GB is a fine fix.
* Monthly: `cd thoughts && git pull && make prod` and `sudo reboot` if Ubuntu asks for it.

## 8. Backups, restore, and rebuilding

* **Nightly at 03:00 IST** the API writes an encrypted `pg_dump` and a media manifest to the backups bucket and keeps the newest 14. Pictures and drawings already live in R2, outside the VM.
* Make one now: `make prod-backup`. Restore the newest: `make prod-restore` (this **replaces** the database; `NAME=2026-10-03_2130` picks another).
* **If the VM is lost or reclaimed:** create a new VM (sections 2 and 4), put the same `.env` back (keep a copy of it, including `BACKUP_PASSPHRASE`, in a password manager), `make prod`, then `make prod-restore`. Point the DNS A record at the new IP. Everything comes back.
* Do one restore drill within the first week, on a throwaway VM or a scratch database.

## 9. Everyday commands (on the VM, in `~/thoughts`)

| | |
|---|---|
| `make prod` | build and start (also used to update after `git pull`) |
| `make prod-logs` | follow logs |
| `make prod-down` | stop (data is kept) |
| `make prod-reset-password ID=admin` | forgotten password: prints a new one, ends all sessions, forces a change |
| `make prod-backup` / `make prod-restore` | back up now / restore |

Logs: containers keep 10 × 10 MB each; Caddy's access log (`/data/access.log` in the `caddydata` volume) keeps about 6 months. For CERT-In's 180-day rule copy these to storage you control (see `docs/SECURITY.md`).

## 10. Free-tier limits at a glance

| Service | Free allowance | Watch for |
|---|---|---|
| Oracle Always Free ARM VM | 2 OCPU, 12 GB RAM total, 200 GB disk, 10 TB/month outbound | idle reclamation; capacity |
| Cloudflare (DNS, WAF, Turnstile) | free | — |
| R2 | 10 GB, 1 M writes and 10 M reads per month, no egress fees | media + backups share the free 10 GB across buckets |
| Resend | 3,000 emails/month, 100/day | subscriber lists over 100 |
| UptimeRobot | 50 monitors, 5-minute checks | — |
| Domain | about ₹700–1,500 a year | — |

## Before you announce the site

- [ ] The starting password is changed.
- [ ] The privacy notice and comment policy are reviewed and rewritten.
- [ ] A backup exists in the backups bucket and one restore has been practised.
- [ ] `https://your-domain.com/api/docs` shows a 404 (docs are off in production).
- [ ] A subscribe test and a contact test arrive in your inbox (Resend domain verified).
- [ ] The Studio sign-in alert email arrives at your private address.
