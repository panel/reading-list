import { describe, expect, it } from 'vitest';
import { identify } from './auth';

const request = new Request('https://reader.nelsonfamily.fyi/');
const noAccess = { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' };

describe('identify', () => {
	it('uses DEV_USER_EMAIL in dev when Access is not configured', async () => {
		const result = await identify(
			request,
			{ ...noAccess, DEV_USER_EMAIL: 'Dev@Example.com' },
			true
		);
		expect(result).toEqual({ ok: true, email: 'dev@example.com' });
	});

	it('ignores DEV_USER_EMAIL outside dev', async () => {
		const result = await identify(
			request,
			{ ...noAccess, DEV_USER_EMAIL: 'dev@example.com' },
			false
		);
		expect(result).toMatchObject({ ok: false, status: 500 });
	});

	it('fails closed when nothing is configured', async () => {
		const result = await identify(request, { ...noAccess, DEV_USER_EMAIL: '' }, true);
		expect(result).toMatchObject({ ok: false, status: 500 });
	});

	it('requires an Access JWT once Access is configured, even in dev', async () => {
		const env = {
			ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
			ACCESS_AUD: 'app-aud',
			DEV_USER_EMAIL: 'dev@example.com'
		};
		expect(await identify(request, env, true)).toMatchObject({ ok: false, status: 401 });
	});
});
