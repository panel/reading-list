# Setup

## Local development

Requires Node 22+ and pnpm 10.

```sh
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars   # set DEV_USER_EMAIL
pnpm db:migrate:local                              # creates a local D1 in apps/web/.wrangler
pnpm dev                                           # http://localhost:5173
```

Cloudflare Access isn't in front of the dev server, so `DEV_USER_EMAIL` stands
in for the signed-in user. It is ignored in production builds.

Other commands (from the repo root): `pnpm lint`, `pnpm check`, `pnpm test`,
`pnpm build`, `pnpm format`.

### Changing the schema

1. Edit `packages/core/src/db/schema.ts`.
2. `pnpm db:generate -- --name short_description` writes a SQL migration to
   `migrations/`. Read it before committing. Hand-written migrations (FTS5
   tables, triggers) go through `pnpm --filter @reading-list/core exec drizzle-kit generate --custom --name ...`.
3. `pnpm db:migrate:local` to apply it locally. Deploys apply it remotely.

## One-time Cloudflare setup

The app is served at `reader.nelsonfamily.fyi`.

1. **Create the database**

   ```sh
   pnpm --filter web exec wrangler login
   pnpm --filter web exec wrangler d1 create reading-list
   ```

   Put the printed `database_id` in `apps/web/wrangler.jsonc`.

2. **Subdomain.** `apps/web/wrangler.jsonc` already routes the Worker to
   `reader.nelsonfamily.fyi` as a custom domain. `nelsonfamily.fyi` must be a zone
   on your Cloudflare account; `wrangler deploy` creates the DNS record and
   certificate. There must not already be a DNS record for `reader`.

3. **Put Cloudflare Access in front of it** (Zero Trust dashboard → Access →
   Applications → Add → Self-hosted):
   - Application domain: `reader.nelsonfamily.fyi`
   - Policy: Allow, Include → Emails → your email
   - After saving, copy the **Application Audience (AUD) tag** from the
     application's overview.
   - Your team domain is under Zero Trust → Settings → Custom Pages
     (`https://<team>.cloudflareaccess.com`).

   Set both in `apps/web/wrangler.jsonc` under `vars` (`ACCESS_AUD`,
   `ACCESS_TEAM_DOMAIN`). Neither is secret.

   The app checks the Access JWT on every request and rejects anything without
   a valid one, so it stays closed even if Access were misconfigured.

4. **Let GitHub Actions deploy.** Create an API token (My Profile → API Tokens →
   Create Token → "Edit Cloudflare Workers" template, then add
   **Account → D1 → Edit**). In the GitHub repo settings:
   - Secrets → Actions: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables → Actions: `DEPLOY_ENABLED` = `true`

   Every push to `main` then runs checks, applies migrations, and deploys.
