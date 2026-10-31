# Onboarding

Requirements: Node 22 (`.nvmrc`), pnpm 9, Docker. LibreOffice Writer and the Carlito font (`fonts-crosextra-carlito`, metric compatible with Calibri) are needed to run the pipeline and its tests.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env          # fill it in
cp apps/web/.env.example apps/web/.env.local
bash scripts/bootstrap.sh                        # Postgres + Redis, migrations, Prisma client
```

`scripts/bootstrap.sh` and the Docker Compose file could not be run where this repo was prepared (no Docker there). Read them before relying on them.

Run (three terminals):

```bash
pnpm --filter @resume-engine/api dev            # API on :3001
pnpm --filter @resume-engine/api build && pnpm --filter @resume-engine/api worker
pnpm --filter @resume-engine/web dev            # web on :3000
```

Put single quotes around `ADMIN_SEED_PASSWORD` if it contains symbols such as `&`, `$`, `#` or `;`.

`apps/api/.env` needs at least `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_SEED_PASSWORD` (the admin is created on first API start), and for the worker `LLM_API_KEY`, `LLM_MODEL_ANALYZE`, `LLM_MODEL_WRITE`, and the `S3_*` values. Admin 2FA also needs `TOTP_ENCRYPTION_KEY` (32 random bytes, base64).

First run, as the admin: create a profile, upload a base résumé named like `Jane Doe_Product_Acme.docx`, enter the roster on the profile page, then start a run.

Checks, the same ones CI runs:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm check:tokens
pnpm build
```
