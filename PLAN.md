# Reading List — Plan

A personal RSS reader, read-later queue, and reference library in one app,
running on Cloudflare's free tier.

## The three jobs

| Job | What happens | Main view |
| --- | --- | --- |
| **Follow** | New posts from authors I subscribe to show up automatically | Feed inbox |
| **Save** | I send a link (with an optional note and tags) from anywhere to read later | Queue |
| **Reference** | Articles I cite and share often live somewhere I can find them fast | Library + search |

The core idea: **everything is a link**. A feed entry is a link I haven't
decided about yet. Saving it (or sending one in by hand) promotes it to a
*saved link*, which then moves through a lifecycle:

```
feed entry ──save──▶ queued ──read──▶ archived
                        │                 │
                        └──── ★ reference ◀┘   (a flag, not a state: anything can be starred)
```

## Stack

**All TypeScript, all Cloudflare. No Go.**

- **SvelteKit + `@sveltejs/adapter-cloudflare`**, deployed as a Worker. It serves
  both the UI and the JSON API (`+server.ts` routes).
- **A second small Worker (`fetcher`)** for the cron job that polls feeds.
  SvelteKit's adapter doesn't expose a `scheduled()` handler, and keeping feed
  polling separate keeps its CPU budget separate too. Both Workers bind the same
  D1 database.
- **D1 (SQLite)** for everything. It supports **FTS5**, which covers full-text
  search with no extra service.
- **Cloudflare Access (Zero Trust, free up to 50 users)** for login. It sits in
  front of the app, so there's no auth code to write, and it hands the app a
  signed identity (email) on every request.
- **Drizzle ORM** for typed queries. Migrations are hand-written SQL through
  `wrangler d1 migrations`, because Drizzle can't model FTS5 virtual tables or
  triggers.
- **`fast-xml-parser`** for RSS/Atom. **`HTMLRewriter`** (built into Workers)
  for pulling `<title>`, `og:*` tags, and feed `<link rel="alternate">` out of
  pages. It streams, so it uses very little CPU.
- Later, optionally: **R2** for archived page snapshots; **Workers AI +
  Vectorize** for "find things like this" semantic search. Both have free tiers.

### Why not Go

- Go on Workers means TinyGo compiled to WASM: a limited standard library, awkward
  `net/http`, and bigger bundles, all to hit the same D1 bindings.
- Cloudflare Containers (the way to run a real Go server) need a paid plan.
- Hosting Go somewhere else splits the app across two platforms and leaves the
  free tier.
- The workload is I/O-bound glue (fetch a feed, parse it, write rows), so Go's
  strengths don't come into play.

Go would only make sense if you later want to move this off Cloudflare. The
schema is plain SQLite, so that stays possible.

### Free-tier constraints that shape the design

