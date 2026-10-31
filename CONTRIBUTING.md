# Contributing

Proprietary project. Work happens on short lived branches (`feature/*`, `fix/*`, `hotfix/*`, `chore/*`, `docs/*`) and lands through pull requests.

## Commits
Conventional Commits: `<type>(<scope>): <subject>`.
Types: feat, fix, chore, docs, refactor, test, perf, ci, build.
Scopes: web, api, shared, rules, renderer, qa, storage, worker, docs, infra, ci, deps.

## Ground rules
1. **The Prisma schema is the source of truth.** If code needs a new field or status, write a Prisma migration (`apps/api/prisma/migrations`). Do not invent a parallel structure.
2. **The backend defines the API contract** (`docs/01-SPEC-v3.md` section 7). The frontend adapts to it.
3. **Rules R1 to R20** follow `docs/source-parts/Resume_Engine_Spec_v3.1.txt` and are documented in `docs/RULES.md`.
4. Before opening a pull request: `pnpm typecheck && pnpm test && pnpm lint && pnpm check:tokens`.

See `docs/DECISIONS.md`.
