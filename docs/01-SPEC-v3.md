# Resume Engine — Technical Specification v3

Product: Resume Engine (Whink Apps, a Whink Group company)
Owner / Admin: Victor Igboekwe, Whinkproducts@gmail.com
Model: Public white-label SaaS with a dedicated admin account
Supersedes: All prior specs, including v1 and v2
Date: 2026-10-30

This is the master technical specification. Where it conflicts with 02-RESUME_ENGINE_SPEC.md, 02 wins for rules (R1–R20) and DOCX layout; this document wins for architecture, data models, API surface, deployment, and platform guidance.

---

## 1. Product overview

Resume Engine is a public SaaS that takes a job description (JD) as input and produces a tailored, ATS-optimized Word resume (.docx) as output. It automates a manual chat-driven workflow that has already produced 50+ resumes using fixed rules.

The promise: Paste JD, press one button, get a correctly named .docx in under 90 seconds with zero rule violations.

Primary audience: Job seekers applying to many roles who need tailored resumes fast.

Secondary audience: Career coaches and recruitment agencies managing multiple candidates (Agency tier).

Admin: One admin account (Whinkproducts@gmail.com) with unlimited runs, admin panel access, and no billing. Provisioned via environment variables only (see §3.3).

---

## 2. Roles, permissions, quotas

### 2.1 Roles

enum UserRole { USER PRO AGENCY ADMIN }

| Role | What they can do | How they get it |
|---|---|---|
| USER | Buy Starter credit ($9/run), run one resume per credit | Public signup |
| PRO | 10 runs/month, 3 profiles, all accuracy toggles | Subscription ($49/mo or $39/mo annual) |
| AGENCY | Unlimited runs, unlimited profiles, white-label DOCX, API keys | Subscription ($199/mo or $159/mo annual) |
| ADMIN | Everything, unlimited, no billing, admin panel | Provisioned via env vars |

### 2.2 Permission matrix

| Capability | USER | PRO | AGENCY | ADMIN |
|---|---|---|---|---|
| Create profile | 1 | 3 | Unlimited | Unlimited |
| Runs/month | per-credit | 10 | Unlimited | Unlimited (bypass) |
| Strict Facts / Consulting Framing | – | ✓ | ✓ | ✓ |
| White-label DOCX | – | – | ✓ | ✓ |
| API keys | – | – | ✓ | ✓ |
| Batch mode | – | ✓ | ✓ | ✓ |
| Admin panel | – | – | – | ✓ |

### 2.3 Quota check (server-side, never trust client)

async function assertCanRun(user: User) {
  if (user.isAdmin && user.adminUnlimited) return;         // bypass
  if (user.role === 'AGENCY') return;
  if (user.role === 'PRO') {
    const used = await usageCount(user.id, currentMonth());
    if (used >= 10) throw new AppError('RUN_LIMIT_REACHED', 402);
    return;
  }
  const credits = await remainingCredits(user.id);
  if (credits < 1) throw new AppError('NO_CREDITS', 402);
}

async function assertCanCreateProfile(user: User) {
  if (user.isAdmin || user.role === 'AGENCY') return;
  const limit = user.role === 'PRO' ? 3 : 1;
  const count = await profileCount(user.id);
  if (count >= limit) throw new AppError('PROFILE_LIMIT_REACHED', 402);
}

function assertAgencyOnly(user: User) {
  if (user.isAdmin) return;
  if (user.role !== 'AGENCY') throw new AppError('FORBIDDEN', 403);
}

---

## 3. Authentication & admin provisioning

### 3.1 Standard auth

- Argon2id hashing (m=64MB, t=3, p=4).
- Password: min 12 chars, upper + lower + digit + symbol.
- Access: JWT (HS256 or RS256), 15-min TTL, claims { sub, role, isAdmin, iat, exp, jti }.
- Refresh: 256-bit random, hashed SHA-256 in Session, 30-day TTL, rotated on every refresh, session-family revocation on reuse.
- Web: access in memory, refresh in HttpOnly; Secure; SameSite=Lax cookie scoped to /v1/auth. CSRF double-submit on cookie-based state changes.
- Password reset: 32-byte token, hashed, 15-minute expiry, single-use, invalidates all sessions on use.
- Brute force: standard 10 attempts / 15 min / IP; admin 5 attempts / 15 min / IP.
- Optional: Google OAuth (standard code flow).

### 3.2 Admin 2FA (recommended for v1.1)

TOTP via otpauth. Enroll: POST /admin/2fa/enroll returns QR + secret. Verify on login: POST /auth/login/totp { challengeToken, code }. Recovery codes generated once.

