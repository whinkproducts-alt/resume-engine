# Security

Resume Engine handles résumés, which are personal data.

Report a vulnerability privately to Whink Apps (Whinkproducts@gmail.com). Do not open a public issue.

Rules the code follows (see `docs/01-SPEC-v3.md` section 13):
- No secrets, resume text or `.env` files in the repository, logs or Sentry.
- Admin credentials come from environment variables only.
- Another tenant's data is answered with 404, never 403.
- Artifacts are served through short lived signed URLs.
