# API

The backend defines the contract (`docs/DECISIONS.md`); the source is `docs/01-SPEC-v3.md` section 7. This file lists what the code in `apps/api` implements. Base path `/v1`, JSON, `Authorization: Bearer <accessToken>`. Errors: `{ "error": { "code": "...", "message": "..." } }`.

A request for another user's resource gets `404`, never `403`.

## Auth

| Method and path | Request | Response |
|---|---|---|
| `POST /auth/login` | `{ email, password }` | `200 { user, accessToken, tokenType, expiresIn: 900 }`. Sets the refresh cookie. With header `X-Client-Platform: ios\|android\|desktop` the body also has `refreshToken`. |
| `POST /auth/refresh` | cookie, or `{ refreshToken }` | `200 { accessToken, ... }`. The refresh token is rotated. A token that was already rotated revokes every session of that user (`401 REFRESH_REUSED`). |
| `POST /auth/logout` | cookie, or `{ refreshToken }` | `204`. Always succeeds. |
| `GET /auth/me` | | `200 { user }` |
| `POST /auth/bootstrap-admin` | header `X-Bootstrap-Token` | `{ ok, hadUsers }`. Succeeds while there are no users, or when the token matches `ADMIN_BOOTSTRAP_TOKEN`. |

Refresh cookie: `re_refresh`, HttpOnly, SameSite=Lax, `Path=/v1/auth`, 30 days, Secure in production. Access tokens last 15 minutes. Login limits: 10 attempts per 15 minutes per IP, 5 for admins.

## Profiles

| Method and path | Notes |
|---|---|
| `POST /profiles` | `{ name, headerFullName, headerCity, headerPhones[], headerEmail, linkedIn?, isDefault? }`. `402 PROFILE_LIMIT_REACHED`: USER 1, PRO 3, AGENCY and ADMIN unlimited. |
| `GET /profiles` | Array. |
| `GET /profiles/:id` | With `roles`, `education`, `certs`, `bases`. |
| `PATCH /profiles/:id` | Partial header update. |
| `PUT /profiles/:id/roles` | `{ roles: [{ companyName, title, baseTitle, startDate: "YYYY-MM", endDate?, location?, baseFlagship?, baseBullets[] }] }`. Replaces the roster; array order is the order on the resume. The pipeline will not run without it. |
| `PUT /profiles/:id/education` | `{ education: [{ institution, degree, field?, startYear, endYear? }] }` |
| `PUT /profiles/:id/certs` | `{ certs: [{ name, issuer?, year? }] }` |
| `POST /profiles/:id/bases` | multipart `file` (.docx, max 10 MB, name must match R18). Becomes the active base. |
| `PATCH /profiles/:id/bases/:baseId/activate` | |

## Fact bank

Entries are claims a résumé may repeat. In strict mode every number in a generated résumé must match a **verified** fact.

| Method and path | Notes |
|---|---|
| `GET /profiles/:id/facts` | `?kind=metric&verified=true`. Verified first. |
| `POST /profiles/:id/facts` | `{ kind, claimText, metricValue?, metricUnit?, context, employer?, verified?, sourceNote?, roleId? }`. `kind` is one of `metric, date, employer, title, education, skill, other`. A `metric` needs a numeric `metricValue` such as `40`, `1.2` or `2M` (`422 INVALID_METRIC`). `verified` defaults to false. |
| `POST /profiles/:id/facts/verify` | `{ factIds[] }` returns `{ verified, notFound[] }`. Ids that are not on this profile are reported, not touched. |
| `POST /profiles/:id/facts/import-from-base` | `{ baseResumeId }`. Proposes one **unverified** metric per number in the base résumé's text, with its sentence (bare years skipped). Safe to repeat; limit 200 per call. Returns `{ created, truncated }`. |
| `PATCH /facts/:id` | Partial. Changing the claim, number, unit or kind withdraws verification unless the same request sets `verified`. |
| `DELETE /facts/:id` | `204`. |

For the validator to match a number, set both `metricValue` and `metricUnit` (a fact with value `40` and unit `%` grounds "40%"; `2` and `M` ground "2M").

## Job descriptions

| Method and path | Notes |
|---|---|
| `POST /jds` | `{ profileId, sourceType: "paste", rawText }`, or `{ profileId, sourceType: "url", sourceUrl }`, or multipart `file` (.docx or .txt). `422 JD_UNUSABLE` under 200 characters. (`text` and `url` are accepted as older aliases.) Extraction is synchronous. |
| `GET /jds/:id` | |

