# Design

Decisions from the design checkpoint (see PLAN.md). The mockups live on the
design canvas: https://claude.ai/artifact/7Njse4bFX6gQ44EokztCxu (private to
the owner). They are the reference for Slice 1 onwards. Where the canvas and
this file disagree, this file wins.

## Direction

Light mode only, on a cool paper tinted toward the blue-green accent. Editorial: big images, expressive serif headlines, drop caps,
thin rules, generous whitespace. Built mobile-first (iPhone, Chrome), with a
desktop layout that reads like a front page.

## Type

| Role | Face | Notes |
| --- | --- | --- |
| Headlines, drop caps, pull quotes, wordmark | **Fraunces** (variable) | Use its optical-size axis: `opsz` 72–144 at display sizes, ~36 for list titles. Weight 600, slight negative tracking (-0.01 to -0.02em). `text-wrap: balance`. |
| Body, notes, summaries | **Literata** (variable) | Designed for long-form screen reading. `opsz` matched to size. |
| UI labels, kickers, buttons, metadata | **Atkinson Hyperlegible** | Designed for legibility at small sizes. Kickers: 11–13px, bold, uppercase, +0.1em tracking. |

Self-host the fonts (subset woff2) rather than loading from Google Fonts.

### Letterpress

Headlines, the wordmark, pull quotes, list titles and drop caps get a slight
"pressed into paper" impression: a 1px white highlight below and a faint ink
shadow above.

```css
text-shadow: 0 1px 0 rgb(255 255 255 / 0.85), 0 -1px 0 rgb(21 32 32 / 0.07);
```

Only on display type (roughly 20px and up). Never on body text, where it would
blur small letterforms.

### Reading rules

What the evidence supports, and what is convention:

- **Body size ≥ 18px on mobile, 18–20px on desktop.** Legibility depends on
  x-height; below a critical size reading slows. (Well supported.)
- **Line height 1.55–1.65** for body. WCAG 1.4.12 uses 1.5 as the floor. (Well
  supported.)
- **Left-aligned, ragged right, never justified.** Justification creates
  uneven word gaps that especially hurt dyslexic readers. (Well supported.)
- **High contrast.** Body ink `#1C1915` on paper `#FBF8F3` is about 15:1; every
  text color meets WCAG AA 4.5:1 or better. (Well supported.)
- **Measure.** About 66ch max on desktop and about 38 characters on a phone.
  Typographic convention (45–75ch). The research is mixed: longer lines can
  read faster but are less preferred.
- **Paragraphs separated by space (1em), not indents.** Web convention.
- **`hyphens: auto` on narrow columns** to keep the ragged edge even. `text-wrap: pretty`
  for body.
- **Per-reader settings (the Aa button).** Font family, size and line spacing,
  stored per user. Wallace et al. (2022) found the fastest font differs a lot
  between individuals, so letting people choose beats any single "best" font.
- Not claimed: that serif beats sans on screen, or that off-white reduces
  glare. Those are aesthetic choices here.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `paper` | `#F4F8F7` | Page background, a cool off-white tinted toward the accent |
| `surface` | `#FFFFFF` | Cards, inputs |
| `sunk` | `#E7EFEE` | Your-note callout |
| `ink` | `#152020` | Body text, primary buttons (≈16:1) |
| `ink-2` | `#475756` | Secondary text (≈7:1) |
| `ink-3` | `#5A6B6A` | Captions, hints (≈5.3:1; ≈4.7:1 on `sunk`) |
| `rule` | `#D9E4E3` | Hairlines, card borders |
| `rule-strong` | `#C5D3D2` | Button and input borders |
| `accent` | `#1E6A73` | Blue-green: kickers, drop caps, links, "Later" (≈5.8:1 on paper) |
| `accent-strong` | `#154E55` | Link hover and pressed |

One accent only. "Finished" uses `ink` and "Later" uses `accent`, so the two
actions differ in lightness as well as hue.

## Implementation

Tailwind (v4) with the tokens above in `@theme`, plus a small hand-written
`reading.css` for article text (`.prose`, drop caps, pull quotes). Don't use
`@tailwindcss/typography`: its defaults fight the reading rules above.

