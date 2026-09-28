import { ACCESS_JWT_HEADER, normalizeTeamDomain, verifyAccessJwt } from './access';

export type Identity =
	{ ok: true; email: string } | { ok: false; status: 401 | 500; message: string };

type AuthEnv = Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD' | 'DEV_USER_EMAIL'>;

/**
 * Works out who is making the request. Fails closed: in production, a request
 * is only accepted with a valid Cloudflare Access JWT.
 */
export async function identify(request: Request, env: AuthEnv, isDev: boolean): Promise<Identity> {
	// Access isn't in front of the local dev server. `isDev` is false in every
	// production build, so this can't be used to skip Access in production.
	if (isDev && env.DEV_USER_EMAIL) {
		return { ok: true, email: env.DEV_USER_EMAIL.toLowerCase() };
	}

	if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
		const email = await verifyAccessJwt(request.headers.get(ACCESS_JWT_HEADER), {
			teamDomain: normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN),
			aud: env.ACCESS_AUD
		});
		return email ? { ok: true, email } : { ok: false, status: 401, message: 'Unauthorized' };
	}

	return {
		ok: false,
		status: 500,
		message: isDev
			? 'Set DEV_USER_EMAIL in apps/web/.dev.vars'
			: 'Cloudflare Access is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD)'
	};
}