### 3.3 Admin provisioning — no hardcoded passwords

Environment variables, set only in the hosting provider's secret store:

ADMIN_EMAIL=Whinkproducts@gmail.com
ADMIN_SEED_PASSWORD=<set a strong unique password here, never commit>
ADMIN_BOOTSTRAP_TOKEN=<random 32-byte base64>

Startup hook (apps/api/src/auth/bootstrap-admin.ts), runs at boot before traffic:

export async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) return;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.isAdmin) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { isAdmin: true, adminUnlimited: true, role: 'ADMIN' },
      });
    }
    return;
  }

  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!password) throw new Error('ADMIN_SEED_PASSWORD required on first boot');

  await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash(password),
      firstName: 'Victor',
      lastName: 'Igboekwe',
      role: 'ADMIN',
      isAdmin: true,
      adminUnlimited: true,
      emailVerified: true,
      mustChangePassword: process.env.NODE_ENV === 'production',
    },
  });
}

Bootstrap endpoint (idempotent, for fresh environments):

POST /auth/bootstrap-admin
Body: { email, password, bootstrapToken }
Rules:
  - Only succeeds if users.count == 0 OR X-Bootstrap-Token matches ADMIN_BOOTSTRAP_TOKEN
  - Returns 409 if admin already exists
  - Rate limited: 3 attempts / hour / IP
  - Writes AdminAction { action: "admin.bootstrap" }

Rotation: pnpm admin:rotate-password re-hashes from env and sets mustChangePassword: false.

Revocation: set adminUnlimited = false. For every admin-guarded request, re-fetch user row from DB (do not trust JWT claims for admin-only routes).

Admin login flow: same POST /auth/login as everyone else (avoids revealing admin existence). Tight rate limit. All admin logins write AdminAction { action: 'admin.login' }.

---

## 4. Data models

All tables: id UUID PK, createdAt, updatedAt. Money in integer cents. Timestamps UTC.

enum UserRole { USER PRO AGENCY ADMIN }

model User {
  id                 String   @id @default(uuid())
  email              String   @unique
  passwordHash       String
  role               UserRole @default(USER)
  isAdmin            Boolean  @default(false)
  adminUnlimited     Boolean  @default(false)
  emailVerified      Boolean  @default(false)
  mustChangePassword Boolean  @default(false)
  firstName          String?
  lastName           String?
  themePref          String   @default("SYSTEM")
  stripeCustomerId   String?  @unique
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  profiles           Profile[]
  subscription       Subscription?
  payments           Payment[]
  runCredits         RunCredit[]
  usage              UsageCounter[]
  sessions           Session[]
  resetTokens        PasswordResetToken[]
  oauthAccounts      OAuthAccount[]
  runs               Run[]
  branding           BrandingConfig?
  adminActionsMade   AdminAction[] @relation("adminMade")
  adminActionsOnSelf AdminAction[] @relation("adminOn")
}

model Session {
  id          String    @id @default(uuid())
  userId      String
  refreshHash String
  userAgent   String?
  ip          String?
  expiresAt   DateTime
  revokedAt   DateTime?
  user        User      @relation(fields: [userId], references: [id])
  @@index([userId])
}

model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  user      User      @relation(fields: [userId], references: [id])
}

model OAuthAccount {
  id         String @id @default(uuid())
  userId     String
  provider   String
  providerId String
  user       User   @relation(fields: [userId], references: [id])
  @@unique([provider, providerId])
}

model AdminAction {
  id           String   @id @default(uuid())
  adminId      String
  targetUserId String?
  action       String
  meta         Json?
  ip           String?
  userAgent    String?
  createdAt    DateTime @default(now())
  admin        User     @relation("adminMade", fields: [adminId], references: [id])
  targetUser   User?    @relation("adminOn", fields: [targetUserId], references: [id])
  @@index([adminId, createdAt])
  @@index([targetUserId, createdAt])
}

model Profile {
  id             String   @id @default(uuid())
  userId         String
  name           String
  headerFullName String
  headerCity     String
  headerPhones   String[]
  headerEmail    String
  linkedIn       String?
  isDefault      Boolean  @default(false)
  activeBaseId   String?
  user           User     @relation(fields: [userId], references: [id])
  bases          BaseResume[]
  roles          RoleEntry[]
  education      Education[]
  certs          Certification[]
  facts          FactBankEntry[]
  settings       ProfileSettings?
  runs           Run[]
  @@index([userId])
}

