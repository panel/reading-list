import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

export interface AccessConfig {
	/** e.g. https://yourteam.cloudflareaccess.com */
	teamDomain: string;
	/** Application Audience (AUD) tag of the Access application */
	aud: string;
}

/**
 * Accepts the team domain with or without the scheme or a trailing slash and
 * returns it in the exact form Access uses as the JWT issuer.
 */
export function normalizeTeamDomain(teamDomain: string): string {
	const trimmed = teamDomain.trim().replace(/\/+$/, '');
	return /^https?:\/\//i.test(trimmed)
		? trimmed.replace(/^http:/i, 'https:')
		: `https://${trimmed}`;
}

// Kept per isolate so the signing keys are fetched once, not on every request.
const keySets = new Map<string, JWTVerifyGetKey>();

function keySetFor(teamDomain: string): JWTVerifyGetKey {
	let keys = keySets.get(teamDomain);
	if (!keys) {
		keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain));
		keySets.set(teamDomain, keys);
	}
	return keys;
}

/**
 * Verifies the JWT Cloudflare Access attaches to every request it lets through
 * and returns the signed-in email, or null if the token is missing or invalid.
 * https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */
export async function verifyAccessJwt(
	token: string | null,
	config: AccessConfig,
	keys: JWTVerifyGetKey = keySetFor(config.teamDomain)
): Promise<string | null> {
	if (!token) return null;
	try {
		const { payload } = await jwtVerify(token, keys, {
			issuer: config.teamDomain,
			audience: config.aud
		});
		return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
	} catch {
		return null;
	}
}
