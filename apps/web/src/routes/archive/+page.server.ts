import { getArchive } from '$lib/server/links';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ locals, url }) => {
	const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
	const archive = await getArchive(locals.db, locals.user.id, PAGE_SIZE, (page - 1) * PAGE_SIZE);
	return { archive, page, pageCount: Math.max(1, Math.ceil(archive.total / PAGE_SIZE)) };
};
