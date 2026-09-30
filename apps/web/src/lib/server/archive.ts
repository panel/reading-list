import { eq } from 'drizzle-orm';
import { captureArchive, claimArchives } from '@reading-list/core';
import { linkArchives, type Db } from '@reading-list/core/db';

const KICK_URL = 'https://fetcher.internal/archive/kick';

/**
 * Nudges the fetcher to capture any readable copies that are waiting (a link
 * just saved, starred or put back in the inbox), without holding up the
 * response. In dev there's no fetcher running, so the copies are captured
 * here instead; the 15-minute cron catches anything a nudge misses.
 */
export function kickArchiver(
	platform: App.Platform | undefined,
	db: Db,
	{ dev }: { dev: boolean }
): void {
	const waitUntil = (work: Promise<unknown>) => platform?.ctx.waitUntil(work.catch(() => {}));
	if (dev) {
		waitUntil(
			(async () => {
				for (const id of await claimArchives(db, 3)) await captureArchive(db, id);
			})()
		);
	} else if (platform?.env.FETCHER) {
		waitUntil(platform.env.FETCHER.fetch(KICK_URL, { method: 'POST' }));
	}
}

/** What the link page needs to know about its readable copy. */
export async function getArchive(db: Db, linkId: string) {
	const row = await db.query.linkArchives.findFirst({
		where: eq(linkArchives.linkId, linkId),
		columns: {
			status: true,
			source: true,
			html: true,
			text: true,
			words: true,
			lastError: true,
			capturedAt: true,
			keepUntil: true
		}
	});
	return row ?? null;
}
