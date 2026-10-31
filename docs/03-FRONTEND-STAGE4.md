# Frontend (Stage 4) — Next.js 14

Code: `apps/web`. The original Part 4 document is `docs/source-parts/Resume_Master_Engine_part_4.txt`. The code was then aligned to the backend contract (see [DECISIONS.md](./DECISIONS.md) and [CHANGES_FROM_SOURCE.md](./CHANGES_FROM_SOURCE.md)).

Stack: Next.js 14.2 (App Router), React 18, TypeScript, Tailwind 3, TanStack Query 5, react-dropzone, date-fns, lucide-react.

## Screens

Route groups `(app)` and `(admin)` do not appear in URLs.

| URL | What it does | API |
|---|---|---|
| `/login` | Email and password sign in | `POST /auth/login` |
| `/dashboard` | Five most recent runs | `GET /runs?limit=5` |
| `/profiles` | List; create (name, full name, city, phones, email, LinkedIn) | `GET`, `POST /profiles` |
| `/profiles/[id]` | Edit header, upload and activate base résumés, edit the roster (roles, education, certifications) | `GET`, `PATCH /profiles/:id`, `/bases`, `PUT .../roles`, `.../education`, `.../certs` |
| `/new` | Choose profile, add the JD (paste, file, URL), optional location override, generate | `POST /jds`, then `POST /runs` |
| `/runs/[id]` | Live progress, cancel, retry, error text | `GET /runs/:id`, `/events`, `POST .../cancel`, `.../retry` |
| `/runs/[id]/confirm` | Confirm the inferred company | `POST .../confirm-company` |
| `/runs/[id]/review` | JD beside the résumé preview and the validator; DOCX and PDF downloads. Read only. | `GET .../output`, `.../validation`, `.../docx`, `.../pdf`, `GET /jds/:id` |
| `/history` | Filter by status, filter loaded rows by text, load more, download, run again | `GET /runs?status&cursor`, `POST /runs` |
| `/settings` | The ten toggles (three are applied by the pipeline today, seven are saved only) | `GET`, `PUT /settings` |
| `/agency-branding` | Name, contact, footer text, accent colour. Saving needs an Agency account. | `GET`, `PUT /me/branding` |
| `/admin/users`, `/admin/runs`, `/admin/audit` | Admin tables | `GET /admin/...` |
| `/admin/reproduce` | Inspect a run's pinned versions and reproduce it | `GET /admin/runs/:id`, `POST .../reproduce` |
| `/admin/2fa` | Enroll an authenticator app, confirm with a code | `POST /admin/2fa/enroll`, `/verify` |

`/` redirects to `/dashboard` or `/login`.

## How it talks to the backend

- Every call is under `/v1` (`src/lib/api.ts`). `next.config.mjs` rewrites `/v1/*` to `API_ORIGIN`, so the browser stays on one origin and the refresh cookie (`Path=/v1/auth`) is first party.
- The access token is held in memory. On load, `POST /auth/refresh` (cookie) then `GET /auth/me` restores the session. A 401 triggers one shared refresh and one retry; auth endpoints are never retried.
- Errors arrive as `{ error: { code, message } }` and are thrown as `ApiError(status, code, message)`.
- Progress uses the SSE endpoint, read with `fetch` because `EventSource` cannot send an Authorization header, and falls back to polling `GET /runs/:id` every 2 seconds.

## What is not there

Inline bullet editing and per section regenerate (the backend has no endpoints for them yet), a fact bank screen, billing, batches, a logo upload, and a sign in code prompt for 2FA.

## Tests

`tests/unit` (Vitest): the API client (prefix, bearer, refresh single flight, error envelope, 204), the SSE parser, and the run, form and roster helpers. `pnpm --filter @resume-engine/web test`. A production `next build` passes and the sign in page was checked in headless Chromium; no screen has been driven against a running backend.