model BaseResume {
  id         String   @id @default(uuid())
  profileId  String
  version    Int
  fileName   String
  parsedJson Json
  isActive   Boolean  @default(false)
  uploadedAt DateTime @default(now())
  profile    Profile  @relation(fields: [profileId], references: [id])
  @@unique([profileId, version])
  @@index([profileId, isActive])
}

model RoleEntry {
  id           String    @id @default(uuid())
  profileId    String
  companyName  String
  title        String
  baseTitle    String
  startDate    DateTime
  endDate      DateTime?
  location     String?
  orderIndex   Int
  baseBullets  Json
  baseFlagship String?
  profile      Profile   @relation(fields: [profileId], references: [id])
  @@index([profileId, orderIndex])
}

model Education {
  id          String  @id @default(uuid())
  profileId   String
  institution String
  degree      String
  field       String?
  startYear   Int
  endYear     Int?
  profile     Profile @relation(fields: [profileId], references: [id])
}

model Certification {
  id        String  @id @default(uuid())
  profileId String
  name      String
  issuer    String?
  year      Int?
  profile   Profile @relation(fields: [profileId], references: [id])
}

model FactBankEntry {
  id          String   @id @default(uuid())
  profileId   String
  roleId      String?
  kind        String
  claimText   String
  metricValue String?
  metricUnit  String?
  context     String
  employer    String?
  verified    Boolean  @default(false)
  sourceNote  String?
  profile     Profile  @relation(fields: [profileId], references: [id])
  @@index([profileId, verified])
}

model JobDescription {
  id                String   @id @default(uuid())
  userId            String
  profileId         String
  sourceType        String
  sourceUrl         String?
  sourceFileName    String?
  rawText           String
  extractedChars    Int
  status            String
  company           String?
  roleTitle         String?
  location          String?
  salaryText        String?
  seniority         String?
  industryTags      String[]
  responsibilities  Json?
  requirements      Json?
  keywords          String[]
  companyInferred   Boolean  @default(false)
  companyConfidence Float?
  createdAt         DateTime @default(now())
  runs              Run[]
  @@index([userId, createdAt])
}

enum RunStatus {
  QUEUED
  READING_JD
  ANALYZING
  AWAITING_COMPANY_CONFIRM
  REWRITING
  VALIDATING
  RENDERING
  EXPORTING_PDF
  COMPLETE
  FAILED
  CANCELLED
}

model Run {
  id                      String    @id @default(uuid())
  userId                  String
  profileId               String
  baseResumeId            String
  ruleSetId               String
  jdId                    String
  planTier                String
  status                  RunStatus @default(QUEUED)
  stage                   String?
  progress                Float     @default(0)
  companyConfirmed        Boolean   @default(false)
  contactLocationOverride String?
  settingsSnap            Json
  atsScore                Int?
  metrics                 Json?
  keywordCount            Int?
  pageCount               Int?
  estimatedCostUsd        Float?
  actualTokens            Int?
  validation              Json?
  outputJson              Json?
  docxKey                 String?
  pdfKey                  String?
  errorCode               String?
  startedAt               DateTime?
  finishedAt              DateTime?
  createdAt               DateTime  @default(now())
  user                    User      @relation(fields: [userId], references: [id])
  profile                 Profile   @relation(fields: [profileId], references: [id])
  jd                      JobDescription @relation(fields: [jdId], references: [id])
  ruleSet                 RuleSet   @relation(fields: [ruleSetId], references: [id])
  steps                   RunLog[]
  flags                   ValidationFlag[]
  keywordSet              KeywordSet?
  targets                 AlignedCompany[]
  @@index([userId, createdAt])
}

model RuleSet {
  id            String   @id @default(uuid())
  version       String   @unique
  rulesJson     Json
  styleConfig   Json
  promptVersion String
  createdAt     DateTime @default(now())
  runs          Run[]
}

model PromptVersion {
  id        String   @id @default(uuid())
  section   String
  version   String
  template  String
  modelId   String
  createdAt DateTime @default(now())
  @@unique([section, version])
}

model KeywordSet {
  id            String   @id @default(uuid())
  runId         String   @unique
  jdTerms       String[]
  relatedTerms  String[]
  totalDistinct Int
  run           Run      @relation(fields: [runId], references: [id])
}

model AlignedCompany {
  id          String @id @default(uuid())
  runId       String
  rank        Int
  name        String
  department  String?
  exampleRole String?
  isTarget    Boolean @default(false)
  run         Run     @relation(fields: [runId], references: [id])
  @@unique([runId, rank])
}

