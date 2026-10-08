import {
	BudgetError,
	CategoryError,
	checkCategories,
	stubAi,
	suggestCategories,
	type CategoryDraft,
	type CheckReport,
	type Suggestion
} from '@reading-list/core';
import type { Db } from '@reading-list/core/db';

const FETCHER = 'https://fetcher.internal';
/** In dev the model is a stub, so this only exercises the cap. */
const DEV_CAP = 2000;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs a category job with a model. In production it goes to the fetcher
 * (FETCHER binding), which holds the Workers AI binding and the daily cap; the
 * first call to a cold model can take close to a minute. In dev, where there's
 * no fetcher and Workers AI only runs remotely, it runs here with a stub.
 */
async function run<T>(
	platform: App.Platform | undefined,
	{ dev }: { dev: boolean; db: Db },
	path: string,
	body: unknown,
	local: () => Promise<T>,
	pick: (json: Record<string, unknown>) => T
): Promise<Result<T>> {
	if (dev) {
		try {
			return { ok: true, value: await local() };
		} catch (err) {
			if (err instanceof CategoryError || err instanceof BudgetError) {
				return { ok: false, error: err.message };
			}
			throw err;
		}
	}
	const fetcher = platform?.env.FETCHER;
	if (!fetcher) return { ok: false, error: 'The fetcher isn’t reachable.' };
	const response = await fetcher.fetch(`${FETCHER}/${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body ?? {})
	});
	const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (!response.ok)
		return { ok: false, error: String(json.error ?? `Failed (${response.status})`) };
	return { ok: true, value: pick(json) };
}

export const suggest = (
	platform: App.Platform | undefined,
	ctx: { dev: boolean; db: Db },
	userId: string
): Promise<Result<Suggestion[]>> =>
	run(
		platform,
		ctx,
		`categories/suggest/${userId}`,
		{},
		() => suggestCategories(ctx.db, stubAi(), userId, { cap: DEV_CAP }),
		(json) => json.suggestions as Suggestion[]
	);

export const check = (
	platform: App.Platform | undefined,
	ctx: { dev: boolean; db: Db },
	userId: string,
	draft: CategoryDraft[]
): Promise<Result<CheckReport>> =>
	run(
		platform,
		ctx,
		`categories/check/${userId}`,
		{ draft },
		() => checkCategories(ctx.db, stubAi(), userId, draft, { cap: DEV_CAP }),
		(json) => json.report as CheckReport
	);

/** Parses the draft the Settings form sends as JSON; anything malformed becomes empty. */
export function parseDraft(value: FormDataEntryValue | null): CategoryDraft[] {
	try {
		const list = JSON.parse(String(value ?? '[]'));
		if (!Array.isArray(list)) return [];
		return list.map((c) => ({
			slug: typeof c?.slug === 'string' ? c.slug : undefined,
			name: String(c?.name ?? ''),
			description: String(c?.description ?? '')
		}));
	} catch {
		return [];
	}
}
