import { count, eq } from 'drizzle-orm';
import { links } from '@reading-list/core/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [{ savedLinks }] = await locals.db
		.select({ savedLinks: count() })
		.from(links)
		.where(eq(links.userId, locals.user.id));

	return { email: locals.user.email, savedLinks };
};
