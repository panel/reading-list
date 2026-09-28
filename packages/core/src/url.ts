// Query parameters that only track where a click came from. Dropping them lets
// the same article saved from two places dedupe to one link.
const TRACKING_PARAMS = new Set([
	'fbclid',
	'gclid',
	'dclid',
	'msclkid',
	'mc_cid',
	'mc_eid',
	'igshid',
	'ref',
	'ref_src',
	'ref_url',
	'_hsenc',
	'_hsmi',
	'mkt_tok',
	'yclid',
	'si'
]);

export class InvalidUrlError extends Error {}

/**
 * Parses user input into an http(s) URL, adding https:// when the scheme is
 * missing ("example.com/post").
 */
export function parseHttpUrl(input: string): URL {
	const trimmed = input.trim();
	if (!trimmed) throw new InvalidUrlError('Enter a URL');
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new InvalidUrlError(`Not a valid URL: ${trimmed}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new InvalidUrlError('Only http and https links can be saved');
	}
	if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
		throw new InvalidUrlError(`Not a valid URL: ${trimmed}`);
	}
	return url;
}

/**
 * The form of a URL used to detect duplicates: https, lowercase host without
 * "www.", no fragment, no tracking parameters, remaining parameters sorted,
 * no trailing slash (except the root).
 */
export function canonicalizeUrl(input: string | URL): string {
	const url = typeof input === 'string' ? parseHttpUrl(input) : new URL(input);

	url.protocol = 'https:';
	url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
	url.port = url.port === '443' || url.port === '80' ? '' : url.port;
	url.hash = '';
	url.username = '';
	url.password = '';

	const kept = [...url.searchParams].filter(
		([key]) => !key.toLowerCase().startsWith('utm_') && !TRACKING_PARAMS.has(key.toLowerCase())
	);
	kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	url.search = new URLSearchParams(kept).toString();

	if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');

	return url.toString();
}
