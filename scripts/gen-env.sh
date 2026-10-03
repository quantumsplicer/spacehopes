#!/usr/bin/env bash
# Creates .env from .env.production.example with fresh random secrets.
#   bash scripts/gen-env.sh your-domain.com you@private-address.com
set -euo pipefail
DOMAIN="${1:?usage: gen-env.sh <domain> <owner-email>}"
OWNER="${2:?usage: gen-env.sh <domain> <owner-email>}"
[ -e .env ] && { echo ".env already exists; move it away first."; exit 1; }
rand() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c "${1:-48}"; }
sed -e "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" -e "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$DOMAIN|" \
    -e "s|^OWNER_EMAIL=.*|OWNER_EMAIL=$OWNER|" -e "s|your-domain.com|$DOMAIN|g" \
    -e "0,/^POSTGRES_PASSWORD=__GENERATE__/s||POSTGRES_PASSWORD=$(rand 32)|" \
    -e "0,/^SECRET_KEY=__GENERATE__/s||SECRET_KEY=$(rand 64)|" \
    -e "0,/^IP_SALT=__GENERATE__/s||IP_SALT=$(rand 48)|" \
    -e "0,/^BACKUP_PASSPHRASE=__GENERATE__/s||BACKUP_PASSPHRASE=$(rand 48)|" \
    .env.production.example > .env
chmod 600 .env
echo "Wrote .env (permissions 600)."
echo "Now edit it: add the R2 keys, Resend key and Turnstile keys:   nano .env"
echo "IMPORTANT: copy BACKUP_PASSPHRASE somewhere safe and offline. Without it backups cannot be restored."
