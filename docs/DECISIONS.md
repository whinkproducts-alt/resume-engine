# Architectural decisions

Signed off by Victor Igboekwe (Whink Apps). Also recorded in `docs/source-parts/Resume_Engine_Spec_v3.1.txt`, Section 2.

## 1. The Prisma schema is the source of truth
`apps/api/prisma/schema.prisma` (Part 1, matching §4 of `01-SPEC-v3.md`) defines the database. The BullMQ worker reads and writes that schema; it never dictates it. If the worker needs a new field or status, write a standard Prisma migration. Do not invent a parallel data structure.

## 2. The backend defines the API contract
Endpoints, JSON payloads and status codes follow `01-SPEC-v3.md` §7. The frontend adapts its TanStack Query hooks and components to the backend's exact responses. If the frontend needs differently shaped data, transform it in the frontend or request a new endpoint. Do not bend the backend to the UI.

## 3. Licence: proprietary, all rights reserved
Closed-source commercial SaaS owned by Whink Apps (Whink Group). No MIT, Apache or GPL. The repository is private. See `LICENSE`.

## Precedence between documents
`01-SPEC-v3.md` states that for the rules R1–R20 and the DOCX layout, `02-RESUME_ENGINE_SPEC.md` wins; for architecture, data models, API surface, deployment and platform guidance, `01-SPEC-v3.md` wins. The full 02 document has not been supplied. Its rule table and layout section are reproduced in `docs/source-parts/Resume_Engine_Spec_v3.1.txt`.
