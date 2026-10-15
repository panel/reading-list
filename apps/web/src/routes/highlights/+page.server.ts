import { countHighlights, listHighlights } from '@reading-list/core';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 100;

export const load: PageServerLoad = async ({ locals, url }) => {
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const [rows, total] = await Promise.all([
		listHighlights(locals.db, locals.user.id, PAGE_SIZE, (page - 1) * PAGE_SIZE),
		countHighlights(locals.db, locals.user.id)
	]);
	return {
		highlights: rows.map(({ id, itemKind, itemId, text, note, title, url, createdAt }) => ({
			id,
			itemKind,
			itemId,
			text,
			note,
			title,
			url,
			createdAt
		})),
		total,
		page,
		pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE))
	};
};