model RunLog {
  id         String   @id @default(uuid())
  runId      String
  step       String
  status     String
  attempt    Int      @default(1)
  durationMs Int?
  tokensIn   Int?
  tokensOut  Int?
  modelId    String?
  errorCode  String?
  errorMsg   String?
  createdAt  DateTime @default(now())
  run        Run      @relation(fields: [runId], references: [id])
  @@index([runId])
}

model ValidationFlag {
  id       String @id @default(uuid())
  runId    String
  code     String
  severity String
  field    String?
  message  String
  run      Run    @relation(fields: [runId], references: [id])
  @@index([runId])
}

model Document {
  id        String   @id @default(uuid())
  runId     String   @unique
  docxKey   String
  pdfKey    String?
  sizeBytes Int?
  createdAt DateTime @default(now())
}

model UserSettings {
  id                  String  @id @default(uuid())
  userId              String  @unique
  strictFactsMode     Boolean @default(true)
  flagAndInclude      Boolean @default(false)
  lockCompanyNames    Boolean @default(true)
  lockEmploymentDates Boolean @default(true)
  blockOnUnusableJD   Boolean @default(true)
  inferCompanyName    Boolean @default(true)
  banHyphensInProse   Boolean @default(true)
  consultingFraming   Boolean @default(false)
  whinkGroupFraming   Boolean @default(false)
  heritageLineDefault Boolean @default(false)
  user                User    @relation(fields: [userId], references: [id])
}

model ProfileSettings {
  id        String  @id @default(uuid())
  profileId String  @unique
  overrides Json
  profile   Profile @relation(fields: [profileId], references: [id])
}

model Plan {
  id                   String  @id @default(uuid())
  code                 String  @unique
  name                 String
  priceCentsMonthly    Int
  priceCentsAnnual     Int?
  runsPerMonth         Int?
  maxProfiles          Int?
  features             Json
  stripePriceMonthlyId String?
  stripePriceAnnualId  String?
  stripePriceOneRunId  String?
}

model Subscription {
  id                   String   @id @default(uuid())
  userId               String   @unique
  planCode             String
  status               String
  stripeSubscriptionId String?  @unique
  stripePriceId        String?
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean  @default(false)
  user                 User     @relation(fields: [userId], references: [id])
}

model Payment {
  id                    String   @id @default(uuid())
  userId                String
  stripePaymentIntentId String?  @unique
  kind                  String
  amountCents           Int
  currency              String   @default("usd")
  status                String
  createdAt             DateTime @default(now())
  user                  User     @relation(fields: [userId], references: [id])
  @@index([userId, createdAt])
}

model RunCredit {
  id        String   @id @default(uuid())
  userId    String
  source    String
  remaining Int
  expiresAt DateTime?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  @@index([userId])
}

model UsageCounter {
  id       String @id @default(uuid())
  userId   String
  period   String
  runsUsed Int    @default(0)
  user     User   @relation(fields: [userId], references: [id])
  @@unique([userId, period])
}

model BrandingConfig {
  id           String   @id @default(uuid())
  userId       String   @unique
  displayName  String
  logoUrl      String?
  contactEmail String?
  contactPhone String?
  footerText   String?
  primaryColor String   @default("#1F3864")
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id])
}

---

## 5. Pipeline — stages 0 through 8

STAGE 0 — QUOTA GATE
  assertCanRun(user). Admin bypasses. PRO/Agency/USER checked.
  → status QUEUED

STAGE 1 — INGEST
  sourceType: paste | file | url
  - file: extract via pdf-parse / mammoth
  - url: fetch + extract via readability
  - if extractedChars < 200 → FAILED (JD_UNUSABLE)
  → status READING_JD

STAGE 2 — ANALYZE (LLM, small model, strict JSON schema)
  Output: { company, roleTitle, location, seniority, industryTags[],
            topKeywords[25], responsibilities[], requirements[],
            companyInferred, companyConfidence }
  If companyInferred OR confidence < 0.75 → AWAITING_COMPANY_CONFIRM
  → status ANALYZING

STAGE 3 — CONFIRM (interactive, blocks file naming)
  POST /runs/:id/confirm-company { companyName }
  → status REWRITING

STAGE 4 — REWRITE (one LLM call per section, retryable per section)
  a. headline       (R2, R3)                 progress 0.10
  b. summary        (R4, R20 lint)           progress 0.30
  c. competencies   (R5)                     progress 0.45
  d. roles × N      (R6,R8,R9,R10,R11,R12,R19)
     progress 0.55 → 0.85
  e. keywords       (R14, R15)               progress 0.90
  f. targets        (R16 — 7 companies)      progress 0.95

