# Rules

The authoritative text is the rule table in `docs/source-parts/Resume_Engine_Spec_v3.1.txt` (Section 4, "AUTHORITATIVE RULESET"). `01-SPEC-v3.md` says that for R1 to R20 and the DOCX layout, the ruleset document wins. The full `02-RESUME_ENGINE_SPEC.md` has not been supplied; this repo has the rule table and the layout section from it.

Code: `packages/rules/src/rules/index.ts`. Config and defaults: `packages/rules/src/types.ts`. Tests: `packages/rules/tests/rules.spec.ts`.

**Blocking** means the failing section is regenerated with the failure fed back to the model, up to two retries (three attempts). If blocking failures survive, nothing is rendered or exported and the run ends as `FAILED` with `errorCode = VALIDATION_FAILED`. Where the spec says "LLM judged", "warn", or "optional", the rule only ever warns, and the validator forces that even if a rule's code tried to block.

| Rule | Spec | What the code checks | Result |
|---|---|---|---|
| R1 | Header is locked | Name, city, phones, email, LinkedIn equal the profile exactly. The city may equal the run's contact location override instead. | Blocking |
| R2 | Headline is rewritten to the JD | Line 1 contains the JD role title, or shares at least 70% of its tokens with it (stop words such as Senior and Lead ignored). Overlap coefficient: shared / smaller set. | Blocking |
| R3 | Two headline lines | Exactly 2 lines, neither empty. | Blocking |
| R4 | Four short paragraphs, JD language | Exactly 4 non-empty paragraphs. Warns when a paragraph is over 70 words, or when fewer than 2 JD keywords appear. | Blocking (count); warn (length, JD terms) |
| R5 | Six competency subsections in order | Labels, in order: Soft Skills, Stakeholder Management, Technical Skills, Delivery Methodologies, Security and Compliance, Business Tools. Warns on an empty subsection. | Blocking |
| R6 | Titles change to JD adjacent titles | Each title differs from the profile's base title and shares a term with the JD. | Blocking |
| R7 | Company names, dates, order never change | Same number of roles, and per position the same company, start date and end date as the roster. Null and "Present" are equal. | Blocking |
| R8 | One bold flagship line per role | Each role has a non-empty, single line flagship. | Blocking |
| R9 | Bullet structure, LLM judged | Warns for each bullet whose LLM score is under 0.6. Emits an info flag when no judgement was supplied. **The pipeline does not produce a judgement yet**, so in practice R9 only reports that it did not run. | Never blocks |
| R10 | Varied bullets, per resume | Warns when an opening verb is used more than once anywhere in the resume (flagship lines and bullets, across all companies). | Never blocks |
| R11 | At least 8 points per role | Flagship plus bullets is at least 8. | Blocking |
| R12 | Bullet count stable against the base | Warns when a role's bullet count differs from the base resume's. | Never blocks |
| R13 | Education, certifications unchanged | Same entries as the profile (institution, degree, field, years; name, issuer, year). Role dates are covered by R7. | Blocking |
| R14 | Keyword block of 150 or more terms | At least 150 distinct terms (case insensitive). Warns on duplicates and on JD keywords missing from the block. | Blocking (count) |
| R15 | Keyword block replaced every time | Fails when the block equals the base resume's block. Reports the overlap as info. | Blocking |
| R16 | Seven target companies | Exactly 7 distinct names, each with a department and an example role. | Blocking |
| R17 | WHINK Group framing, optional | Warns when "WHINK Group" appears while the toggle is off, unless the candidate actually worked at a company with "whink" in its name. | Never blocks |
| R18 | File name format | `^[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+_[a-zA-Z0-9\s\-_]+\.docx$` (Victor's sign-off). | Blocking |
| R19 | No leftover base text | Fails when a flagship or bullet equals base text after normalising case and punctuation. Warns when it is 90% similar. | Blocking (exact); warn (near copy) |
| R20 | Style: short sentences, no hyphens or em dashes | Em and en dashes always fail. Hyphens fail while `banHyphensInProse` is on. Warns on sentences over 28 words. Applies to headline, summary, flagship lines and bullets. | Blocking (dashes); warn (length) |
| FACTS | Stage 6 "fact bank check on every numeric token" (`01-SPEC-v3.md` section 5) | Every number in the summary, flagship lines and bullets must match a Fact Bank entry (see [API.md](./API.md#fact-bank)) (exact number and unit, or an exact alias such as `2M`). Bare years are ignored. With `strictFactsMode` on, a miss or an unverified match blocks; otherwise it warns. | Blocking in strict mode |

## Signed off by Victor

| Decision | Where |
|---|---|
| R18 filename regex | `R18_FILENAME_PATTERN`; also enforced on base resume upload (`profiles.constants.ts`, `422 INVALID_FILENAME`) |
| R2 close variant: 70% token overlap, stop words ignored | `roleOverlapThreshold`, `roleStopWords` |
| R9 LLM judged, warn only | rule has `blocking: false` |
| R10 duplicate verb: per resume, warn only | rule has `blocking: false` |

## Thresholds that are not in the spec

The spec says "short" and "uses JD language" without numbers. These defaults are mine, live in `DEFAULT_RULE_CONFIG`, and only ever produce warnings:

| Setting | Default | Used by |
|---|---|---|
| `summaryMaxParagraphWords` | 70 | R4 |
| `summaryMinJdTerms` | 2 | R4 |
| `maxSentenceWords` | 28 | R20 |
| `nearDuplicateSimilarity` | 0.9 | R19 |
| `llmScoreFloor` | 0.6 | R9 |

## Not implemented

- The "claims check on new assertions" named in `01-SPEC-v3.md` section 5, Stage 6.
- Page overflow is a Stage 8 QA warning (`QA:PAGE_OVERFLOW`, more than 3 pages), not one of R1 to R20.
- How the spec's R12 should treat a base resume with fewer than 8 points per role is not stated. The rule warns on any difference, so padding to satisfy R11 also produces an R12 warning.

## How flags are stored

The schema's `ValidationFlag` has `code`, `severity`, `field` and `message`, and no rule id. The rule id is stored as a prefix of the code, for example `R2:HEADLINE_ROLE_MISMATCH`, and `field` holds the path such as `experience[1].bullets[3]`. The API splits it back into `ruleId` and `code`, and reports `blocking` as `severity === "error"`.
