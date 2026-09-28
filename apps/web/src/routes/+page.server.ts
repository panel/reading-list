import { getQueue } from '$lib/server/links';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return { queue: await getQueue(locals.db, locals.user.id, 5) };
};