STAGE 5 — ASSEMBLE
  Merge sections. Copy header byte-for-byte (R1),
  education/certs/dates (R7, R13). Apply contactLocationOverride.
  → status VALIDATING

STAGE 6 — VALIDATE
  Run R1–R20 (deterministic TypeScript). Retry failing section on
  blocking failure, max 2 retries. Fact bank check on every numeric
  token. Claims check on new assertions. Style lint.
  → status VALIDATING

STAGE 7 — RENDER (docx npm from outputJson, template per §6)
  If run owner is AGENCY: inject BrandingConfig.
  → status RENDERING

STAGE 8 — EXPORT & QA
  Upload DOCX to object storage; sign URL (15-min TTL).
  LibreOffice headless: DOCX → PDF. Count pages; if > 3 → PAGE_OVERFLOW warn.
  Upload PDF.
  → status EXPORTING_PDF → COMPLETE

Target performance: 45–90 s per resume. Batch of 10 with 3 workers: 12–15 min.

Reproducibility: Every Run pins ruleSetId (→ RuleSet.version + PromptVersion per section), RunLog.modelId per call, BaseResume.version, settingsSnap. Admin-only POST /admin/runs/:id/reproduce re-runs the pipeline with these pins.

---

## 6. DOCX render template

Deterministic, from outputJson, using the docx npm library. Full specification is in 02-RESUME_ENGINE_SPEC.md §6 — that section is the visual contract.

Key invariants repeated here:

- US Letter, margins top 720 / right 1008 / bottom 720 / left 1008 DXA.
- Calibri throughout. LibreOffice PDF conversion requires fonts-crosextra-calibri installed in the renderer container.
- Name: 20pt bold #1F3864, centered.
- Contact: 10pt, centered, " | " separated.
- Section heading: 11pt bold #1F3864, bottom border #2E74B5.
- Body: 10pt.
- Flagship bullet: ▸ via numbering config (never typed), bold, indent 360/360.
- Standard bullet: •, indent 360/360.
- Keywords: 9pt paragraph.
- Never use a table for the rule line (use paragraph borders).
- Never hardcode an output path; always use the configured storage root.
- Page target ≤ 3 pages (enforced by PDF page count in Stage 8).
- Agency white-label: BrandingConfig.primaryColor overrides #1F3864; logo top-right; footerText replaces Whink footer.

---

## 7. API surface

Base: /v1. JSON. Auth: Authorization: Bearer <access>. Errors: { error: { code, message, details } }. Pagination: ?cursor=&limit=. Idempotency-Key supported on POST /runs and POST /billing/checkout-session.

### 7.1 Auth

| Method | Route | Auth | Request | Response |
|---|---|---|---|---|
| POST | /auth/register | public | { firstName, lastName, email, password } | 201 { user, accessToken } |
| POST | /auth/login | public | { email, password } | 200 { user, accessToken } or { requiresTOTP, challengeToken } |
| POST | /auth/login/totp | public | { challengeToken, code } | 200 { user, accessToken } |
| POST | /auth/logout | bearer | — | 204 |
| POST | /auth/refresh | cookie/body | { refreshToken? } | 200 { accessToken } |
| POST | /auth/forgot-password | public | { email } | 202 { ok: true } |
| POST | /auth/reset-password | public | { token, newPassword } | 200 { ok: true } |
| GET | /auth/oauth/google | public | — | 302 to Google |
| GET | /auth/oauth/google/callback | public | ?code&state | 302 to app |
| GET | /auth/me | bearer | — | 200 { user } |
| POST | /auth/bootstrap-admin | bootstrap token | { email, password, bootstrapToken } | 201 { user } |

### 7.2 Users

| Method | Route | Request |
|---|---|---|
| GET | /users/me | — |
| PATCH | /users/me | { firstName?, lastName?, themePref? } |
| POST | /users/me/change-password | { currentPassword, newPassword } |
| DELETE | /users/me | — (soft-delete, 30-day grace) |

### 7.3 Profiles

| Method | Route | Request |
|---|---|---|
| GET | /profiles | — |
| POST | /profiles | { name, headerFullName, headerCity, headerPhones[], headerEmail, linkedIn?, isDefault? } |
| GET | /profiles/:id | — |
| PATCH | /profiles/:id | partial |
| DELETE | /profiles/:id | — |
| POST | /profiles/:id/bases | multipart file (DOCX/PDF) |
| PATCH | /profiles/:id/bases/:baseId/activate | — |
| PUT | /profiles/:id/roles | { roles: [...] } |
| PUT | /profiles/:id/education | { education: [...] } |
| PUT | /profiles/:id/certs | { certs: [...] } |

