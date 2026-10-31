## What and why

## Checklist
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint` and `pnpm check:tokens` pass
- [ ] Schema change? A Prisma migration is included (the schema is the source of truth)
- [ ] API change? It follows `docs/01-SPEC-v3.md` section 7 (the backend defines the contract)
- [ ] Rule change? It matches the authoritative ruleset in `docs/RULES.md`
- [ ] No secrets, no real resumes, no `.env` files
