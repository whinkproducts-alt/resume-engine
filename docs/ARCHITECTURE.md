# Architecture

What the code does today. Decisions behind it are in [DECISIONS.md](./DECISIONS.md); the product spec is [01-SPEC-v3.md](./01-SPEC-v3.md).

## Workspaces

| Path | What it is |
|---|---|
| `apps/web` | Next.js 14 (App Router), React 18, Tailwind, TanStack Query. Talks to the API only through `/v1`, which Next proxies to `API_ORIGIN`. |
| `apps/api` | NestJS 10 on Prisma and PostgreSQL. Also holds the pipeline (`src/pipeline`) and the worker entrypoint (`src/workers/worker-main.ts`). |
| `packages/rules` | The validator: R1 to R20, the fact bank check, the retry loop. Pure TypeScript, no I/O. |
| `packages/renderer` | `ResumeDoc` to DOCX with the `docx` library, to the section 6 layout. |
| `packages/qa` | DOCX to PDF with LibreOffice headless, page count, overflow flag. |
| `packages/storage` | S3 / Cloudflare R2 uploads and signed URLs. |

The packages build to CommonJS (`tsconfig.base.json`) because the Nest app is CommonJS.

## Processes

```
browser ──/v1──> web (Next) ──rewrite──> api (Nest) ──> PostgreSQL
                                           │  enqueue
                                           ▼
                                        Redis ◀── worker (BullMQ) ──> LLM, S3/R2, LibreOffice
```

The API and the worker are separate processes from the same build (`pnpm --filter @resume-engine/api start` and `... worker`). The API only enqueues; it never calls the model.

## The pipeline (`apps/api/src/pipeline`)

`runPipeline` in `run-pipeline.ts` is plain TypeScript over a repository interface (`types.ts`), so it is tested with an in-memory repo, a scripted LLM and a fake store. `prisma-repo.ts` is the Prisma implementation.

| Stage | Where | What happens |
|---|---|---|
| 0 Quota gate | `RunsService.create`, `QuotaService` | At run creation, in one transaction with the run row. USER spends a credit, PRO counts against 10 a month. |
| 1 Ingest | `POST /jds`, then a guard in the worker | Text is extracted when the JD is stored. The worker checks it is at least 200 characters and that the profile has a roster. |
| 2 Analyze | `run-pipeline.ts` | One LLM call with a strict JSON schema. The result is stored on `JobDescription`. |
| 3 Confirm | | If the company was inferred or confidence is under 0.75, the run stops at `AWAITING_COMPANY_CONFIRM`. `confirm-company` resumes at stage 4 and does not analyze again. |
| 4 Rewrite | `sections.ts`, `prompts.ts` | One call per section: headline, summary, competencies, each role, keywords, targets. |
| 5 Assemble | `assemble()` | Header, roster (company, dates, order), education and certifications are copied from the database, never from the model. The contact location override is applied to the city. |
| 6 Validate | `packages/rules` | Blocking failures regenerate only the failing sections, with the failure text in the prompt. Up to 2 retries. |
| 7 Render | `packages/renderer` | AGENCY runs get their accent colour and footer text. |
| 8 Export | `packages/qa`, `packages/storage` | PDF, page count, upload of DOCX, PDF and a validation report. |

Everything the worker writes goes to existing models: `JobDescription` (analysis), `Run` (status, stage, progress, `outputJson`, `validation`, keys, counts), `RunLog` (every step and LLM call with model and tokens), `ValidationFlag`, `KeywordSet`, `AlignedCompany`, `Document`. No schema change was needed for the pipeline.

Each run pins `RuleSet` (version `v3.1`), the prompt version, the `BaseResume` and a settings snapshot (`Run.settingsSnap`), which is what `POST /admin/runs/:id/reproduce` replays.

## Data model

`apps/api/prisma/schema.prisma` is the source of truth. Migrations:

| Migration | Purpose |
|---|---|
| `20261031000000_init` | The schema from `01-SPEC-v3.md` section 4 (28 tables). |
| `20261031010000_admin_2fa` | `User.totpSecretEnc`, `totpEnabledAt`, `totpRecoveryHashes`, for admin 2FA. |

## Frontend

See [03-FRONTEND-STAGE4.md](./03-FRONTEND-STAGE4.md). The access token lives in memory; the HttpOnly refresh cookie restores the session, and one shared refresh handles concurrent 401s.

## Known gaps

- **Review is read only.** There is no `regenerate-section`, `PATCH /runs/:id/output` or `approve` on the backend, so the UI does not offer inline editing.
- **Fact bank import is a proposal, not a parser.** It lists the numbers found in the base résumé's text as unverified facts; a person verifies them.
- **No base resume parser.** Uploading a base résumé stores its text. The roster and education are entered by hand on the profile page.
- **R9 never runs for real.** Nothing produces the LLM judgement the rule consumes.
- **2FA is not enforced at sign in.** Enrollment and confirmation work; the login challenge does not exist.
- **Only OpenAI is wired.** `LLM_PROVIDER=anthropic` throws at start.
- **No logo upload** for agency branding.
- **`FAILED` also means "needs review".** A run that still breaks blocking rules after retries ends `FAILED` with `errorCode=VALIDATION_FAILED`, because `RunStatus` has no review state. Its draft and flags remain readable.
- **A cancel while the worker is mid LLM call** is only noticed at the next check; later writes never overwrite `CANCELLED`.
- **URL job descriptions** are fetched from any `http`/`https` address with no allow list, which would let a user make the server request internal addresses. Worth restricting before public launch.
- **CSRF** on the cookie endpoints rests on SameSite=Lax and POST-only routes; the double submit token from the spec is not built.
