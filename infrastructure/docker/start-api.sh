#!/bin/sh
# Applies pending Prisma migrations, then starts the API. Run from apps/api (the image's WORKDIR).
# Only the API runs migrations; the worker starts after the API is healthy.
# Calls the Prisma binary directly so the container needs no network (no pnpm download) at start.
set -e
./node_modules/.bin/prisma migrate deploy
exec node dist/main.js