### 7.4 Fact bank

| Method | Route | Request |
|---|---|---|
| GET | /profiles/:id/facts | ?kind=metric&verified=true |
| POST | /profiles/:id/facts | { kind, claimText, metricValue?, metricUnit?, context, employer?, verified? } |
| POST | /profiles/:id/facts/verify | { factIds: string[] } |
| POST | /profiles/:id/facts/import-from-base | { baseResumeId } |
| PATCH | /facts/:id | partial |
| DELETE | /facts/:id | — |

### 7.5 Settings

| Method | Route | Request |
|---|---|---|
| GET | /settings | — |
| PUT | /settings | any subset of the 10 toggles |
| GET | /profiles/:id/settings | — |
| PUT | /profiles/:id/settings | partial overrides |

### 7.6 JD intake

| Method | Route | Request |
|---|---|---|
| POST | /jds | { profileId, sourceType: "paste", rawText } |
| POST | /jds | multipart file — if extracted < 200 chars: 422 { code: "JD_UNUSABLE" } |
| POST | /jds | { profileId, sourceType: "url", sourceUrl } → 202 then poll |
| GET | /jds/:id | — |
| GET | /jds | ?limit&cursor |

### 7.7 Runs

| Method | Route | Request |
|---|---|---|
| POST | /runs | { profileId, baseResumeId?, jdId, settingsOverride?, contactLocationOverride? } → 202 { runId, status, eventsUrl } |
| GET | /runs | ?status&limit&cursor |
| GET | /runs/:id | — (includes stage, progress, pendingCompany if AWAITING_CONFIRM) |
| GET | /runs/:id/events | SSE stream |
| POST | /runs/:id/confirm-company | { companyName } |
| POST | /runs/:id/regenerate-section | { section, roleId? } |
| PATCH | /runs/:id/output | JSON merge patch |
| POST | /runs/:id/approve | — |
| POST | /runs/:id/retry | — |
| POST | /runs/:id/cancel | — |
| GET | /runs/:id/output | { outputJson, atsScore, metrics, keywordCount, targetCompanies, validation } |
| GET | /runs/:id/validation | { passed, flags } |
| GET | /runs/:id/docx | 200 { url, expiresAt } |
| GET | /runs/:id/pdf | 200 { url, expiresAt } |
| DELETE | /runs/:id | 204 |

Quota errors: 402 PAYMENT_REQUIRED with { code: "RUN_LIMIT_REACHED" | "NO_CREDITS" }.

### 7.8 Batch

| Method | Route | Request |
|---|---|---|
| POST | /batches | { profileId, jds: [...], settingsOverride? } → 202 { batchId, estimatedCostUsd, estimatedMinutes } |
| GET | /batches/:id | — |
| GET | /batches/:id/zip | 200 { url } |

### 7.9 Billing

| Method | Route | Auth | Request |
|---|---|---|---|
| GET | /billing/plans | public | — |
| GET | /billing/subscription | bearer | — |
| POST | /billing/checkout-session | bearer | { planCode, cadence: "monthly"|"annual" } → 200 { url } |
| POST | /billing/portal-session | bearer | — |
| GET | /billing/invoices | bearer | — |
| POST | /billing/webhook | Stripe sig | raw Stripe event |

Webhook events: checkout.session.completed, customer.subscription.created|updated|deleted, invoice.paid, invoice.payment_failed, payment_intent.succeeded. Idempotent by event id. Verify Stripe-Signature against STRIPE_WEBHOOK_SECRET.

Behavior:
- payment_intent.succeeded (starter) → grant 1 RunCredit.
- checkout.session.completed (subscription) → upgrade User.role, create Subscription, reset UsageCounter.
- customer.subscription.deleted → at currentPeriodEnd, cron downgrades User.role → USER.

### 7.10 Branding (Agency)

| Method | Route | Auth | Request |
|---|---|---|---|
| GET | /me/branding | bearer | — |
| PUT | /me/branding | Agency only | { displayName, logoUrl?, contactEmail?, contactPhone?, footerText?, primaryColor? } |
| POST | /me/branding/logo | Agency only | multipart file |

### 7.11 Admin (all guarded, all audited)

