# iOS Shortcut: Save to Reading List

Saves the current page from Chrome (or Safari, or any app with a share sheet)
to your queue, with an optional note and tags.

Before you start:

1. The one-time **Access bypass for `/api`** is set up (see
   [setup.md](setup.md#let-the-api-through-access)).
2. You have a token: open **Settings** in the app, create one named after the
   device (e.g. "iPhone"), and copy it. It's shown only once.

## Build it

In the Shortcuts app, tap **+** to make a new shortcut and name it
**Save to Reading List**. Tap the **ⓘ** (details) button and turn on **Show
in Share Sheet**. Then add these actions in order (search for each by name):

1. **Receive** *URLs*, *Safari web pages* and *Text* **from** *Share Sheet*. If
   there's no input: **Get Clipboard**. (This action appears at the top once
   Share Sheet is on; tap the types to limit them. The clipboard fallback lets
   you run it from the home screen after copying a link.)
2. **Get URLs from** *Shortcut Input*. Chrome sometimes shares the page title
   as text along with the link; this keeps only the link.
3. **Get Item from List**: *First Item* from *URLs*.
4. **Ask for Input**: *Text*, prompt **Note (optional)**. Leave it empty to
   skip.
5. **Ask for Input**: *Text*, prompt **Tags (optional)**, e.g.
   `architecture, reference`.
6. **Get Contents of URL**:
   - URL: `https://reader.nelsonfamily.fyi/api/links`
   - Tap **Show More**. Method: **POST**
   - Headers: add `Authorization` with value `Bearer rl_…` (your token)
   - Request Body: **JSON**, with three **Text** fields:
     - `url` → *Item from List* (from step 3)
     - `note` → *Provided Input* (from step 4)
     - `tags` → *Provided Input* (from step 5)
7. **Get Dictionary Value**: *Value* for key `message` in *Contents of URL*.
8. **Show Notification**: *Dictionary Value*.

The notification says `Saved: <title>`, `Already saved, moved to the back:
<title>`, or what went wrong (`Missing or invalid API token`, `Only http and
https links can be saved`, …). Every response has a `message`, so step 8
always shows something useful.

## One-tap version

Duplicate the shortcut, name it **Save for Later**, and delete steps 4 and 5
(and the `note` and `tags` fields in step 6). It saves with no questions asked.

## Use it

In Chrome, tap **Share** (the square with the arrow, in the address bar
menu), then **Save to Reading List**. If it isn't in the list, scroll to the
end of the app row and choose **Edit Actions** to add it as a favorite.

## API reference

`POST /api/links` with `Authorization: Bearer <token>` and a JSON body:

```json
{ "url": "https://…", "note": "optional", "tags": "comma, or space separated" }
```

`tags` may also be a list of strings. Empty strings count as absent.

| Status | Meaning |
| --- | --- |
| `201` | Saved a new link |
| `200` | Already saved: it was updated (note appended, tags merged, moved to the back of the queue) |
| `400` | Bad input: `message` says what's wrong |
| `401` | Missing, invalid or revoked token |
| `403` | Token doesn't have the `links:write` scope |

Response body:

```json
{
  "ok": true,
  "existed": false,
  "message": "Saved: Choose Boring Technology",
  "link": { "id": "…", "url": "…", "title": "…", "siteName": "…", "note": "…", "appUrl": "https://reader.nelsonfamily.fyi/links/…" }
}
```

Try it from a terminal:

```sh
curl -X POST https://reader.nelsonfamily.fyi/api/links \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"url":"https://example.com","note":"testing","tags":"test"}'
```