| Limit (Workers Free) | Impact | Design response |
| --- | --- | --- |
| **10 ms CPU** per invocation (waiting on network doesn't count) | Parsing a big feed or running readability on a long article can go over | Parse feeds one per invocation (fan out); get metadata with streaming `HTMLRewriter`; leave full-text extraction until later and keep it optional |
| **50 subrequests** per invocation | Caps how many feeds one cron run can touch | At ≤100 feeds this isn't a problem: ~25 feeds come due per 15-minute tick (see Slice 5) |
| **100k requests/day** | More than enough for one person | — |
| **D1: 5M rows read / 100k rows written per day, 5 GB** | Unindexed scans and FTS rebuilds count against reads | Index every query path; prune old unsaved feed entries; use conditional GET so an unchanged feed writes nothing |
| **5 cron triggers** per account | Fine | One trigger (e.g. every 15 min); per-feed `next_fetch_at` decides what actually gets fetched |

## Multi-user: yes, cheaply

Put a `user_id` column on every owned table from day one, and scope every query
through one helper (`db.forUser(userId)`). That's about all multi-user costs
here. Cloudflare Access already provides identity, so you get users by adding an
email to the Access policy. **Deploy it single-user; the schema is multi-user
ready.** What we're *not* building: signup flows, per-user quotas, admin UI.

Feeds themselves are shared (`feeds` has one row per URL, fetched once) and
users hold `subscriptions` to them, so two users following the same blog don't
double the fetches.

## Data model (first cut)

```sql
users          (id, email UNIQUE, created_at)
api_tokens     (id, user_id, name, token_hash, scopes, last_used_at, created_at)
               -- for iOS Shortcuts, the bookmarklet, and agents; scopes e.g. 'links:write', 'read'

feeds          (id, url UNIQUE, site_url, title, etag, last_modified,
                last_fetched_at, next_fetch_at, error_count, last_error)
subscriptions  (user_id, feed_id, title_override, folder, created_at, PK(user_id, feed_id))
feed_entries   (id, feed_id, guid, url, title, author, summary, published_at,
                UNIQUE(feed_id, guid))
entry_state    (user_id, entry_id, read_at, dismissed_at, PK(user_id, entry_id))

links          (id, user_id, url, canonical_url, title, site_name, author,
                description, note, status CHECK(status IN ('queued','archived')),
                is_reference, source CHECK(source IN ('manual','feed')),
                source_entry_id NULL, saved_at, read_at, updated_at,
                UNIQUE(user_id, canonical_url))
tags           (id, user_id, name, UNIQUE(user_id, name))
link_tags      (link_id, tag_id, PK(link_id, tag_id))

links_fts      -- FTS5 over title, description, note, site_name, author, tag names;
               -- kept in sync by triggers
```

Decisions baked in:

- **IDs are ULIDs** (text primary keys) on every table except join tables.
  They sort by time, can't be guessed, and are safe to put in a public URL if
  share pages ever happen. They cost nothing now.
- **`feed_entries` and `links` are separate tables.** Entries are high volume and
  disposable, so unsaved ones older than N days get pruned. Links are curated
  and kept forever. Saving an entry copies it into `links` with a pointer back.
- **`canonical_url` dedupes.** Strip `utm_*` and fragments, and normalize the host.
  Saving the same article twice updates it instead of creating a duplicate.
- **Reference is a flag, not a status.** An article can be starred as a
  reference whether or not you've "read" it in queue terms.

## Order of work: vertical slices

Each slice ships something usable end to end (UI → API → DB → deployed) and
builds on the one before. The first few are small on purpose, to prove the
pipeline.

### Slice 0: Walking skeleton
*"A deployed page, behind login, that reads from D1."*
- pnpm monorepo: `apps/web` (SvelteKit, bootstrapped with `sv`), `packages/core`
  (schema, types, shared logic such as URL canonicalization and feed parsing).
- `wrangler.toml` with a D1 binding and a first migration (`users`, `links`).
- App on a subdomain of your custom domain (e.g. `reader.nelsonfamily.fyi`), with a
  Cloudflare Access application protecting it; `hooks.server.ts` verifies the Access JWT
  and upserts the user into `locals.user`.
- GitHub Action: typecheck, test, migrate, deploy on push to `main`.
- **Done when:** visiting the URL asks you to log in and then shows "0 saved links".
- **Status: ✅ done.** Live at `reader.nelsonfamily.fyi` behind Access. The
  `fetcher` Worker waits for Slice 5, when it's first needed.

> **⏸ Design checkpoint (before Slice 1's UI).** Slice 0 ships an unstyled
> page on purpose. Before building the first real screens (queue cards, save
> form, and after that the feed inbox and library), **stop and talk through
> design**: visual direction, layout and navigation (sidebar vs. tabs, mobile
> first?), typography and density, how to style it (plain CSS / Tailwind /
> component library), and light/dark mode. The server side of Slice 1 can go
> ahead in the meantime; the screens wait until that conversation happens.
>
> **Done:** decisions are in [`docs/design.md`](docs/design.md). In short: light
> editorial look, Fraunces/Literata/Atkinson Hyperlegible, blue-green accent, Tailwind. Saved
> links open the original site behind a preview box; feed posts are read in the app. Actions are
> named **Later** / **Finished**, with swipe in the queue only.

### Slice 1: Save a link by hand
*"Paste a URL, add a note and tags, and see it in my queue."*
- Form: URL, note, tags (comma or chip input).
- Server: canonicalize the URL, fetch the page, use `HTMLRewriter` to get title,
  description, site name, and `og:image`. Upsert the link and its tags.
- Queue view: newest first; each card shows title, site, note, and tags.
- **Done when:** you can save three real articles and see them with their titles filled in.
- **Status:** built and verified against local test pages (the dev sandbox can't reach the
  internet). Metadata comes from a small `<head>` scanner in `packages/core` instead of
  `HTMLRewriter`: HTMLRewriter isn't available in the Node dev server or unit tests. It reads
  only up to `</head>`, so CPU stays low. Queue order is oldest-first by `queued_at`.
  Re-saving an existing link merges the note and tags and moves it to the back of the queue.
  `/save?url=&note=&tags=` prefills the form, ready for Slice 2.

### Slice 2: Capture from anywhere
*"Save from my iPhone and browser without opening the app."*
- `api_tokens` table, and a settings page to create or revoke tokens (shown
  once, stored hashed).
- `POST /api/links` taking `{ url, note?, tags?, reference? }` with
  `Authorization: Bearer <token>`. It returns the saved link, including whether
  it already existed.
- Access setup: a second Access application scoped to
  `reader.nelsonfamily.fyi/api/*` with a **Bypass** policy. The app's own tokens
  handle auth there. (Access service tokens would also work, but our own tokens
  can be revoked one at a time and carry scopes, which agents will need.)
- **iOS Shortcut "Save to Reading List"**, available in the share sheet. Chrome
  on iOS (the main browser) opens the standard iOS share sheet from
  *Share…*, so the Shortcut works the same there as in Safari. Chrome sometimes
  shares the page title as text along with the URL, so the Shortcut accepts
  URLs *and* text and runs *Get URLs from Input* first; the server fills in
  the title either way. Flow: receive from Share Sheet → *Ask for Input* (note, optional) → *Ask for
  Input* (tags, optional) → *Get Contents of URL* (POST JSON with the token
  header) → *Show Notification* with the saved title. A second, no-prompt
  variant does a one-tap save. We'll keep the Shortcut steps written up in
  `docs/ios-shortcut.md` so it can be rebuilt.
- Desktop Chrome: a bookmarklet that `window.open`s a small prefilled save
  page on our domain. It opens a popup instead of injecting a script, so
  sites with strict CSP can't block it. A small unpacked Chrome extension
  (toolbar button + keyboard shortcut) is a possible upgrade later if the
  bookmarklet feels clunky.
- (Every iOS browser, Chrome included, runs on WebKit, which doesn't support
  the Web Share Target API, so a PWA share target is out; the Shortcut covers
  it.)
- **Done when:** sharing from Chrome on your iPhone adds the link, with a note
  and tags, to the queue.

### Slice 3: Queue workflow
*"Actually work through the reading list."*
- Mark as read (→ archived), un-archive, delete, edit note and tags.
- Views: Queue / Archive; filter by tag.
- Keyboard shortcuts (`j`/`k`, `e` archive, `s` star).
- **Done when:** the queue can go from 10 items to 0 in one sitting, and each
  one is still findable afterwards.

### Slice 4: Subscribe to a feed (manual refresh)
*"Add an author and see their recent posts."*
- Paste a site *or* feed URL. If it's HTML, find the feed through
  `<link rel="alternate">`. Create the `feeds` and `subscriptions` rows.
- Parse RSS 2.0 / Atom / JSON Feed in `packages/core` and upsert `feed_entries`.
- A "Refresh" button fetches right away (there's no cron yet).
- Feed inbox: entries from your subscriptions, unread first.
- **Done when:** you subscribe to 3 authors and see their posts.

### Slice 5: Automatic polling
*"New posts show up without me doing anything."*
- `workers/fetcher` with a `*/15 * * * *` cron: select feeds where
  `next_fetch_at <= now` (capped at 40 per tick for the subrequest limit).
- **Fan out one feed per invocation.** The cron handler only picks due feeds
  and calls itself through a service binding (`POST /poll/:feedId`) for each.
  Every call gets its own 10 ms CPU budget, so one huge feed can't sink the
  whole run. It's about 15 lines of code, so we do it from the start rather
  than waiting for a CPU-limit error.
- Budget at 100 feeds: default interval 1 h → ~2,400 fetches/day, and most come
  back 304 with no writes. That's well under every free-tier limit.
- Conditional GET (`If-None-Match` / `If-Modified-Since`); a 304 writes nothing.
- Backoff: more errors → a longer `next_fetch_at`; show broken feeds in the UI.
- Adaptive interval: feeds that rarely post get checked less often.
- Unread counts per feed in the sidebar.
- **Done when:** a new post from a followed author shows up within ~15 min
  and nobody pressed anything.

### Slice 6: Entry → queue / reference
*"This is where the three jobs connect."*
- Actions on an entry: **Save to queue**, **Star as reference**, **Dismiss**, **Mark read**.
- Saving copies the entry into `links` (dedup on `canonical_url`) and opens the
  note/tag editor inline.
- Mark all read (per feed / all).
- **Done when:** you can triage the feed inbox to empty, with keepers in the
  queue or library.

### Slice 7: Reference library and search
*"Find the article I always cite, fast."*
- FTS5 table and triggers; `/search?q=` with ranked results and highlighted
  snippets.
- Library view: starred links, browsable by tag, site/author, and date saved.
- Search syntax: free text plus `tag:x`, `site:y`, `is:ref`, `is:queued`.
- Command palette (`⌘K`) for find-and-copy: pick a result and its URL is on
  your clipboard. This is the "I share it all the time" path.
- **Done when:** you can find and copy a reference link in under 5 seconds
  from anywhere in the app.

### Slice 8: Housekeeping
- OPML import/export (bring existing subscriptions over).
- Retention: a nightly prune of unsaved `feed_entries` older than 30 days.
- Folders/groups for subscriptions.
- Export all links as JSON/CSV (your data is yours).

### Slice 9: Agent access
*"Let an agent save, tag, triage, and search for me."*
- Round out the JSON API that Slice 2 started: `GET /api/search`,
  `GET /api/entries?unread=1`, `PATCH /api/links/:id` (tags, note, status,
  reference), `POST /api/entries/:id/save`. Everything uses the same Bearer
  tokens, with scopes so an agent can get a read-only or a save-only token.
- A remote **MCP server** at `/mcp` on the same Worker. Its tools are thin
  wrappers over those endpoints (`save_link`, `search_links`,
  `list_unread_entries`, `tag_link`, `triage_entry`). Claude and other agents
  can then use it directly, and iOS Shortcuts can keep using the plain API.
- An `actor` column on writes (`user` / `shortcut` / `agent:<token name>`) so you
  can see and undo what an agent did.
- **Done when:** an agent can "go through my unread feeds and queue anything
  about X, tagged X" and you can see exactly what it changed.

### Later / optional slices (pick by appetite)
- **Snapshots:** keep a readable copy of reference articles in R2 so
  link-rot doesn't eat your library. (Readability may need to run off the
  request path because of CPU limits.)
- **Semantic search:** embed title, description, and note with Workers AI and
  store them in Vectorize; "more like this" on any link.
- **Public share pages:** a read-only public URL for a tag or collection
  (e.g. "my favorite articles on testing").
- **Email-in:** forward newsletters to an address and have them show up as
  entries (Email Workers).
- **Digest:** a weekly email of what's still in the queue.

## Repo layout (target)

```
apps/web/            SvelteKit app (UI + /api)
  src/lib/server/    db access, auth hook, capture handlers
  src/routes/        queue, feeds, library, search, settings
workers/fetcher/     cron Worker: poll feeds, write entries
packages/core/       schema, types, canonicalizeUrl, parseFeed, extractMeta — unit-tested, no CF deps
migrations/          numbered SQL migrations (shared by both workers)
```

`packages/core` is pure TypeScript with Vitest tests. Feed parsing and URL
canonicalization are where the subtle bugs live, so they get fixture tests
using real-world feeds.

## Decisions so far

- **Feeds:** dozens to start, 100 at most. A single 15-minute cron with a
  per-feed fan-out is plenty; no queues needed.
- **Mobile:** iOS only, Chrome as the main browser, no native app. Capture through an iOS Shortcut in the
  share sheet, calling a token-authenticated JSON API.
- **Agents:** they'll use the same API with scoped tokens, plus an MCP endpoint
  in Slice 9.
- **Hosting:** a subdomain of your custom domain, protected by Cloudflare
  Access, with a Bypass rule on `/api/*` for token auth.
- **IDs:** ULIDs everywhere, so public share pages stay possible without
  committing to them.
