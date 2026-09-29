# Agents

AI agents (Claude Code, Claude Desktop, scripts) can search your links, save
and edit them, and read and triage feed posts. They use the same `/api` as
the iOS Shortcut: a Bearer token, through the Access bypass for `/api` (see
[setup.md](setup.md#let-the-api-through-access)).

Every change an agent makes is logged under **Settings → Agent activity**,
with an **Undo** button.

## Make a token

In **Settings → API tokens**, name the token after the agent (e.g. "Claude
Code") and choose what it may do:

| Choice | Scopes | For |
| --- | --- | --- |
| iPhone Shortcut | `links:write` | Saving links only |
| Read-only agent | `links:read feeds:read` | Searching and reading. Can't change anything |
| Agent | all four | Reading, saving, editing notes and tags, finishing, starring, triaging posts |

A request without the scope it needs gets `403` and says which scope is
missing. Revoke the token to cut an agent off.

## MCP

The app is an MCP server at `https://reader.nelsonfamily.fyi/api/mcp`
(Streamable HTTP, stateless, JSON responses).

**Claude Code:**

```sh
claude mcp add --transport http reading-list https://reader.nelsonfamily.fyi/api/mcp \
  --header "Authorization: Bearer rl_…"
```

**Claude Desktop** and other clients that take a JSON config:

```json
{
  "mcpServers": {
    "reading-list": {
      "type": "http",
      "url": "https://reader.nelsonfamily.fyi/api/mcp",
      "headers": { "Authorization": "Bearer rl_…" }
    }
  }
}
```

Custom connectors added in the claude.ai web or mobile apps expect OAuth
instead of a fixed header, so they won't connect to this server as it is.
Adding OAuth would be its own piece of work.

### Tools

| Tool | Scope | Does |
| --- | --- | --- |
| `search_links` | `links:read` | Search with the app's syntax: words, `"phrases"`, `-word`, `tag:`, `site:`, `is:ref\|queued\|archived` |
| `list_queue` | `links:read` | Shared links still to read (the inbox's Shared feed), newest first |
| `get_link` | `links:read` | One link with note and tags |
| `save_link` | `links:write` | Save a URL with a note and tags. Saving one that already exists merges the note and tags |
| `update_link` | `links:write` | Replace or append to the note, replace tags, set `status` (`queued`/`archived`), star or unstar |
| `list_feeds` | `feeds:read` | Followed feeds with unread counts |
| `list_unread_entries` | `feeds:read` | Posts, newest first, optionally for one feed |
| `read_entry` | `feeds:read` | A post's text (up to 30,000 characters) |
| `triage_entry` | `feeds:write` | `later` (add the post to Shared), `star`, `dismiss`, `read`, `unread` |

Post text comes from third-party sites. The server tells the agent to treat
it as content, not instructions, but only give the `Agent` choice to agents
you'd trust with your inbox. Undo is there if one misbehaves.

## REST

Same operations, same token. Every response is JSON with `ok` and, on
errors, `message`.

| Request | Scope | Body / query |
| --- | --- | --- |
| `GET /api/links?q=…&limit=…` | `links:read` | Search. An empty `q` returns the shared links still to read |
| `POST /api/links` | `links:write` | `{url, note?, tags?}`. `201` new, `200` already saved |
| `GET /api/links/:id` | `links:read` | |
| `PATCH /api/links/:id` | `links:write` | `{note?, appendNote?, tags?, status?: "queued"\|"archived", reference?: boolean}` |
| `GET /api/feeds` | `feeds:read` | |
| `GET /api/entries?unread=true&feed=…&limit=…` | `feeds:read` | |
| `GET /api/entries/:id` | `feeds:read` | Includes `text` |
| `POST /api/entries/:id` | `feeds:write` | `{action: "later"\|"star"\|"dismiss"\|"read"\|"unread"}` |

`tags` is a list of strings or a comma/space separated string. Limits are
capped at 100.

```sh
TOKEN=rl_…
curl -H "Authorization: Bearer $TOKEN" "https://reader.nelsonfamily.fyi/api/links?q=tag:sqlite"
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"appendNote":"Cited in the design doc","reference":true}' \
  https://reader.nelsonfamily.fyi/api/links/01J…
```

| Status | Meaning |
| --- | --- |
| `400` | Bad input: `message` says what's wrong |
| `401` | Missing, invalid or revoked token |
| `403` | The token lacks the scope (`message` names it) |
| `404` | No such link or post |

## Undo

Each logged change stores what it replaced. Undo in Settings restores it:
a new save is deleted, an edit restores the note, tags, status and star as
they were, and a triaged post gets its read, dismissed and saved state back.
If you've changed the item yourself since, undo still puts back the agent's
"before", so check the item afterwards.
