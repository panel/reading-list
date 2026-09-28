import { unreadCount } from '$lib/server/entries';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Actions that change read state call invalidateAll(), which reruns this.
	depends('app:unread');
	return { unread: await unreadCount(locals.db, locals.user.id) };
};
