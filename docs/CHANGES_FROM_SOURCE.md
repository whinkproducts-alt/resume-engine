# Changes from the supplied source

The four code documents are kept unmodified in `docs/source-parts/`, and the first commit of each part extracted them verbatim. This file lists everything that was then changed, and why, so nothing about the supplied code is lost or silently altered.

## Wholesale rewrites

| What | Why |
|---|---|
| `packages/rules` (types, rules, validator, retry, tests) | Part 3's header says its R1 to R20 were "reconstructed" because the spec arrived as placeholders. Compared with the authoritative table, only R2, R9, R10 and R18 matched; the other 16 were different rules. Rewritten against the real table. See [RULES.md](./RULES.md). |
| `packages/renderer` | The layout did not match section 6 (16pt name, 0.5 inch margins, no ▸ flagship, no `1F3864` / `2E74B5` styling). |
| `apps/api/src/workers/run.worker.ts` becomes `apps/api/src/pipeline/*` | Per [DECISIONS.md](./DECISIONS.md) the Prisma schema wins. The worker used models, fields and statuses the schema does not have (`Quota`, `Run.sourceText`, `RunLog.stage`, `COMPLETED`...), restarted the whole pipeline on company confirmation (and failed for file and URL runs), and read `analysis.rawRoles`, which the analysis never produced. |
| `apps/api/src/routes/*` (Express) become Nest modules | `apps/api` is NestJS. Behaviour of `output`, `validation`, `docx`, `pdf` and `admin/2fa/enroll` was kept; `404` replaces `403` for other users' runs per the spec. |
| `apps/web/src/lib/{types,api,auth}` and every screen | The backend defines the contract. The UI called `/api/...` with its own shapes. |

## Targeted fixes to supplied code

| File | Change |
|---|---|
| `packages/rules/src/fact-bank.ts` | Alias matching was by substring, so a claim of "5" was grounded by a fact of "50%". Now exact. Import of a type that did not exist fixed. |
| `packages/rules/src/util/{date,text}.ts` | Did not compile under `noUncheckedIndexedAccess`; made safe. Date helpers trimmed to what the rules use. |
| `tsconfig.base.json`, `packages/*/package.json` | `NodeNext` with extensionless imports did not compile, and the Nest app is CommonJS. Packages now build to CommonJS. Added `tsconfig.json`, `src/index.ts`, build and test scripts, `@types/node`. |
| `packages/qa/src/pdf.ts` | The overflow flag used rule id `R15`; R15 is the keyword rule in the real table. Now `QA`. |
| `apps/api/src/pipeline/stage-6-7-8.ts` | Updated to the new rule and renderer APIs; no longer validates twice; reports QA flags; `onStage` hook. |
| `apps/api/src/auth/auth.{service,controller}.ts` | Spec section 3.1 and 7.1: login returns `{ user, accessToken }`, refresh token in an HttpOnly cookie, rotation with reuse detection, `/auth/refresh`, `/auth/logout`, `/auth/me` returns `{ user }`, admin logins audited. |
| `apps/api/src/jds/*` | Field names `rawText` and `sourceUrl` per section 7.6 (`text` and `url` still accepted). |
| `apps/api/src/profiles/*` | Added `GET /profiles/:id`, roster `PUT`s and base activation (the pipeline needs a roster). |
| `apps/api/prisma/schema.prisma` | Three nullable `User` columns for admin 2FA, through migration `20261031010000_admin_2fa`. |
| `apps/api/.env.example` | Added the Part 3 variables (minus a duplicate `ADMIN_BOOTSTRAP_TOKEN=` that would have blanked the real one), LLM and TOTP variables. `PORT` is 3001 so it does not collide with the web app. |
| `apps/web/tailwind.config.ts` | Opacity modifiers (`bg-gold/10`) do not work on bare `var(--x)` colours and the build failed. Tokens are wrapped with `<alpha-value>` and `color-mix`; the hex values in `globals.css` are untouched. |
| `apps/web/package.json` | Renamed to `@resume-engine/web` (it shared the root's name); test, typecheck, ESLint dependencies. |
| `apps/web/src/components/app-shell.tsx`, `app/(admin)/layout.tsx` | Use the real user fields and `isAdmin`. |

## From the structure document

| File | Change |
|---|---|
| `turbo.json` | `pipeline` is rejected by Turbo 2; renamed `tasks`. |
| `.github/workflows/ci.yml` | The separate `install` job shared nothing, so it was dropped. Added Prisma client generation and the LibreOffice install the pipeline tests need. Never run on GitHub. |
| root `.env.example` | Pointed at the per app env files; it listed variables the code never reads. |
| root `package.json` | As given. Part 3's own root `package.json` and `apps/api/package.json` were not used (the first would override the Turborepo setup, the second would drop NestJS). |

## Added, not in any supplied document

`LICENSE`, `docs/DECISIONS.md`, the quota service, runs, settings, branding and admin modules, `apps/api` project files, the Prisma migrations, `scripts/check-tokens.ts`, `scripts/bootstrap.sh`, Docker Compose, commit lint and hooks, `CODEOWNERS`, the pull request template, the roster editor, and all tests.
