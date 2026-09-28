# Reading List

A personal RSS reader, read-later queue, and reference library, running on
Cloudflare Workers + D1 (free tier).

- [PLAN.md](PLAN.md): what we're building and in what order
- [docs/setup.md](docs/setup.md): local development and one-time Cloudflare setup
- [docs/design.md](docs/design.md): visual design, reading typography, and interactions

```
apps/web/        SvelteKit app (UI + API), deployed as a Worker
packages/core/   Shared schema, types, and logic (no Cloudflare runtime deps)
workers/fetcher/ Cron Worker: polls feeds every 15 minutes
migrations/      D1 SQL migrations, generated from packages/core/src/db/schema.ts
```
