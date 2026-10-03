#!/usr/bin/env bash
# Run an admin command against the LIVE site from your own computer (hosts like Render's free plan have no shell).
#   bash scripts/admin.sh reset-password admin
#   bash scripts/admin.sh backup
#   bash scripts/admin.sh restore            # replaces the live database with the newest backup!
# Needs Docker Desktop and a file named .env.remote (copy .env.remote.example and fill it from your Render dashboard).
set -euo pipefail
[ -f .env.remote ] || { echo "Create .env.remote first (see .env.remote.example)."; exit 1; }
docker build -q -t spacehopes-admin ./api >/dev/null
docker run --rm --env-file .env.remote -e ENV=prod spacehopes-admin python -m app.cli "$@"
