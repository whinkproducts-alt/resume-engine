# Resume Engine

Deterministic résumé tailoring engine for agencies and job seekers.
Owner: Victor Igboekwe (Whink Apps). Proprietary, all rights reserved (see `LICENSE`).

Paste a job description, press one button, get a tailored, ATS ready `.docx` (and a PDF) that has passed twenty written rules.

## Repo layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js 14 frontend |
| `apps/api` | NestJS API, BullMQ pipeline and worker, Prisma schema and migrations |
| `packages/rules` | The validator: rules R1 to R20 and the fact bank check |
| `packages/renderer` | DOCX renderer (section 6 layout) |
| `packages/qa` | LibreOffice PDF conversion and page count |
| `packages/storage` | S3 / R2 storage and signed URLs |
| `docs/` | Spec, rules, API, architecture, decisions |
| `infrastructure/` | Docker Compose for local Postgres and Redis |

## Quick start

Needs Node 22, pnpm 9, Docker, and LibreOffice for the pipeline. Details in [docs/ONBOARDING.md](docs/ONBOARDING.md).

```bash
pnpm install
bash scripts/bootstrap.sh
pnpm --filter @resume-engine/api dev
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev servers for the web app and the API (Turborepo) |
| `pnpm build` | Build every workspace |
| `pnpm lint` | ESLint (web) and type check (api) |
| `pnpm typecheck` | `tsc --noEmit` in every workspace |
| `pnpm test` | Vitest in every workspace |
| `pnpm check:tokens` | Fails on hard coded colours in `apps/web/src` |

## Decisions

1. The Prisma schema is the source of truth; the worker adapts to it.
2. The backend defines the API contract; the frontend adapts to it.
3. Proprietary licence.

Details and precedence between the spec documents: [docs/DECISIONS.md](docs/DECISIONS.md). Authoritative sign offs: R18 filename regex, R2 close variant at 70% token overlap, R9 LLM judged and non blocking, R10 per resume and warn only, `POST /admin/2fa/enroll`, bootstrap token in the `X-Bootstrap-Token` header.

## Docs

| | |
|---|---|
| [01-SPEC-v3.md](docs/01-SPEC-v3.md) | Master technical specification |
| [RULES.md](docs/RULES.md) | R1 to R20 as implemented |
| [API.md](docs/API.md) | Endpoints, and what is not built |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it fits together, known gaps |
| [DESIGN_TOKENS.md](docs/DESIGN_TOKENS.md), [03-FRONTEND-STAGE4.md](docs/03-FRONTEND-STAGE4.md) | UI |
| [ONBOARDING.md](docs/ONBOARDING.md), [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Running and deploying |
| [CHANGES_FROM_SOURCE.md](docs/CHANGES_FROM_SOURCE.md) | Everything changed from the supplied code, and why |
| `docs/source-parts/` | The supplied documents, unmodified |
| `docs/03-ui-reference/resume-engine.html` | The supplied UI reference |

## Licence

Proprietary. Copyright (c) 2026 Whink Apps (Whink Group). All rights reserved. See `LICENSE`.
