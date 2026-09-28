# Design

Decisions from the design checkpoint (see PLAN.md). The mockups live on the
design canvas: https://claude.ai/artifact/7Njse4bFX6gQ44EokztCxu (private to
the owner). They are the reference for Slice 1 onwards. Where the canvas and
this file disagree, this file wins.

## Direction

Light mode only. Editorial: big images, expressive serif headlines, drop caps,
thin rules, generous whitespace. Built mobile-first (iPhone, Chrome), with a
desktop layout that reads like a front page.

## Type

| Role | Face | Notes |
| --- | --- | --- |
| Headlines, drop caps, pull quotes, wordmark | **Fraunces** (variable) | Use its optical-size axis: `opsz` 72–144 at display sizes, ~36 for list titles. Weight 600, slight negative tracking (-0.01 to -0.02em). `text-wrap: balance`. |
| Body, notes, summaries | **Literata** (variable) | Designed for long-form screen reading. `opsz` matched to size. |
| UI labels, kickers, buttons, metadata | **Atkinson Hyperlegible** | Designed for legibility at small sizes. Kickers: 11–13px, bold, uppercase, +0.1em tracking. |

Self-host the fonts (subset woff2) rather than loading from Google Fonts.

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
| `paper` | `#FBF8F3` | Page background |
| `surface` | `#FFFFFF` | Cards, inputs |
| `sunk` | `#F3EEE5` | Your-note callout |
| `ink` | `#1C1915` | Body text, primary buttons |
| `ink-2` | `#5B5249` | Secondary text (≈7:1) |
| `ink-3` | `#6E655B` | Captions, hints (≈5.3:1) |
| `rule` | `#E6DFD4` | Hairlines, card borders |
| `rule-strong` | `#D8CFC2` | Button and input borders |
| `accent` | `#1E6A73` | Blue-green: kickers, drop caps, links, "Later" (≈5.9:1 on paper) |
| `accent-strong` | `#154E55` | Link hover and pressed |

One accent only. "Finished" uses `ink` and "Later" uses `accent`, so the two
actions differ in lightness as well as hue.

## Implementation

Tailwind (v4) with the tokens above in `@theme`, plus a small hand-written
`reading.css` for article text (`.prose`, drop caps, pull quotes). Don't use
`@tailwindcss/typography`: its defaults fight the reading rules above.

## Interactions

**Vocabulary:** **Later** (keep it in the queue, move on) and **Finished**
(done with it, archived). Star = reference. These words are used everywhere
in the UI, including buttons, swipe hints and shortcuts.

**Mobile queue:** one card at a time.

- Swipe right → Finished, swipe left → Later. The card follows the finger with
  a slight rotation. It commits past ~100px, otherwise it springs back. Hint
  labels fade in as you drag.
- Buttons do the same thing: Later / Read now / Finished (52px tall).
- Undo toast after each swipe.
- Bottom tab bar: Queue / Feeds / Library.

**Reader (feed posts, full text in the app):**

- Full-bleed lead image, kicker, headline, dek, then a byline strip where the
  site name links to the original ("example.com ↗").
- Your saved note in a callout, then the article with a drop cap and pull
  quotes, then an end mark.
- After the article: a "Read the original" button, a **Your notes** box
  (saved with the link, searchable), and **Up next**.
- A sticky bottom bar: Later / Star / Copy link / Finished. Finished or Later
  opens the next item.
- **No swipe in the reader.** Chrome on iOS uses edge-swipe for back, and
  horizontal swipes happen by accident while scrolling or selecting text. You
  move to the next article by reaching the end and choosing.

**Saved links (not feed posts): link out.**

- A preview box built from og:image, site and favicon, og:title,
  og:description and author, captured at save time. Tapping it opens the
  original.
- A prominent "Open on <site> ↗" button, then the note, the notes box, Up
  next, and the same bottom bar.
- We don't extract article text for saved links. If that's wanted later, it
  becomes its own slice.

**Desktop:** a front-page layout. The lead story (big image, 52px headline)
takes 8 of 12 columns and "Up next" takes 4. The top nav has Queue / Feeds /
Library, search (⌘K) and Save a link. Keyboard shortcuts: `E` Finished, `L`
Later, `S` star, `J`/`K` next/previous.

## Implications for the data model

- **Later** needs an ordering key so an item moves to the back of the queue:
  add `queued_at` to `links` (set on save, bumped on Later) and sort the queue
  by it.
- **Finished** = `status = 'archived'` with `read_at` set (already in the
  schema).
- **Notes:** the single `note` column covers both the save-time note and
  notes added later, as one editable text. Split it into timestamped notes
  only if that turns out to be needed.
- **Previews:** `image_url`, `title`, `description`, `site_name` and `author` are
  already on `links`. Add `favicon_url`.
