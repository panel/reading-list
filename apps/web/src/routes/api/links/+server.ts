import { json } from '@sveltejs/kit';
import { InvalidUrlError } from '@reading-list/core';
import { apiError, parseSaveLinkBody } from '$lib/server/api';
import { saveLink } from '$lib/server/links';
import { hasScope } from '$lib/server/tokens';
import { displayTitle } from '$lib/format';
import type { RequestHandler } from './$types';

/** Save a link. Used by the iOS Shortcut; see docs/ios-shortcut.md. */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.apiToken || !hasScope(locals.apiToken, 'links:write')) {
		return apiError(403, 'This token can’t save links');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'Send a JSON object like {"url": "https://…"}');
	}

	let result;
	try {
		result = await saveLink(locals.db, locals.user.id, parseSaveLinkBody(body));
	} catch (err) {
		if (err instanceof TypeError || err instanceof InvalidUrlError) {
			return apiError(400, err.message);
		}
		throw err;
	}

	const { link, existed } = result;
	const title = displayTitle(link);
	return json(
		{
			ok: true,
			existed,
			message: existed ? `Already saved, moved to the back: ${title}` : `Saved: ${title}`,
			link: {
				id: link.id,
				url: link.url,
				title: link.title,
				siteName: link.siteName,
				note: link.note,
				appUrl: new URL(`/links/${link.id}`, url).toString()
			}
		},
		{ status: existed ? 200 : 201 }
	);
};
