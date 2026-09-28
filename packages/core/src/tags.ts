const MAX_TAG_LENGTH = 40;
const MAX_TAGS = 20;

/**
 * Normalizes free-form tag input ("Architecture, #reading-list  go") into
 * lowercase, deduplicated tags. Commas, whitespace and leading '#' separate
 * and prefix tags; inside a tag, letters, digits, '-' and '_' are kept.
 */
export function parseTags(input: string | string[] | null | undefined): string[] {
	if (!input) return [];
	const raw = Array.isArray(input) ? input.join(',') : input;
	const tags = raw
		.split(/[\s,]+/)
		.map((t) =>
			t
				.replace(/^#+/, '')
				.toLowerCase()
				.replace(/[^\p{L}\p{N}_-]+/gu, '')
				.slice(0, MAX_TAG_LENGTH)
		)
		.filter(Boolean);
	return [...new Set(tags)].slice(0, MAX_TAGS);
}
