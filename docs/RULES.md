# Rules

Status of each rule in the code provided so far. The master specification and ruleset documents were never received, so the full R1–R20 definitions are not available. Anything below is read from code and code comments, not from a spec.

## Signed off (stated in the headers of Parts 2–4)

| Rule | Decision | Where it appears in code |
|---|---|---|
| R2 | Close variant: 70% token overlap, stop words stripped | `run.worker.ts` defines `tokenize` and `tokenOverlapPct` but never calls them. `RuleConfig.roleOverlapThreshold = 0.7` in `packages/rules/src/types.ts`. Settings toggle `r2_title_close_variant` |
| R9 | LLM-judged; emits a `warn` flag; never blocks | Worker adds `R9_LOW_CONFIDENCE` (`warn`) when analysis confidence is under 0.75. Part 3 types add `llmScoreFloor = 0.6` for bullet scores. Toggle `r9_llm_judged` |
| R10 | Duplicate verb; per-resume; `warn` only | Worker stage 4 adds `R10_DUP_VERB` (`warn`) but compares first words of bullets within each role, not across the whole résumé. Toggle `r10_duplicate_verb` |
| R18 | Filename regex `^[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+\.docx$` | Three copies of the same regex: `profiles.constants.ts` (upload rejected with `422 INVALID_FILENAME`), `run.worker.ts` (`R18_FILENAME`, `warn`, only for `.docx` file inputs), `RuleConfig.filenamePattern`. Toggle `r18_filename_regex` |

The 422 message for R18 says "First_Last_Role.docx". The regex requires three underscore-separated parts, and the pattern itself puts no restriction on what those parts mean.

## Named only in Part 3 comments (reconstructed, unconfirmed)

Part 3's header says its R1–R20 wording was reconstructed. These are the rule numbers its config comments attach to settings:

| Rule | Setting (default) |
|---|---|
| R6 | `maxGapMonths` (6): employment gap |
| R7 | `bulletsPerRole` (2–6) |
| R8 | `maxBulletChars` (220) |
| R9 | `llmScoreFloor` (0.6) |
| R11 | `bannedPhrases`: clichés |
| R12 | `pronouns`: first-person markers |
| R13 | Renderer node inventory (`RenderNode`), used to prove "no unsupported constructs"; which constructs are unsupported is not stated |
| R14 | `maxTotalWords` (900) |
| R15 | `maxPages` (3) |
| R16 | `skillsBounds` (8–30) |
| R20 | `maxRetries` (2) and fact bank policy (`requireVerified: true`, `allowUnverifiedNumbers: false`) |

No rule implementations were received, only these types. R1, R3, R4, R5, R17 and R19 are not mentioned anywhere in the provided code.

## Other toggles in the Settings screen

`evidence_required`, `header_lock`, `company_confirmation`, `keyword_density_check`, `date_normalization`, `section_order_check`. The settings screen shows ten toggles; the database `UserSettings` model has ten differently named booleans (`strictFactsMode`, `lockCompanyNames`, `banHyphensInProse`, and so on). The two lists have not been reconciled.

## Inconsistencies to resolve

- Stop-word lists differ: the worker uses 19 words; `RuleConfig.roleStopWords` has a different set (it adds `head`, `chief`, `with`, `i`–`iv`, drops `mid`, `or`, `on`).
- Flag severities: Part 3 uses `error | warn | info`; the frontend type uses `warn | fail | info`.
