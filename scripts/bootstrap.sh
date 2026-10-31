#!/usr/bin/env bash
# Local setup: start Postgres and Redis, apply migrations, generate the Prisma client.
# The admin account is created by the API on first boot (ADMIN_EMAIL / ADMIN_SEED_PASSWORD).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f apps/api/.env ] || cp apps/api/.env.example apps/api/.env
echo "Edit apps/api/.env (JWT_SECRET, ADMIN_SEED_PASSWORD, LLM_*, S3_*, TOTP_ENCRYPTION_KEY) before running the API."

docker compose -f infrastructure/docker/docker-compose.yml up -d --wait

cd apps/api
set -a; . ./.env; set +a
pnpm exec prisma migrate deploy
pnpm exec prisma generate
echo "Ready. Run: pnpm dev"
