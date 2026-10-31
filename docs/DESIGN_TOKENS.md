# Design tokens

Source of truth: `apps/web/src/app/globals.css` (CSS variables) and `apps/web/tailwind.config.ts` (Tailwind mapping). `globals.css` marks the variables "DO NOT OVERRIDE". The root layout sets `class="dark"` on `<html>`; there is no light theme (the Settings screen says dark is "locked for Phase 1").

## Colour variables

| Variable | Value | Tailwind name |
|---|---|---|
| `--bg` | `#08090b` | `bg` |
| `--bg-2` | `#10131a` | `bg-2` |
| `--bg-3` | `#181c26` | `bg-3` |
| `--surface` | `#1c2130` | `surface` |
| `--border` | `rgba(255, 255, 255, 0.07)` | `border` |
| `--fg` | `#edf0f5` | `fg` |
| `--fg-2` | `#8e97aa` | `fg-2` |
| `--gold` | `#d4a017` | `gold` |
| `--gold-2` | `#f0c040` | `gold-2` |
| `--success` | `#22c55e` | `success` |
| `--danger` | `#f05252` | `danger` |

Text selection uses `rgba(212,160,23,0.35)` (a literal in `globals.css`, not a token).

## Typography

| Role | Font stack | Loaded from |
|---|---|---|
| Sans (`font-sans`, body) | Outfit, ui-sans-serif, system-ui, sans-serif | Google Fonts (weights 300–700) |
| Mono (`font-mono`) | DM Mono, ui-monospace, SFMono-Regular, monospace | Google Fonts (weights 400, 500) |

## Shape and elevation

| Token | Value |
|---|---|
| `rounded-xl` | `0.875rem` |
| `rounded-2xl` | `1.125rem` |
| `shadow-card` | `0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.45)` |

## Component classes (`globals.css`)

| Class | Purpose |
|---|---|
| `.btn` | Base button: inline-flex, `rounded-lg`, `px-3.5 py-2`, `text-sm font-medium` |
| `.btn-primary` | Gold background, black text, `gold-2` on hover |
| `.btn-ghost` | `fg-2` text, `bg-3` background on hover |
| `.btn-danger` | `danger` background, white text |
| `.btn-outline` | Bordered, `bg-3` on hover |
| `.input` | Full-width field on `bg-2`; gold border and ring on focus |
| `.card` | `surface` background, `rounded-xl`, border, `shadow-card` |
| `.badge` | Pill, 11px uppercase label |
| `.badge-warn` / `-ok` / `-fail` / `-idle` | Gold / success / danger / neutral tones |

## React primitives (`apps/web/src/components/ui.tsx`)

| Component | Props worth knowing |
|---|---|
| `Button` | `variant`: `primary` (default), `ghost`, `outline`, `danger`; `loading` shows a spinner and disables the button |
| `Input` | Native input props |
| `Card` | Native div props |
| `Badge` | `tone`: `idle` (default), `warn`, `ok`, `fail` |
| `EmptyState` | `title`, `description?`, `action?` |
| `Spinner`, `Skeleton` | `className?` |

## Not yet enforced

The structure document describes a `check:tokens` script (`scripts/check-tokens.ts`) that fails on hard-coded colours in `src/`. That script has not been added. `globals.css` itself contains one literal colour outside the variables (the selection colour above).
