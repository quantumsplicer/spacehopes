#!/usr/bin/env bash
# Starts everything inside the one container. If any part dies, the container exits so Render restarts it.
set -u

# Render tells us its public address; use it unless PUBLIC_URL was set (a custom domain, for example)
export PUBLIC_URL="${PUBLIC_URL:-${RENDER_EXTERNAL_URL:-http://localhost:10000}}"

# 1. the public port first, so Render sees the service as soon as possible
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &

# 2. the website (private port)
( cd /srv/web && PORT=3000 HOSTNAME=127.0.0.1 NODE_OPTIONS="--max-old-space-size=${NODE_HEAP_MB:-160}" exec node server.js ) &

# 3. database migrations, then the API (private port)
( cd /srv/api && alembic upgrade head && python -m app.cli ensure-owner && exec uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log ) &

wait -n
echo "A process exited; stopping the container so it restarts." >&2
exit 1
