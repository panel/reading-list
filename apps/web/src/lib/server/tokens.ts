import { and, desc, eq } from 'drizzle-orm';
import { apiTokens, users, type ApiToken, type Db, type User } from '@reading-list/core/db';

export const TOKEN_PREFIX = 'rl_';

import type { Scope } from '$lib/tokens';

export { SCOPES, type Scope } from '$lib/tokens';

// Only refresh last_used_at when it's older than this, to avoid a DB write per request.
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;

function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new random token: "rl_" + 256 bits, base64url. */
export function generateToken(): string {
	return TOKEN_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pulls the token out of an `Authorization: Bearer rl_…` header. */
export function bearerToken(header: string | null): string | null {
	const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
	return match && match[1].startsWith(TOKEN_PREFIX) ? match[1] : null;
}

export function hasScope(token: Pick<ApiToken, 'scopes'>, scope: Scope): boolean {
	return token.scopes.split(/\s+/).includes(scope);
}

/** Creates a token. The plain token is returned only here and never stored. */
export async function createToken(
	db: Db,
	userId: string,
	name: string,
	scopes: Scope[] = ['links:write']
): Promise<{ token: string; record: ApiToken }> {
	const token = generateToken();
	const [record] = await db
		.insert(apiTokens)
		.values({
			userId,
			name: name.trim().slice(0, 80) || 'Untitled token',
			tokenHash: await hashToken(token),
			tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 6),
			scopes: scopes.join(' ')
		})
		.returning();
	return { token, record };
}

export function listTokens(db: Db, userId: string) {
	return db
		.select()
		.from(apiTokens)
		.where(eq(apiTokens.userId, userId))
		.orderBy(desc(apiTokens.createdAt));
}

export async function revokeToken(db: Db, userId: string, id: string): Promise<boolean> {
	const deleted = await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
		.returning({ id: apiTokens.id });
	return deleted.length > 0;
}

/**
 * Resolves a bearer token to its user. `defer` receives the last-used update
 * so it can run after the response (ctx.waitUntil) rather than delay it.
 */
export async function authenticateToken(
	db: Db,
	token: string,
	defer: (work: Promise<unknown>) => void = () => {}
): Promise<{ user: User; token: ApiToken } | null> {
	const [row] = await db
		.select({ token: apiTokens, user: users })
		.from(apiTokens)
		.innerJoin(users, eq(users.id, apiTokens.userId))
		.where(eq(apiTokens.tokenHash, await hashToken(token)))
		.limit(1);
	if (!row) return null;

	const now = Date.now();
	if (!row.token.lastUsedAt || now - row.token.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
		defer(
			db
				.update(apiTokens)
				.set({ lastUsedAt: new Date(now) })
				.where(eq(apiTokens.id, row.token.id))
				.catch((err) => console.warn('Could not update token last_used_at', err))
		);
	}
	return row;
}
