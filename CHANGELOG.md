# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Monorepo layout: `apps/web`, `apps/api`, `packages/{rules,renderer,qa,storage}`.
- Validator for R1 to R20 plus a fact bank check, DOCX renderer to the section 6 layout,
  LibreOffice PDF page QA, S3/R2 artifact storage.
- BullMQ pipeline (stages 1 to 8) on the Prisma schema; initial and admin 2FA migrations.
- API: auth with rotating refresh cookie, profiles and roster, JDs, runs, settings,
  branding, admin panel, admin 2FA.
- Web app for all Phase 1 screens.
- Fact bank API (list, create, verify, import from base résumé, update, delete) and a Fact Bank section on the profile page.