## Interactions

**Vocabulary:** **Done** (finished with it: a post is dismissed, a shared link
is archived) and **☆ Star** (keep it as a reference). Leaving something unread
means "later"; there is no separate queue. These words are used everywhere in
the UI, including buttons, swipe hints and shortcuts.

**Inbox** (Slice 10): links you share in and posts from your feeds, in one list.

- Chips: All / **Shared** (links you've sent in) / folders / each feed.
- Unread first, then newest first. A shared link counts as unread until it's
  Done, and is dated by when it was (last) shared.
- Swipe a row left → **Done**, right → **☆ Star**, for posts and shared links
  alike. The row follows the finger, commits past ~90px, otherwise springs back.
  Hint labels fade in as you drag. Undo toast after Done. On desktop, ☆ / Done
  buttons appear on hover.
- "Mark all posts read" at the end of the list (all feeds, or the filtered
  one). It never touches shared links.
- Bottom tab bar: Inbox / Library / Save / Archive / Settings.

**Reader (feed posts, full text in the app):**

- Full-bleed lead image, kicker, headline, dek, then a byline strip where the
  site name links to the original ("example.com ↗").
- Your saved note in a callout, then the article with a drop cap and pull
  quotes, then an end mark.
- After the article: a "Read the original" button, a **Your notes** box
  (saved with the link, searchable), and **Up next**.
- A sticky bottom bar: ☆ / Copy link / Next →. Next opens the top of the
  inbox, whether that's a post or a shared link.
- ☆ opens a note-and-tags editor after the article, so a reference can say
  why it's worth keeping. Once starred, the note shows there with Edit.
- A shared link that is also a post in a feed you follow reads the same way,
  on its link page: header, your note, the article, then Done.
- **No swipe in the reader.** Chrome on iOS uses edge-swipe for back, and
  horizontal swipes happen by accident while scrolling or selecting text. You
  move to the next article by reaching the end and choosing.

Keys in the post reader: `S` star, `J`/`E` next, `O` original.

**Search, Library and the palette:**

- `/search`: search boxes take free text plus `tag:`, `site:`, `is:ref|queued|archived`,
  "phrases" and `-word`. Matches are highlighted, and each result has a copy-link button.
- **Library**: starred references, newest star first, browsable by tag and site.
- **⌘K** (or `/`) anywhere: find a link, `↵` copies its URL, `⌘↵` opens it.
  On mobile, the search icon in the header opens `/search`.

**Saved links: read in the app when there's a copy (Slice 11), else link out.**

- With a readable copy (or a matching post from a feed you follow): the same
  layout as the post reader: kicker, headline, byline strip, a small status
  line ("Saved copy · today · kept until Oct 14 (star it to keep it)"), your
  note, the article, "Read the original".
- Without one: a preview box built from og:image, site and favicon, og:title,
  og:description and author, captured at save time. Tapping it opens the
  original. The status line says "Saving a readable copy…" (the page checks
  back by itself), or why it failed with "Try again", or that it was cleared
  14 days after Done, with "Make a readable copy".
- A prominent "Open on <site> ↗" button, then the note, the notes box, Up
  next, and a bottom bar: ☆ / Copy link / **Done**. Done archives the link and
  opens the top of the inbox. Keys: `E` done, `S` star, `J` next, `O` open.
- Copies keep text and structure; images still load from the original site.

**Desktop:** the inbox is a single centered column. The top nav has Inbox
(with the unread count) / Library / Archive / Settings, search (⌘K) and Save a
link.

## Implications for the data model

- A **shared link** is `status = 'queued'`; `queued_at` (set when shared,
  bumped when shared again) dates it in the inbox.
- **Done** on a shared link = `status = 'archived'` with `read_at` set.
- **Notes:** the single `note` column covers both the save-time note and
  notes added later, as one editable text. Split it into timestamped notes
  only if that turns out to be needed.
- **Previews:** `image_url`, `title`, `description`, `site_name` and `author` are
  already on `links`. Add `favicon_url`.
