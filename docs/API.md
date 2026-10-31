# API

Derived from the code in `apps/api` (Parts 1–2) and from the calls the frontend makes in `apps/web`. It describes what the code does today, including where the two sides disagree. It is not an OpenAPI file.

## 1. Implemented: NestJS API (`apps/api`, Part 1)

Global prefix `/v1`. Errors have the shape `{ "error": { "code": "...", "message": "..." } }`. Protected routes need `Authorization: Bearer <accessToken>`.

| Method and path | Auth | Request | Success response | Errors |
|---|---|---|---|---|
| `POST /v1/auth/bootstrap-admin` | `X-Bootstrap-Token` header | none | `{ ok: true, hadUsers }` | `401 BOOTSTRAP_TOKEN_REQUIRED`; `403 FORBIDDEN` (users exist and token differs from `ADMIN_BOOTSTRAP_TOKEN`); `500 ADMIN_NOT_CONFIGURED` |
| `POST /v1/auth/login` | none | `{ email, password }` | `{ accessToken, refreshToken, tokenType: "Bearer", expiresIn: 900 }` | `401 INVALID_CREDENTIALS`; `429 RATE_LIMITED` |
| `GET /v1/auth/me` | Bearer | none | id, email, role, isAdmin, adminUnlimited, emailVerified, mustChangePassword, firstName, lastName, themePref, createdAt | `401 UNAUTHORIZED` |
| `POST /v1/profiles` | Bearer | `name`, `headerFullName`, `headerCity`, `headerPhones[]` (non-empty), `headerEmail`, optional `linkedIn`, `isDefault` | the profile | `402 PROFILE_LIMIT_REACHED` |
| `GET /v1/profiles` | Bearer | none | the caller's profiles, each with `settings` | |
| `PATCH /v1/profiles/:id` | Bearer | any subset of the create fields | the profile | `404 PROFILE_NOT_FOUND` |
| `POST /v1/profiles/:id/bases` | Bearer | multipart field `file` (max 10 MB) | the new `BaseResume` (becomes the active one) | `400 FILE_REQUIRED`; `422 INVALID_FILENAME` (R18); `422 EMPTY_DOCUMENT`; `404 PROFILE_NOT_FOUND` |
| `POST /v1/jds` | Bearer | `profileId`, plus `sourceType` (`paste`/`url`/`file`) with `text`, `url` or multipart `file` (`.docx` or `.txt`, max 10 MB) | `{ id, status, sourceType, extractedChars, createdAt }` | `422 JD_UNUSABLE` (under 200 characters); `422 URL_FETCH_FAILED`; `400 INVALID_URL`; `422 UNSUPPORTED_FILE`; `404 PROFILE_NOT_FOUND` |
| `GET /v1/jds/:id` | Bearer | none | the stored job description | `404 JD_NOT_FOUND` |

Behaviours worth knowing:
- Login rate limit: 5 attempts per 15 minutes per IP when the email belongs to an admin, otherwise 10. If Redis is unavailable the limiter lets requests through.
- Profile limits by role: `USER` 1, `PRO` 3, `AGENCY` and `ADMIN` unlimited.
- `bootstrap-admin` succeeds for any non-empty token while the database has no users.
- The access token lives 15 minutes; a refresh token is stored (hashed) in `Session` and returned in the response body. There is no refresh or logout route.

## 2. Written but not mounted: run endpoints (`run.worker.ts`, Part 2)

`runsRouter` is an Express router. `AppModule` does not import or mount it, and it reads `req.user` as `{ id, isAdmin }`, so it needs a mount point and an auth middleware before it can be used.

| Method and path (relative to the mount) | Request | Response |
|---|---|---|
| `POST /` | `{ input: { kind: "paste" \| "file" \| "url", pasteText?, fileBufferB64?, filename?, mimeType?, url? }, overrides?: { contactLocationOverride? } }` | `202 { runId, jobId, status }` |
| `GET /:id` | none | status, progress, pendingCompany, analysis, rewrite, assembled, validationFlags, logs (first 500), timestamps |
| `POST /:id/confirm-company` | `{ company }` (at least 2 characters) | `202 { runId, jobId, status: "QUEUED" }`; `409 RUN_NOT_AWAITING_CONFIRM` if the run isn't paused |

`GET` and `confirm-company` return `403` for runs owned by someone else unless the caller is an admin.

## 3. What the frontend calls

All paths are under `/api`, and the client expects JSON. Status compares each call with sections 1 and 2.

| Frontend call | Used by | Status |
|---|---|---|
| `POST /api/auth/login` → `{ accessToken, user }` | login | Backend path is `/v1/auth/login`; response has no `user`, and also returns `refreshToken` |
| `POST /api/auth/refresh` → `{ accessToken, user }` (cookie) | session restore, 401 retry | Not implemented |
| `POST /api/auth/logout` | sign out | Not implemented |
| `GET/POST /api/profiles` (`{ name }`) | profiles list | Backend create requires header fields, not just `name` |
| `GET/PATCH /api/profiles/:id` | profile detail | Path differs (`/v1`); `GET /:id` doesn't exist |
| `POST /api/profiles/:id/resume` (multipart) | profile detail | Backend path is `/v1/profiles/:id/bases` |
| `POST /api/runs` (JSON or multipart `jdFile`) | new run | Different request shape from the router in section 2, which isn't mounted |
| `GET /api/runs`, `?limit=`, `?q=`, `?status=` | dashboard, history | Not implemented (router has no list) |
| `GET /api/runs/:id` | progress, confirm | Section 2 has it; the frontend expects `status` values `queued`, `running`, `awaiting_confirm`, `review`, `completed`, `failed` |
| `GET /api/runs/:id/stream` (SSE) | progress | Not implemented; client falls back to polling every 2 s |
| `POST /api/runs/:id/confirm-company` | confirm | Section 2 |
| `GET /api/runs/:id/review` | review | Not implemented |
| `POST /api/runs/:id/sections/:sectionId/regenerate` | review | Not implemented |
| `PATCH /api/runs/:id/bullets/:bulletId` `{ text }` | review | Not implemented |
| `POST /api/runs/:id/duplicate` | history | Not implemented |
| `GET/PATCH /api/settings` | settings | Not implemented |
| `GET/PATCH /api/agency/branding`, `POST /api/agency/branding/logo` | agency branding | Not implemented |
| `GET /api/admin/users`, `/runs`, `/runs/:id`, `/audit?limit=200` | admin screens | Not implemented |
| `POST /api/admin/runs/:id/reproduce` with `X-Bootstrap-Token` | reproduce | Not implemented |
| `POST /admin/2fa/enroll` | (no screen yet) | Named in the sign-off notes; Part 3 section E was meant to contain it but is missing |

The frontend also describes users with roles `owner | admin | member`, while the database enum is `USER | PRO | AGENCY | ADMIN`.
