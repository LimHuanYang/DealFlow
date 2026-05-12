# DealFlow

A CRM web app. Phase 1 = kernel (contacts, companies, deals, pipeline, activities, notes, auth).

## Dev quickstart

Requires Node 22+, pnpm 9+, Docker.

```bash
pnpm install
pnpm dev:env     # starts Postgres, MinIO, Mailhog
pnpm dev         # starts api + web in watch mode
```

## Layout

- `apps/api` — Fastify backend
- `apps/web` — React frontend
- `packages/db` — Drizzle schema + migrations
- `packages/shared` — Zod schemas shared api ↔ web
- `packages/ai` — AI provider abstraction

## Tests

```bash
pnpm test          # unit + integration
pnpm test:e2e      # Playwright (from e2e/)
```

## Design docs

- `docs/superpowers/specs/` — design (the why)
- `docs/superpowers/plans/` — implementation plans (the how)
