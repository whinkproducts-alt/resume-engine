# Resume Engine

Deterministic résumé tailoring engine for agencies.
Owner: Victor Igboekwe (Whink Apps).

## Repo layout
| Path                | Purpose                                           |
|---------------------|---------------------------------------------------|
| `apps/web`          | Next.js 14 frontend (the Stage 4 deliverable)     |
| `apps/api`          | Backend reference (pipeline, validator, renderer) |
| `packages/shared`   | Types, rule helpers, constants (R2, R9, R10, R18) |
| `docs/`             | Specs, architecture, design tokens                |
| `infrastructure/`   | Docker, Terraform, K8s                            |

## Prerequisites
- Node 20 (`.nvmrc`)
- pnpm 9
- Docker (for local Postgres + Redis)

## Quick start
```bash
pnpm install
cp .env.example .env
pnpm bootstrap           # docker up + migrate + seed
pnpm dev                 # web :3000, api :4000
```

## Scripts
| Command            | What it does                              |
|--------------------|-------------------------------------------|
| `pnpm dev`         | Run web + api in watch mode (Turborepo)   |
| `pnpm build`       | Build all packages/apps                   |
| `pnpm lint`        | ESLint + Prettier check                   |
| `pnpm typecheck`   | `tsc --noEmit` across workspaces          |
| `pnpm test`        | Vitest unit + integration                 |
| `pnpm test:e2e`    | Playwright end-to-end                     |
| `pnpm check:tokens`| Fails if design tokens are hardcoded in `src/` |

## Authoritative decisions (Phase 1, approved by Victor)
- **R18 filename regex** — `^[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+\.docx$`
- **R2 close variant** — 70% token overlap, ignores stop words ("Senior", "Lead", …)
- **R9 LLM judged** — records `warn`, never blocks the run
- **R10 duplicate verb** — per-résumé, `warn` severity, non-blocking
- **2FA** — `POST /admin/2fa/enroll`
- **Bootstrap token** — `X-Bootstrap-Token` header

## Docs
- `docs/source-parts/` — the original Stage 1–4 master code documents (Parts 1–4), kept unmodified. The source files under `apps/` and `packages/` were extracted verbatim from them.
- [Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [Rules](docs/RULES.md), [Design tokens](docs/DESIGN_TOKENS.md) and [Frontend](docs/03-FRONTEND-STAGE4.md) are drafted from the code.
- Master spec and ruleset (`docs/01-SPEC-v3.md`, `docs/02-RESUME_ENGINE_SPEC.md`), plus deployment and onboarding guides, have not been added yet.

## License
Proprietary — © Whink Apps. See `LICENSE`.
