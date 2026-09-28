import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyAccessJwt } from './access';

const config = { teamDomain: 'https://team.cloudflareaccess.com', aud: 'app-aud' };

async function setup() {
	const { privateKey, publicKey } = await generateKeyPair('RS256');
	const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
	const keys = createLocalJWKSet({ keys: [jwk] });
	const sign = (
		claims: Record<string, unknown>,
		opts: { iss?: string; aud?: string; exp?: string } = {}
	) =>
		new SignJWT(claims)
			.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
			.setIssuer(opts.iss ?? config.teamDomain)
			.setAudience(opts.aud ?? config.aud)
			.setIssuedAt()
			.setExpirationTime(opts.exp ?? '5m')
			.sign(privateKey);
	return { keys, sign };
}

describe('verifyAccessJwt', () => {
	it('returns the lowercased email from a valid token', async () => {
		const { keys, sign } = await setup();
		const token = await sign({ email: 'Me@Example.com' });
		expect(await verifyAccessJwt(token, config, keys)).toBe('me@example.com');
	});

	it('rejects a missing token', async () => {
		const { keys } = await setup();
		expect(await verifyAccessJwt(null, config, keys)).toBeNull();
	});

	it('rejects the wrong audience', async () => {
		const { keys, sign } = await setup();
		const token = await sign({ email: 'me@example.com' }, { aud: 'other-app' });
		expect(await verifyAccessJwt(token, config, keys)).toBeNull();
	});

	it('rejects the wrong issuer', async () => {
		const { keys, sign } = await setup();
		const token = await sign({ email: 'me@example.com' }, { iss: 'https://evil.example' });
		expect(await verifyAccessJwt(token, config, keys)).toBeNull();
	});

	it('rejects an expired token', async () => {
		const { keys, sign } = await setup();
		const token = await sign({ email: 'me@example.com' }, { exp: '-1m' });
		expect(await verifyAccessJwt(token, config, keys)).toBeNull();
	});

	it('rejects a token signed by another key', async () => {
		const { keys } = await setup();
		const { sign } = await setup();
		const token = await sign({ email: 'me@example.com' });
		expect(await verifyAccessJwt(token, config, keys)).toBeNull();
	});

	it('rejects a token without an email (e.g. a service token)', async () => {
		const { keys, sign } = await setup();
		const token = await sign({ common_name: 'svc' });
		expect(await verifyAccessJwt(token, config, keys)).toBeNull();
	});
});
