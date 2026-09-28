import { json } from '@sveltejs/kit';
import type { SaveLinkInput } from './links';

/** Every API response has `ok` and a human-readable `message` a Shortcut can show as-is. */
export const apiError = (status: number, message: string) =>
	json({ ok: false, message }, { status });

const optionalText = (value: unknown, field: string): string | undefined => {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') throw new TypeError(`"${field}" must be a string`);
	return value;
};

/**
 * Validates the body of POST /api/links:
 * `{ "url": string, "note"?: string, "tags"?: string | string[] }`.
 * iOS Shortcuts sends empty fields as "", which count as absent.
 */
export function parseSaveLinkBody(body: unknown): SaveLinkInput {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new TypeError('Send a JSON object like {"url": "https://…"}');
	}
	const { url, note, tags } = body as Record<string, unknown>;
	if (typeof url !== 'string' || !url.trim()) throw new TypeError('"url" is required');
	if (tags !== undefined && tags !== null && typeof tags !== 'string') {
		if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
			throw new TypeError('"tags" must be a string or a list of strings');
		}
	}
	return {
		url,
		note: optionalText(note, 'note'),
		tags: (tags ?? undefined) as string | string[] | undefined
	};
}
