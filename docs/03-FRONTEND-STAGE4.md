# Frontend (Stage 4) — Next.js 14

Code: `apps/web`. Original source document: `docs/source-parts/Resume_Master_Engine_part_4.txt`.

Stack (from `apps/web/package.json`): Next.js 14.2.15 (App Router), React 18, TypeScript, Tailwind 3, TanStack Query 5, axios and zod (declared as dependencies), lucide-react, react-dropzone, date-fns.

## Screens

Route groups `(app)` and `(admin)` do not appear in URLs.

| # | URL | File under `apps/web/src/app/` | What it does |
|---|---|---|---|
| 01 | `/dashboard` | `(app)/dashboard/page.tsx` | Five most recent runs (`GET /api/runs?limit=5`) |
| 02 | `/profiles` | `(app)/profiles/page.tsx` | List profiles; create one with a name |
| 03 | `/profiles/[id]` | `(app)/profiles/[id]/page.tsx` | View/edit a profile; upload a base résumé |
| 04 | `/new` | `(app)/new/page.tsx` | Start a run: choose profile, then JD by paste, file or URL |
| 05 | `/runs/[id]` | `(app)/runs/[id]/page.tsx` | Progress through five stages (SSE, falls back to polling) |
| 06 | `/runs/[id]/confirm` | `(app)/runs/[id]/confirm/page.tsx` | Confirm the inferred company (shows confidence and evidence) |
| 07 | `/runs/[id]/review` | `(app)/runs/[id]/review/page.tsx` | Two-pane review: edit bullets, regenerate a section, see validation flags, download DOCX/PDF |
| 08 | `/history` | `(app)/history/page.tsx` | Search/filter past runs; duplicate a run |
| 09 | `/settings` | `(app)/settings/page.tsx` | Ten accuracy toggles, theme note, account |
| 10 | `/admin/users` | `(admin)/admin/users/page.tsx` | Users with monthly run usage and limit |
| 11 | `/admin/runs` | `(admin)/admin/runs/page.tsx` | All runs |
| 12 | `/admin/audit` | `(admin)/admin/audit/page.tsx` | Audit log (limit 200) |
| 13 | `/admin/reproduce` | `(admin)/admin/reproduce/page.tsx` | Re-run a run; sends `X-Bootstrap-Token` |
| 14 | `/agency-branding` | `(app)/agency-branding/page.tsx` | Logo, primary colour, footer text |
| — | `/login` | `login/page.tsx` | Email and password sign-in |

There is no `app/page.tsx`, so `/` currently has no route (the structure document calls for a redirect to `/dashboard` or `/login`).

Progress stages shown on screen 05: Ingest JD, Parse profile, Draft sections, Validate, Render.

## Shell, auth and data

- **Providers** (`components/providers.tsx`): TanStack Query (30 s stale time, no refetch on window focus, one retry for queries, none for mutations) and `AuthProvider`. Query devtools load in development only.
- **Auth** (`lib/auth.tsx`, `lib/api.ts`): the access token is held in memory. On load the app calls `POST /api/auth/refresh` with credentials included. A 401 on any request triggers one refresh and one retry.
- **Guards**: `(app)/layout.tsx` redirects to `/login` when signed out. `(admin)/layout.tsx` also redirects to `/dashboard` unless the role is `admin` or `owner`.
- **Navigation** (`components/app-shell.tsx`): Dashboard, Profiles, New run, History, Settings, Agency; admin nav is Users, Runs, Audit, Reproduce.
- **Types** (`lib/types.ts`): `User`, `Profile`, `Run`, `ValidationFlag`, `Section`, `Bullet`, `RunReview`, `HistoryRow`, `AuditEntry`, `Branding`, `Settings`.

The endpoints these screens call are listed in [API.md](./API.md), with their status against the backend.

## Not in the provided code

The 2FA admin page, `hooks/`, `tests/`, and the config files `.eslintrc.cjs`, `next.config.mjs`, `tsconfig.json`, `vitest.config.ts` and `playwright.config.ts` are in the structure document but not in the source parts.