| Method | Route | Purpose |
|---|---|---|
| GET | /admin/users | Paginated with plan, usage, last activity |
| GET | /admin/users/:id | Full detail |
| PATCH | /admin/users/:id | { role?, planOverride?, resetQuota?, suspend? } |
| POST | /admin/users/:id/credits | { count } |
| GET | /admin/runs | Global list |
| GET | /admin/runs/:id | Full run + logs + flags + versions |
| POST | /admin/runs/:id/reproduce | Re-run with pinned versions |
| GET | /admin/billing/payments | All payments |
| POST | /admin/billing/refund | { paymentId, amountCents?, reason } |
| GET | /admin/audit | Admin action log |
| GET | /admin/2fa/enroll | TOTP enrollment |
| POST | /admin/2fa/verify | Confirm TOTP |

### 7.12 Health & limits

GET /healthz, GET /readyz, GET /metrics.

Rate limits (Redis): auth 10/min/IP (admin 5/min/IP), POST /runs 20/min/user, general 120/min/user.

---

## 8. Third-party services

| Service | Purpose | Env |
|---|---|---|
| LLM (Anthropic / OpenAI) | Analysis + rewriting | LLM_PROVIDER, LLM_API_KEY, LLM_MODEL_ANALYZE, LLM_MODEL_WRITE |
| Stripe | Billing | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_* |
| Resend / Postmark | Email | RESEND_API_KEY, EMAIL_FROM |
| Google OAuth | SSO | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI |
| S3 / R2 | Storage | S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY |
| Sentry | Errors | SENTRY_DSN |

---

## 9. State management per platform

| Platform | Server | Client | Auth | Persistence |
|---|---|---|---|---|
| Web (Next.js) | TanStack Query | Zustand | Auth context + HttpOnly refresh cookie; access in memory | localStorage theme |
| iOS (Phase 5) | URLSession async/await + @Observable | @Observable | AuthManager; refresh in Keychain | UserDefaults |
| Android (Phase 5) | Retrofit + Flow + Paging 3 | ViewModel + StateFlow | AuthRepository; refresh in EncryptedSharedPreferences | DataStore |
| macOS (Phase 5) | Shared Swift package or web (Tauri) | — | Keychain | UserDefaults |
| Windows (Phase 5) | Reuses web React + TanStack Query | Zustand | OS vault | Tauri store |

Cross-cutting: SSE for progress (fallback to polling every 2 s), query invalidation on run.complete, single-flight refresh interceptor.

---

## 10. Platform guidance

### 10.1 Web (Phase 1, primary)

- Next.js 14 (App Router), React 18, TS, Tailwind with tokens from 03-ui-reference/resume-engine.html, TanStack Query, Zustand, Zod, @stripe/stripe-js.
- Routes:
  - (marketing)/ — landing page, split resume-engine.html into Hero, HowItWorks, FeaturesBento, Accuracy, Pricing, WhinkBanner, CTA, Footer.
  - (auth)/sign-in, (auth)/sign-up, (auth)/forgot-password — real forms.
  - (app)/dashboard, (app)/runs/[id], (app)/profiles, (app)/settings, (app)/billing.
  - (admin)/admin/users, (admin)/admin/runs, (admin)/admin/audit, (admin)/admin/branding.
