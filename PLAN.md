# Reading List — Plan

A personal RSS reader, read-later queue, and reference library in one app,
running on Cloudflare's free tier.

## The three jobs

| Job | What happens | Main view |
| --- | --- | --- |
| **Follow** | New posts from authors I subscribe to show up automatically | Inbox |
| **Save** | I send a link (with an optional note and tags) from anywhere to read later | Inbox (the Shared feed) |
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
- **Status: ✅ done.** Live and checked on the real site. Built and verified against local test pages (the dev sandbox can't reach the
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
- **Status: ✅ done.** Working from the iPhone share sheet. The bookmarklet was dropped (not needed). Tokens are stored
  as SHA-256 hashes with a `links:write` scope. `last_used_at` refreshes at most
  hourly to save D1 writes. The Shortcut steps are in `docs/ios-shortcut.md`,
  and the Access bypass in `docs/setup.md` step 4.

### Slice 3: Queue workflow
*"Actually work through the reading list."*
- Mark as read (→ archived), un-archive, delete, edit note and tags.
- Views: Queue / Archive; filter by tag.
- Keyboard shortcuts (`j`/`k`, `e` archive, `s` star).
- **Done when:** the queue can go from 10 items to 0 in one sitting, and each
  one is still findable afterwards.
- **Status:** built. Swipe (right = Finished, left = Later) on the mobile card,
  with Later / Read now / Finished buttons as well. Undo toast restores the exact
  previous queue position. The saved-link page has a Later / Star / Copy link /
  Finished bar that moves on to the next item, plus note editing (replace), a
  "Your notes" box (append), tags, and delete. There's an Archive page with
  Requeue. Keyboard: `E`/`L`/`S`/`O` on the queue, plus `J`/`K` on a link.
  Migration 0003 adds `starred_at`.

### Slice 4: Subscribe to a feed (manual refresh)
*"Add an author and see their recent posts."*
- Paste a site *or* feed URL. If it's HTML, find the feed through
  `<link rel="alternate">`. Create the `feeds` and `subscriptions` rows.
- Parse RSS 2.0 / Atom / JSON Feed in `packages/core` and upsert `feed_entries`.
- A "Refresh" button fetches right away (there's no cron yet).
- Feed inbox: entries from your subscriptions, unread first.
- **Done when:** you subscribe to 3 authors and see their posts.
- **Status:** built. The parser (`packages/core/src/feeds`) handles RSS 2.0, RSS 1.0/RDF,
  Atom and JSON Feed, with fixture tests. Discovery goes: feed URL → the page's advertised
  `<link rel=alternate>` → common paths (`/feed`, `/rss.xml`, …), and falls back to
  http when you type no scheme and https fails. Refreshes use conditional GET and back
  off on errors. Posts are read in-app: the HTML is sanitized server-side (an
  allowlist via `xss`, and only http(s) URLs) and the whole app now sends a strict
  CSP. Opening a post marks it read, via a POST from the page, so hover-preloading
  doesn't count. Up to 50 entries per fetch; content capped at 400 KB.
  Migration 0004 adds `feeds`, `subscriptions`, `feed_entries` and `entry_state`.
  **Watch:** parsing a very large feed may exceed the Workers Free 10 ms CPU limit;
  slice 5's one-feed-per-invocation design exists for exactly this.

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
- **Status:** built. `workers/fetcher` runs on a `*/15` cron. It selects up to 40 due
  feeds that have at least one subscriber and dispatches each to `/poll/:id` on
  itself via the `SELF` service binding (no public routes). Check interval: every
  30 min if the feed posted in the last day, 1 h within a week, 3 h within a month,
  6 h otherwise. Errors back off exponentially up to 24 h. Unread count shows in the
  nav (last 60 days), and the Feeds page flags feeds failing 3+ times. Tested locally
  by driving the Worker's `scheduled()`/`fetch()` against the local D1: new posts were
  picked up, intervals adapted, unchanged feeds returned 304, and a second tick found
  nothing due.

### Slice 6: Entry → queue / reference
*"This is where the three jobs connect."*
- Actions on an entry: **Save to queue**, **Star as reference**, **Dismiss**, **Mark read**.
- Saving copies the entry into `links` (dedup on `canonical_url`) and opens the
  note/tag editor inline.
- Mark all read (per feed / all).
- **Done when:** you can triage the feed inbox to empty, with keepers in the
  queue or library.
- **Status:** built. A saved post becomes a link with `source = 'feed'` and
  `source_entry_id` (migration 0005 indexes it). It dedupes against links saved by
  hand with the same canonical URL. Later = queue; Star = reference, archived and
  not queued; Dismiss hides the post, with Undo. Undo notices are now generic (a form
  action plus fields). Known gap: the inbox list marks a post "In queue" only when
  it was saved from the feed; the reader also recognizes links saved by hand.

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
- **Status:** built. Migration 0006 (hand-written) adds the FTS5 table `links_fts` (porter +
  unicode61, sharing rowids with `links`) with triggers on `links` and `link_tags`, and backfills
  existing links. The query syntax is parsed in `packages/core/src/search.ts`: words match as
  prefixes, "phrases" match exactly, `-word` excludes, plus `tag:`/`#tag`, `site:` and
  `is:ref|queued|archived`. Ranking uses bm25 with the title and tags weighted highest. Snippet
  highlights use control-character markers that the UI renders as `<mark>` without parsing
  HTML. The Library is search scoped to `is:ref`, with tag and site facets. The ⌘K / `/`
  palette copies with Enter and opens with ⌘Enter, and never acts on results from a previous
  query. On mobile, Library replaces Archive in the tab bar; Archive is linked from the
  Library. Note: `wrangler d1 export` can't export virtual tables such as `links_fts`; the
  index can be rebuilt from `links`.

### Slice 8: Housekeeping
- OPML import/export (bring existing subscriptions over).
- Retention: a nightly prune of unsaved `feed_entries` older than 30 days.
- Folders/groups for subscriptions.
- Export all links as JSON/CSV (your data is yours).
- **Status:** built.
  - OPML import (Manage feeds): creates shared feed rows as due now and subscriptions with
    their folders; the fetcher fills them in, since fetching 100 feeds in one request would
    exceed the request limits. Re-importing is a no-op.
  - Folders (migration 0007 `subscriptions.folder`) group the Manage list and add folder
    chips to the inbox; Mark all read respects the folder.
  - Exports at `/export/links.json`, `/export/links.csv` (quoted, formula-safe) and
    `/export/feeds.opml`, all linked from Settings → Your data.
  - A nightly prune (fetcher cron `47 3 * * *`) removes unsaved posts that are older than
    30 days *and* beyond their feed's newest 50, so they can't come back as unread, plus
    feeds nobody follows. Checked against the local D1 with synthetic data.

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
- **Status:** built. Details and client setup are in `docs/agents.md`.
  - Token scopes `links:read`, `links:write`, `feeds:read`, `feeds:write`. Settings offers
    three presets: iPhone Shortcut (save only), Read-only agent, and Agent (everything).
  - REST: `GET /api/links?q=` (search, or the queue), `GET`/`PATCH /api/links/:id`,
    `GET /api/feeds`, `GET /api/entries`, `GET /api/entries/:id` (with text), and
    `POST /api/entries/:id {action}` (later/star/dismiss/read/unread). Search lives on
    `/api/links?q=` rather than a separate `/api/search`.
  - MCP at `/api/mcp` (under `/api` so the existing Access bypass covers it): stateless
    Streamable HTTP with JSON responses and nine tools over the same operations
    (`lib/server/agent.ts`). The claude.ai web connectors need OAuth, which isn't built;
    Claude Code, Claude Desktop and scripts work with the Bearer header.
  - Instead of an `actor` column on every table, an `activity` log (migration 0008)
    records each token write with the token name, a summary and an undo recipe. Settings
    → Agent activity lists them with Undo (new saves are deleted; edits and triage
    restore the previous snapshot).
  - Checked end to end on the dev server: scope refusals (403 over REST, `isError` over
    MCP), MCP initialize/notifications/tools, and undo of a triage and of an edit.

### Slice 10: One inbox (Shared is a feed)
*"Links I share in and posts from blogs I follow are the same kind of thing: something to read at some point."*
- Two jobs, not three views: **read at some point** (the Inbox) and **reference forever**
  (starring, into the Library). Sending a link in is like a new post arriving; starring is
  what you do after reading, whether it came from a feed or was shared in.
- The Queue and Feeds tabs merge into one **Inbox** at `/`. Its chips are All, **Shared**
  (the links you've sent in), then folders and feeds. All mixes shared links with unread
  posts, newest first, unread first; a shared link's date is when it was (last) shared.
- One gesture set for every row: swipe left is **Done** (a post is dismissed; a shared link
  is archived, with Undo), swipe right is **☆ Star**. Later and the one-card queue view are
  gone: leaving something unread already means "later".
- Readers: Next (and Done on a shared link) goes to the top of the inbox, post or link.
  Posts read in the app as before; shared links keep their preview page.
- The nav badge counts unread posts plus shared links. `/feeds` redirects to `/`.
  Mobile tabs: Inbox / Library / Save / Archive / Settings.
- **Status:** built. No schema change: a shared link is a `links` row with
  `status = 'queued'`, and the inbox merges those with unread entries in
  `lib/server/inbox.ts`. Migration 0009 (data only) turns posts that had been queued from
  their feed back into unread posts and drops the queue copy, unless it held a star, note
  or tags (then it's archived); a queued link whose post was already pruned stays in
  Shared. The API and MCP keep their shapes: `list_queue` and an empty search return
  Shared (now newest first), and `triage_entry` `later` adds a post to Shared.
  Also: paragraph spacing in the reader now applies inside the wrapper `<div>` many
  feeds put around a post.
- **Follow-up:** a shared link that is also a post in a feed you follow (saved from it, or
  the same URL) reads in the app on its link page, with its note and Done bar, and opening
  it marks the post read. Migration 0010 indexes `feed_entries.url` for that lookup.
  Starring from either reader opens the note-and-tags editor; once starred, the post
  reader shows your note with an Edit button.

### Follow feeds from agents; a new feed's backlog starts out read
- `POST /api/feeds {url, folder?}` and the MCP tool `add_feed` (scope `feeds:write`) follow a
  site or feed URL the same way Manage feeds does. Each new follow goes in the activity log,
  and Undo unfollows.
- Following a feed marks the posts it already has as read (`markBacklogRead` in
  `packages/core`), so only posts published from then on land in the inbox. This covers
  Manage feeds, the API, MCP and OPML import. Feeds that are new to the app when imported
  from OPML get the same treatment on their first successful fetch. Posts you had already
  opened, starred or dismissed keep their state.

### Slice 11: Readable copies of saved links
*"Read saved links in the app, and keep the ones I star even if the site goes away."*
- Every link in the inbox and every starred link gets a **readable copy**: the article
  pulled out of the page, shown on the link page in the same reader as feed posts, with
  "Read the original" at the end.
- **Retention:** copies are kept while the link is in the inbox or starred. Done and not
  starred: kept for 14 days from Done (unstarring a finished link also starts 14 days),
  then deleted by the nightly prune. The link, note and tags stay; the page offers
  "Make a readable copy" again.
- **Search:** a starred link's article text is in the search index, so the library is
  searchable by what articles say. Other copies aren't indexed.
- Images stay links to the original site for now.
- **Status:** built.
  - Extractor (`packages/core/src/article.ts`): a small pure-TypeScript HTML parser plus
    Readability-style scoring (paragraph text scores its containers; link-heavy clutter,
    menus, share bars, comments and hidden elements are dropped), emitting a small set of
    tags with absolute URLs, lazy images resolved. It runs in Workers, the dev server and
    tests alike (HTMLRewriter doesn't run in the last two). Pages with one `<article>` or a
    `<main>` parse only that part: about 1 ms for a 500 KB page. A page without either
    that is 500 KB of dense markup takes about 30 ms, over Workers Free's 10 ms; if a real
    one hits the limit, its capture times out, is retried twice, then shows as failed.
    **Watch:** failure rates on real sites; the fallback plan is Workers Paid
    (Readability) or Browser Rendering.
  - Capture (`packages/core/src/archive.ts`): a feed post's full text when a feed has it
    (no fetch), else the page; under 100 words counts as no article (a short feed post is
    used rather than nothing). 404s, non-HTML and "no article" fail at once; timeouts and
    5xx retry up to 3 times, an hour apart.
  - Migration 0011: `link_archives` (one row per link needing a copy). Triggers on `links`
    create rows and set `keep_until`, so every path (UI, API, agents, undo) follows the
    same rules; existing inbox and starred links were queued for capture. The FTS table
    was rebuilt with a `body` column, filled by triggers for starred links only.
  - The fetcher claims copies (5 per run) and captures each in its own invocation via
    `SELF`, from the 15-minute cron and from `POST /archive/kick`, which the web app calls
    through a new `FETCHER` service binding after every write (in dev, the web app
    captures inline). The 03:47 prune deletes expired copies.
  - `get_link` (MCP) and `GET /api/links/:id` return the copy's text.

### Slice 12: Prioritize, predict and categorize the inbox
*"Show me what I'm likely to read first, flag what I'll want to keep, and group it by what it's about."*

Volume is under a dozen new items a day, so this is less about sorting a firehose than
about two hints per item: **will I read it**, and **will I keep it** (star it into the
Library), plus a **category** (Work, Music, Local, …) to filter by. It leans on the
models Cloudflare hosts on Workers AI rather than a frontier API: a *decision model* for
the per-item judgments and a small *text model* for the occasional job of proposing
categories.

**Models**
- **Decision model: Clef-flash** (`@cf/cloudflare/clef-flash`, 9B, open weights,
  ~40 ms). Like TypeSafe's Jev, whose API it matches, it reads an input state and typed
  questions (`noul` yes/no, `choice` one of up to 255 options, `score`) and returns a
  probability for every answer instead of generating text. One call per item answers
  all three questions. Clef (27B) or Jev (through AI Gateway, `typesafe/jev`) can score
  the same items later for comparison; the predictions table records which model said
  what.
- **Text model** (a Workers AI instruct model, chosen at build time) only for
  "Suggest categories" in Settings: one on-demand call that writes names and
  descriptions.
- It has no memory of its own: personalization is what goes into the state. Each
  call gets the item (title, source, author, words, the first ~1,000 words of its
  text) plus the user: recent starred titles, recent opened and skipped titles,
  open and star rates per feed and per category, and recent category corrections as
  examples.

**Budget**
- Workers AI gives 10,000 neurons a day free on any plan; on Workers Free, calls past
  that fail rather than bill. Estimated use: ~12 items × ~3k tokens ≈ 36k tokens a day,
  ~300 neurons with Clef-flash (≈3% of the allowance).
- On top of that, an app-side **daily cap** (default 2,000 neurons, a Worker variable
  rather than a setting) kept in D1: every model call is estimated before it's made and
  recorded after, and nothing is called once the day's cap is spent. Background scoring,
  the Library backfill and Suggest categories all share it. The app doesn't show usage;
  the Cloudflare dashboard does.
- Anything unscored falls back to today's order (newest first, unread first), so a
  spent cap or a failed call never breaks the inbox.

**12a: Signals that mean what they say**
- Today `entry_state.read_at` is set by opening a post, but also by Done (dismiss),
  Mark all read and a new feed's backlog, and `links.read_at` is set by Done whether or
  not the link was opened. Add **`opened_at`** to both, set only when the reader (post
  or link page) actually opens the item, through the same POST-from-the-page that
  marks a post read (so hover preloading doesn't count). Agents marking things read
  don't count as opening.
- **Citing:** copying a link's URL (⌘K palette, Copy link) records `cited_at` and a
  `cite_count` on the link: the strongest "reference" signal there is.
- **History that survives the prune:** the nightly prune deletes old posts and their
  read state with them, so skipped posts would vanish and only kept ones remain.
  Before deleting, copy each user's state for those posts (feed, title, author,
  published, opened/read/dismissed) into **`entry_history`**.
- Outcomes per item: *opened*, *skipped* (Done without opening), *starred*, *cited*.
  Backlog marked read when following a feed isn't an outcome.
- **Visible right away:** Manage feeds shows each feed's open rate over the last 90
  days, which is also how we check the data before trusting a model with it.
- **Status (12a): built.** Migration 0012 adds `opened_at` and `cited_at` to
  `entry_state`, `opened_at`, `cited_at` and `cite_count` to `links`, and the
  `entry_history` table. It backfills `opened_at` for posts read so far, leaving out
  reads that came with Done (same moment) or a backlog (within a minute of the post
  arriving or the feed being followed); links have no history to backfill. The post
  reader posts `opened` with its read; the link page posts `?/opened` (not on the page
  you land on right after saving) and marks its feed post opened too. Mark read, agents
  and `keepEntry` still only set `read_at`. Copy link (both readers) and the palette post
  `?/cite` (`$lib/signals.ts`). The prune copies opened, cited or dismissed state into
  `entry_history` before deleting. Manage feeds shows "opened N of M in 90 days"
  (`feedOpenRates`). Checked on the local D1: backfill, the actions, the readers and
  palette in Chromium, and the prune through the fetcher's scheduled handler.

**12b: Daily cap and Workers AI plumbing**
- An `ai_usage` table (user, day, neurons, calls) and a helper that refuses a call
  that would exceed the day's cap. No usage UI (see the Cloudflare dashboard).
- `AI` binding on the fetcher (and the web app, for Suggest categories); in dev and
  tests the model is a stub.
- **Status (12b): built.** `packages/core/src/ai`: `decide()` sends `{ model, state,
  questions }` to `env.AI.run('@cf/cloudflare/clef-flash', …)`, questions keyed by id
  with `type` and `instructions`, a choice's options in `criteria`. `parseAnswers`
  accepts the response shapes sources disagree on (a yes/no as a bare number or
  `{ noul }`; choice probabilities nested or not; a REST `result` wrapper) and drops
  what it can't read. **Verify against a live response in 12c** (log the first one).
  `validateQuestions` enforces the API's limits before anything is spent: 1–64
  questions, ids of `[A-Za-z0-9_.-]` up to 100 characters, 2–255 options per choice
  (so category ids in 12d must be slugs). Costs are estimated from the request size
  (~4 characters a token) at the published neuron rates; `reserveNeurons` adds them to
  today's `ai_usage` row in one conditional upsert and refuses past the cap, and
  `settleNeurons` corrects it from the response's `usage` when present (both checked on
  the local D1). **For 12c:** the first call to a cold model can take close to a minute,
  so model calls run in the fetcher, each item in its own invocation, never on a page
  request. Migration 0013 adds `ai_usage`. The
  fetcher binds `AI` with `AI_DAILY_NEURONS = 2000`; nothing calls it yet. Workers AI
  bindings are always remote, so `wrangler dev` for the fetcher now needs
  `wrangler login` (docs/setup.md).

**12c: Score every item**
- A `predictions` table: item (post or link), model, `p_open`, `p_keep`, category
  probabilities, tokens/neurons, created_at. Kept after the item is pruned (no FK), so
  calibration can be measured against outcomes.
- The fetcher's cron scores new posts and shared links that have no prediction yet, a
  few per run, under the daily cap.
- The API and MCP expose the scores and category. *(Later: with 12e, when there's
  something worth reading from them.)*
- **Status (12c): built** (open and keep; categories come with 12d). Migration 0014
  adds `predictions`. Each 15-minute tick the fetcher picks up to 3 candidates
  (`scoreCandidates`): unread, undismissed posts from the last 7 days and Shared links
  whose readable copy is in (or that are over an hour old), newest first, that have
  no Clef-flash prediction or whose failed one is due a retry (an hour × attempts, at
  most 3). Each goes to `POST /score/:kind/:user/:item` on the fetcher through `SELF`.
  `scoreItem` builds the state (`formatState`: feeds' open rates, the last 15 starred,
  opened and skipped titles, then the item with its first 1,000 words), reserves the
  estimate, calls the model, settles from the reported usage, and upserts the
  prediction; a failed call gives its reservation back and records the error. Every
  answer is logged with the raw reply (first 2,000 characters) until the answer format
  is confirmed. `feedOpenRates` moved to `packages/core` (the web app and the fetcher
  both use it). Checked end to end on the local D1 with `AI_STUB`: items scored once
  each, usage settled, a call refused at the cap and retried the next day, a missing
  item reported as gone.

**12d: Categories**
- User-defined categories in Settings: a name and a one-line description that the
  decision model uses as the rule (e.g. *Local: news and events in …*). Plus an
  implicit *Other*.
- **Suggest categories:** samples what's in the app (feed names and folders, ~150
  recent titles with first lines, starred titles weighted up, existing tags) and asks
  the text model for 5–12 categories as JSON, each with a description and example
  titles. Then **Check**: Clef-flash classifies the same sample with the draft, showing
  how many land in each category, how many end up in Other or unsure, and which pairs
  it confuses. The user renames, merges, deletes or edits, then **Accepts**. Nothing
  changes until then. Run again later, it proposes changes (splits, merges,
  additions) from Other and from corrections instead of starting over.
- An item can have more than one category: the top one, plus any above ~0.35.
- Inbox chips for categories next to folders (folders group feeds; categories group
  posts). Tapping an item's category corrects it; corrections are stored and recent
  ones go into the state as examples.
- Optional one-time **Library backfill** (~500 links ≈ 1M tokens ≈ 8k neurons), spread
  over nights by the daily cap.

**12e: Use the scores**
- An inbox order **Likely reads**: `p_open` with a freshness decay, next to Newest.
  Each row can say why ("you open most posts from this feed", "close to your Library").
- A **Library candidate** mark on items with a high `p_keep`, and a nudge to star after
  reading one.
- Only turned on once a few weeks of predictions line up with what was actually opened
  and starred (checked from `predictions` against outcomes).
- **Watch:** position bias (things at the top get opened because they're at the top)
  and the feedback loop (a feed that sinks is never opened, so it sinks further). Keep
  Newest one tap away, and keep the freshness term.

**Open choices:** which Workers AI text model for Suggest categories; whether to run
the Library backfill; whether Clef (27B) earns its ~2.7× cost over Clef-flash.
**Later:** Cloudflare's RL fine-tuning for Clef, trained on `predictions` against
outcomes and on category corrections, once it's self-serve.

### Later / optional slices (pick by appetite)
- **Snapshot images:** copy starred links' images to R2 so dead images don't break
  the library (Slice 11 keeps text only).
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
