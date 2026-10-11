import { recentReading } from '$lib/server/reading';
import type { PageServerLoad } from './$types';

const WINDOWS = [7, 14, 30, 90] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
	const asked = Number(url.searchParams.get('days'));
	const days = WINDOWS.find((d) => d === asked) ?? 14;
	const items = await recentReading(locals.db, locals.user.id, { days, limit: 50 });
	return { days, windows: [...WINDOWS], items };
};
