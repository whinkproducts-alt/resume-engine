# Deployment

What a deployment needs, from the code. No provider is assumed; `infra/render.yaml` and the Terraform and Kubernetes files in the structure document have not been written.

| Need | Detail |
|---|---|
| PostgreSQL | Run `prisma migrate deploy` from `apps/api` before starting. |
| Redis | The BullMQ queue and the login rate limiter. The rate limiter lets requests through if Redis is down. |
| API process | `node dist/main.js` after `pnpm build`. Set `NODE_ENV=production` (the refresh cookie becomes Secure). |
| Worker process | `node dist/workers/worker-main.js`. Needs LibreOffice and the Carlito font in the same image, `SOFFICE_PATH` if not on `PATH`. |
| Web | `next start`, with `API_ORIGIN` pointing at the API. The browser must reach the API through the web origin (`/v1` is proxied) so the refresh cookie is first party. |
| Object storage | S3 or R2: `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (or the `_ID` / `_ACCESS_KEY` names), optional `S3_ENDPOINT`, `S3_REGION`. Server side encryption on the bucket. |
| Secrets | `JWT_SECRET`, `ADMIN_SEED_PASSWORD`, `ADMIN_BOOTSTRAP_TOKEN`, `LLM_API_KEY`, `TOTP_ENCRYPTION_KEY`, S3 keys. Set them in the host's secret store, never in the repository. |

Before public launch, see the gaps in [ARCHITECTURE.md](./ARCHITECTURE.md), in particular URL fetching and the unenforced 2FA.
