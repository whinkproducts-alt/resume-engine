# Architecture

What the provided code (Parts 1–4) implements today. Planned pieces that were not received are listed at the end.

## Components

| Component | Location | Tech |
|---|---|---|
| Web app | `apps/web` | Next.js 14 App Router, React 18, Tailwind, TanStack Query |
| API | `apps/api/src` (except `workers/`) | NestJS, Prisma, PostgreSQL, argon2, JWT (HS256), ioredis |
| Pipeline worker | `apps/api/src/workers/run.worker.ts` | BullMQ on Redis, OpenAI chat completions with JSON schema, mammoth, pdf-parse |
| Rule types | `packages/rules/src/types.ts` | TypeScript types and default rule config |

The API modules are `PrismaModule`, `RateLimitModule`, `AuthModule`, `ProfilesModule` and `JdsModule`. The worker and its Express router are a separate file that `AppModule` does not import.

## Data model (`apps/api/prisma/schema.prisma`)

| Group | Models |
|---|---|
| Identity | `User`, `Session`, `PasswordResetToken`, `OAuthAccount`, `AdminAction` |
| Profile content | `Profile`, `BaseResume`, `RoleEntry`, `Education`, `Certification`, `FactBankEntry`, `ProfileSettings` |
| Inputs and runs | `JobDescription`, `Run`, `RunLog`, `ValidationFlag`, `KeywordSet`, `AlignedCompany`, `Document` |
| Configuration | `RuleSet`, `PromptVersion`, `UserSettings` |
| Billing | `Plan`, `Subscription`, `Payment`, `RunCredit`, `UsageCounter`, `BrandingConfig` |

Roles: `USER`, `PRO`, `AGENCY`, `ADMIN`. Run statuses: `QUEUED`, `READING_JD`, `ANALYZING`, `AWAITING_COMPANY_CONFIRM`, `REWRITING`, `VALIDATING`, `RENDERING`, `EXPORTING_PDF`, `COMPLETE`, `FAILED`, `CANCELLED`. `Run.baseResumeId` is required; `resolveBaseResumeId` defaults it to the profile's active base résumé.

## Pipeline (worker, stages 0–5)

| Stage | Name | What it does |
|---|---|---|
| 0 | Quota gate | Admins bypass. Others need a `Quota` row and fewer runs than `runsPerPeriod` |
| 1 | Ingest | Extracts text from paste, PDF, DOCX or URL; fails under 200 characters |
| 2 | Analyze | One LLM call returns company, confidence, role, seniority, industry, locations, skills, years. Confidence under 0.75 adds an R9 `warn` |
| 3 | Confirm | If the company was inferred or confidence is under 0.75, the run pauses as `AWAITING_COMPANY_CONFIRM` |
| 4 | Rewrite | Six LLM calls: headline, summary, competencies, roles (bullets only), keywords, targets. R10 `warn` on repeated bullet-opening words |
| 5 | Assemble | Merges sections; checks locked role headers and dates; picks the contact location (override, else first target location) |
| 6–7 | Validate, export | Not received. The pipeline currently ends at stage 5 and marks the run complete |

Every step and LLM call writes a `RunLog` row. Jobs retry 3 times with exponential backoff (5 s base). Concurrency is `WORKER_CONCURRENCY` (default 4).

## Frontend flow

Sign in, pick a profile, submit a job description (paste, file or URL), watch progress, confirm the company if asked, review and edit bullets next to the validation flags, then download DOCX and PDF. See [03-FRONTEND-STAGE4.md](./03-FRONTEND-STAGE4.md).

## Known gaps found while reading the code

These are observations from the provided files, not tested behaviour.

1. **Frontend and backend don't line up.** The web app calls `/api/...` and expects cookie-based refresh; the API serves `/v1/...` and returns a refresh token in the body. See [API.md](./API.md).
2. **Worker and schema don't line up.** The worker uses `Quota`, `Run.sourceText/analysis/rewrite/assembled/pendingCompany`, `RunLog.stage/level/message/meta` and statuses `QUOTA_CHECK`, `INGESTING`, `ASSEMBLING`, `COMPLETED`. None of these exist in the Part 1 schema, which has `COMPLETE`, `step`/`status` on `RunLog` and a different `ValidationFlag`.
3. **Company confirmation restarts the pipeline.** `confirm-company` re-enqueues the whole run; stage 2 re-analyzes and can pause again, and file or URL runs fail at ingest because only `pasteText` is passed on.
4. **Locked role data is never produced.** Stages 4 and 5 read `analysis.rawRoles`, but the stage 2 schema doesn't include it, so the "locked" header list is empty.
5. **`apps/web/src/lib/api.ts` uses the `Run` type without importing it.**
6. **URL fetching has no network restrictions.** Both `JdsService` and the worker fetch any `http`/`https` URL.
7. **Rule logic is duplicated** (three R18 regexes, two R2 stop-word lists) (see [RULES.md](./RULES.md)), and `tokenOverlapPct` is never called.

## Not received

Rule validator and retry loop, DOCX renderer, PDF/page QA, artifact storage, stages 6–7, the 2FA enrollment endpoint, `packages/shared`, project config for `apps/api`, and infrastructure files.