## Runs

| Method and path | Notes |
|---|---|
| `POST /runs` | `{ profileId, jdId, baseResumeId?, settingsOverride?, contactLocationOverride? }` returns `202 { runId, status, eventsUrl }`. Applies the quota gate: `402 RUN_LIMIT_REACHED` (PRO, 10 a month) or `402 NO_CREDITS` (USER). Admins with `adminUnlimited` and AGENCY are unlimited. |
| `GET /runs` | `?status&limit&cursor` returns `{ items, nextCursor }`. |
| `GET /runs/:id` | Status, stage, progress, `pendingCompany` while awaiting confirmation. |
| `GET /runs/:id/events` | Server sent events: `{ status, stage, progress, errorCode }`. Ends at a terminal state. |
| `POST /runs/:id/confirm-company` | `{ companyName }`. Only while `AWAITING_COMPANY_CONFIRM` (`409` otherwise). Continues at stage 4. |
| `POST /runs/:id/cancel` | |
| `POST /runs/:id/retry` | Failed runs only. Does not spend another run. |
| `GET /runs/:id/output` | `{ outputJson, atsScore, metrics, keywordCount, targetCompanies, validation }`. `409` until there is output. |
| `GET /runs/:id/validation` | `{ passed, flags, counts }`. Each flag: `ruleId`, `code`, `severity`, `blocking`, `field`, `message`. |
| `GET /runs/:id/docx`, `/pdf` | `{ url, expiresAt }` (signed, 15 minutes, `Cache-Control: no-store`). `?redirect=1` answers `302`. |
| `DELETE /runs/:id` | `204`. Finished runs only. |

Statuses: `QUEUED, READING_JD, ANALYZING, AWAITING_COMPANY_CONFIRM, REWRITING, VALIDATING, RENDERING, EXPORTING_PDF, COMPLETE, FAILED, CANCELLED`. Error codes on a failed run: `JD_UNUSABLE`, `PROFILE_ROSTER_MISSING`, `COMPANY_MISSING`, `VALIDATION_FAILED`, `PIPELINE_ERROR`.

## Settings and branding

| Method and path | Notes |
|---|---|
| `GET /settings`, `PUT /settings` | The ten toggles; `PUT` takes any subset and rejects unknown keys or non booleans with `400`. |
| `GET /me/branding`, `PUT /me/branding` | `{ displayName, contactEmail?, contactPhone?, footerText?, primaryColor? }`. Writing needs AGENCY (admins pass), else `403`. |

## Admin

Admin routes answer `404` to everyone else, and the admin flag is re-read from the database on every request (a JWT claim is not trusted).

| Method and path | Notes |
|---|---|
| `GET /admin/users` | `{ items, nextCursor }` with plan, runs this month, whether 2FA is on. |
| `GET /admin/runs`, `GET /admin/runs/:id` | All runs; detail adds logs, flags and the pinned versions. |
| `POST /admin/runs/:id/reproduce` | `202`. Clones the pinned rule set, prompts, base resume and settings snapshot into a new run owned by the admin. Audited. |
| `GET /admin/audit` | |
| `POST /admin/2fa/enroll` | Not `GET`. Authenticate with an admin JWT, or with the `X-Bootstrap-Token` header plus `{ adminId }` in the body. Returns the secret, QR code and recovery codes once. Pending until verified. `409 ALREADY_ENROLLED` once confirmed. |
| `POST /admin/2fa/verify` | `{ code }`. Confirms enrollment. |

The TOTP seed is stored AES-256-GCM encrypted (`TOTP_ENCRYPTION_KEY`), recovery codes are stored as SHA-256 hashes, and every step writes an `AdminAction` row. **Sign in does not ask for a code yet** (`POST /auth/login/totp` is not built).

## In the spec but not built

Public signup, password reset, Google OAuth, `/auth/login/totp`; `/users/*`; `DELETE /profiles/:id` and `/profiles/:id/settings`; `GET /jds`; `regenerate-section`, `PATCH /runs/:id/output` and `approve`; batches; billing and Stripe webhooks; branding logo upload; admin user edits, credits and refunds; health endpoints and metrics; API keys; `Idempotency-Key`.
