import { inboxCount } from '$lib/server/inbox';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Actions that change read state call invalidateAll(), which reruns this.
	depends('app:unread');
	return { unread: await inboxCount(locals.db, locals.user.id) };
};
