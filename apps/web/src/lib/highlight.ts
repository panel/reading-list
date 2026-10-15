/**
 * Highlights in the readers: turning a selection into the text we save (list
 * items keep their bullets or numbers, one per line), and finding a saved
 * highlight in the article again to mark it.
 */

/** What a walk over the selected part of an article yields, in order. */
export type Piece =
	| { kind: 'text'; text: string }
	/** The start of a block (paragraph, heading, list item…), which begins a new line. */
	| { kind: 'block'; marker?: string };

/**
 * Joins a selection's pieces into lines: one per block, list items with their
 * marker. Part of a single block is just its text, without a marker.
 */
export function joinPieces(pieces: Piece[]): string {
	const lines: { text: string; marker: string }[] = [];
	let line = '';
	let marker = '';
	const end = () => {
		const text = line.replace(/\s+/g, ' ').trim();
		if (text) lines.push({ text, marker });
		line = '';
		marker = '';
	};
	for (const piece of pieces) {
		if (piece.kind === 'block') {
			end();
			marker = piece.marker ?? '';
		} else {
			line += piece.text;
		}
	}
	end();
	if (lines.length === 1) return lines[0].text;
	return lines.map(({ text, marker }) => (marker ? `${marker} ${text}` : text)).join('\n');
}

/** A list item's marker as it reads on the page: "•", or "3." in a numbered list. */
export function listMarker(ordered: boolean, start: number, index: number, reversed = false) {
	return ordered ? `${reversed ? start - index : start + index}.` : '•';
}

/** The marker we put before a list item when saving, taken off again to find it. */
const MARKER = /^(?:•|\d+\.)\s+/;

/**
 * Collapses whitespace in `text` and keeps, for each character of the result,
 * where it came from, so a match in the tidy text maps back to the original.
 */
export function normalize(text: string): { text: string; map: number[] } {
	let out = '';
	const map: number[] = [];
	let space = true; // drop leading whitespace
	for (let i = 0; i < text.length; i++) {
		if (/\s/.test(text[i])) {
			if (space) continue;
			space = true;
			out += ' ';
		} else {
			space = false;
			out += text[i];
		}
		map.push(i);
	}
	return { text: out, map };
}

/**
 * Where a saved highlight is in the article's text, searching from `from` (the
 * start of the block it began in): from the start of its first line to the end
 * of its last. Its lines are searched for in order, so the blocks between them
 * (and the list markers we added) don't have to match exactly. Null if it
 * isn't there any more.
 */
export function locate(article: string, quote: string, from = 0): [number, number] | null {
	const lines = quote
		.split('\n')
		.map((line) => normalize(line.replace(MARKER, '')).text.trim())
		.filter(Boolean);
	if (!lines.length) return null;
	const { text, map } = normalize(article);
	const start = Math.max(
		0,
		map.findIndex((i) => i >= from)
	);
	const find = (at: number) => {
		const first = text.indexOf(lines[0], at);
		if (first === -1) return null;
		let end = first + lines[0].length;
		for (const line of lines.slice(1)) {
			const next = text.indexOf(line, end);
			if (next === -1) return null;
			end = next + line.length;
		}
		return [first, end] as const;
	};
	// From its block first; anywhere, if the article has changed since.
	const found = find(start) ?? (start > 0 ? find(0) : null);
	if (!found) return null;
	const [first, end] = found;
	return [map[first], map[end - 1] + 1];
}

/** "Oct 15 · 9:41 AM", or "today · 9:41 AM". */
export function savedAt(date: Date, day: string) {
	return `${day} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