- Wiring changes from provided HTML:
  - Toggles → PUT /settings (currently CSS-only).
  - Pricing toggle → real Stripe price IDs; annual = 49→39, 199→159.
  - Auth modals → real POST /auth/*.
  - Checkout modal → redirect to Stripe Checkout; remove raw card inputs from your DOM (PCI).
  - Theme toggle → PATCH /users/me { themePref } + cookie.
- Accessibility: keyboard operable, labelled inputs, visible focus, WCAG 2.1 AA, ARIA live regions for stage announcements.

### 10.2 iOS (Phase 5)

Swift 5.10+, SwiftUI, iOS 17+, URLSession async/await, KeychainAccess. Screens: sign in/up, forgot password, run list, run detail (read-only + download + share), profile list, settings, pricing (link to web checkout). Do not implement IAP unless legal approves. Refresh in Keychain. TestFlight → App Store.

### 10.3 Android (Phase 5)

Kotlin 1.9+, Compose BOM, Material 3, Navigation Compose, Hilt, Retrofit + OkHttp + Moshi, Coroutines/Flow, DataStore, EncryptedSharedPreferences, Paging 3. Custom Tabs for checkout. OkHttp Authenticator for refresh. Play Console.

### 10.4 macOS & Windows (Phase 5)

Tauri 2 wrapping the web build (recommended). ~5–10 MB installer. OS WebView + OS credential vault + drag-and-drop file input + native save dialog. macOS alternative: SwiftUI native sharing Swift package with iOS. Windows alternative: .NET MAUI / WinUI 3. macOS notarized DMG; Windows EV-signed MSI/NSIS or MSIX.

### 10.5 Screens to design in Phase 1 (not in provided UI)

1. Dashboard (empty state, recent runs, usage/credits).
2. Profiles (list, create, base upload, header lock).
3. New Resume (profile picker, JD paste/file/URL tabs, Generate).
4. Run progress (stage labels, cancel).
5. Company-confirm (guess + evidence + edit).
6. Review (JD left, resume right, validator panel, inline edit, per-section regenerate, download).
7. History (table, filter, download, duplicate).
8. Batch (paste list, cost estimate, per-item status, zip download).
9. Settings (10 toggles + theme + account).
10. Billing (plan, invoices, Stripe portal).
11. Admin: users.
12. Admin: runs.
13. Admin: audit.
14. Agency branding.

---

## 11. Phase plan

| Phase | Scope | Done when | Platform |
|---|---|---|---|
| 1 | Admin login, profiles, base parser, JD paste, 8-stage pipeline, R1–R20 validator, fact bank, DOCX render, run history, inline edits, per-section regenerate, admin panel. All Phase-1 screens. | Admin produces a DOCX that passes all rules and opens cleanly in Word + Google Docs. | Web only |
| 2 | Public signup, Stripe tiers, checkout, portal, webhooks, quotas enforced, company-confirm UX polish, JD file/URL intake, PDF export, page-count check. | New user signs up, buys Starter, runs a resume end-to-end. | Web only |
| 3 | Batch (≤20 JDs → zip), cost estimate, multi-profile per PRO/Agency, admin refunds, admin user detail. | 10 JDs in one batch, < 15 min, zip downloads. | Web only |
| 4 | Agency branding, Agency API keys, admin reproduce endpoint. | Agency DOCX carries their brand; API key triggers a run. | Web only |
| 5 | iOS, Android, macOS, Windows clients. Admin 2FA. Cover-letter + interview-prep add-ons. | — | Native + desktop |

Non-negotiable: admin panel ships in Phase 1.

---

## 12. Repo layout

resume-engine/
├── apps/
│   ├── api/                NestJS — REST + SSE + webhooks
│   │   └── src/
│   │       ├── auth/bootstrap-admin.ts
│   │       ├── admin/
│   │       ├── billing/
│   │       ├── profiles/
│   │       ├── jds/
│   │       ├── runs/
│   │       └── settings/
│   ├── worker/             BullMQ — pipeline stages 0–8
│   │   └── src/
│   │       ├── pipeline/
│   │       ├── rule-engine/   R1–R20
│   │       └── facts/
│   ├── renderer/           docx npm + LibreOffice
│   ├── web/                Next.js — marketing + app + admin
│   ├── mobile/             Expo RN (Phase 5)
│   └── desktop/            Tauri (Phase 5)
├── packages/
│   ├── sdk/                OpenAPI-generated client
│   ├── tokens/             CSS variables from UI
│   ├── rules/              R1–R20 validator (Node only)
│   ├── facts/              metric + claim checker (Node only)
│   └── types/              shared TS types
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── infra/
│   ├── docker-compose.yml
│   └── render.yaml
├── HANDOFF.md              updated before every status update
├── OPEN_QUESTIONS.md
└── README.md

---

## 13. Security & compliance

- Resumes are PII. Encrypt at rest (Postgres + S3 SSE). Signed URLs 15-min TTL. Never log full resume text. Redact in Sentry.
- Admin credential: env-only (§3.3). Never hardcoded, never committed, never in logs, never sent to dev team over chat.
- Payment: never handle raw PAN. Stripe Checkout only. No card fields in your own DOM.
- Tenant isolation: every query filters by userId (or isAdmin with audit). Cross-tenant access → 404 not 403.
- API keys (Agency, Phase 4): hashed at rest (bcrypt or SHA-256), prefix visible, scoped to run endpoints, rate-limited, revocable.
- GDPR/CCPA: GET /users/me/export returns full account data. DELETE /users/me soft-deletes 30 days then hard-deletes. Phase 2.
- Audit: every admin action, billing event, run start/finish. Retention 2 years.

---

## 14. Sign-off

This spec is the source of truth. Deviations must be proposed in OPEN_QUESTIONS.md and approved by Whink in writing. The dev team acknowledges:

1. R1–R20 in 02-RESUME_ENGINE_SPEC.md are authoritative and not relaxed.
2. Admin credentials never hardcoded, committed, or requested over chat.
3. Every run reproducible from pinned RuleSet, PromptVersion, BaseResume.version, and model IDs.
4. DOCX template per 02-RESUME_ENGINE_SPEC.md §6 is the visual contract.
5. Admin panel ships in Phase 1.

