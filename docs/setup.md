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

The app is served at `reader.nelsonfamily.fyi`. `nelsonfamily.fyi` must be a
zone on your Cloudflare account, with no existing DNS record for `reader`
(the first deploy creates it, along with the certificate).

Order matters a little: deploy the Worker first so the hostname exists, then
put Access in front of it. That's safe because until Access is configured the
app refuses every request with a 500.

1. **Log in and create the database** (run from the repo root)

   ```sh
   pnpm install
   pnpm --filter web exec wrangler login
   pnpm --filter web exec wrangler d1 create reading-list
   ```

   If wrangler offers to add the binding to your config, say **no**. Instead
   put the printed `database_id` into the existing `DB` entry in
   `apps/web/wrangler.jsonc`.

2. **Create the tables and deploy**

   ```sh
   pnpm --filter web db:migrate:remote
   pnpm build
   pnpm --filter web exec wrangler deploy
   ```

   Open `https://reader.nelsonfamily.fyi`. You should get
   *"Cloudflare Access is not configured"*. That means the Worker is up and
   locked. The DNS record and certificate can take a minute or two to appear.

3. **Put Cloudflare Access in front of it** (Zero Trust dashboard → Access →
   Applications → Add an application → Self-hosted):
   - Application domain: `reader.nelsonfamily.fyi`
   - Policy: Allow, Include → Emails → your email
   - After saving, copy the **Application Audience (AUD) tag** from the
     application's overview.
   - Your team domain is under Zero Trust → Settings → Custom Pages
     (`https://<team>.cloudflareaccess.com`).

   Set both in `apps/web/wrangler.jsonc` under `vars` (`ACCESS_AUD`,
   `ACCESS_TEAM_DOMAIN`). Neither is secret. Then deploy again
   (`pnpm build && pnpm --filter web exec wrangler deploy`). Now the URL asks
   you to log in, then shows the home page.

   The app checks the Access JWT on every request and rejects anything without
   a valid one, so it stays closed even if Access were misconfigured.

4. **Let the API through Access** (for the iOS Shortcut). <a id="let-the-api-through-access"></a>
   `/api/*` authenticates with the app's own tokens (Settings → API tokens),
   so Access must not ask for a login there. In the Zero Trust dashboard, go
   to Access → Applications → Add an application → Self-hosted:
   - Application name: `Reading List API`
   - Domain: subdomain `reader`, domain `nelsonfamily.fyi`, path `api/`
   - Policy: action **Bypass**, Include → **Everyone**

   If the dashboard says **another application owns that destination**, the
   path is missing: without it the new app claims the same hostname as the
   main one. Fill in the path (`api`), so you end up with two apps,
   `reader.nelsonfamily.fyi` (login) and `reader.nelsonfamily.fyi/api` (bypass).

   Access applies the most specific path, so everything outside `/api/` still
   requires login. The app enforces this on its side too: a token works only
   on `/api/*`, and `/api/*` never accepts anything but a token.

   Check it: `curl -i -X POST https://reader.nelsonfamily.fyi/api/links`
   should return `401` with `{"ok":false,"message":"Missing or invalid API
   token"}` from the app. If you see an Access login page instead, the bypass
   isn't active yet.

5. **Let GitHub Actions deploy from now on.** Create an API token (My Profile →
   API Tokens → Create Token → "Edit Cloudflare Workers" template, then add
   **Account → D1 → Edit**). In the GitHub repo settings:
   - Secrets → Actions: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables → Actions: `DEPLOY_ENABLED` = `true`

   `DEPLOY_ENABLED` must be a **variable**, not a secret: the workflow can't
   read secrets when deciding whether to run the deploy job.

   Commit the `wrangler.jsonc` changes from steps 1 and 3. Every push to
   `main` then runs checks, applies migrations, and deploys.

## Troubleshooting

- **Errors in production:** Workers & Pages → reading-list → Logs, or stream
  them live with `pnpm --filter web exec wrangler tail`.
- **`no such table`:** migrations haven't been applied to the remote
  database. Run `pnpm --filter web db:migrate:remote` (CI does this before
  each deploy).
