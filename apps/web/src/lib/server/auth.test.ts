import { describe, expect, it } from 'vitest';
import { identify } from './auth';

const request = new Request('https://reader.nelsonfamily.fyi/');
const noAccess = { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' };
const access = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'app-aud' };

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

	it('prefers DEV_USER_EMAIL in dev even when Access is configured', async () => {
		const result = await identify(request, { ...access, DEV_USER_EMAIL: 'dev@example.com' }, true);
		expect(result).toEqual({ ok: true, email: 'dev@example.com' });
	});

	it('requires an Access JWT in production even when DEV_USER_EMAIL is set', async () => {
		const result = await identify(request, { ...access, DEV_USER_EMAIL: 'dev@example.com' }, false);
		expect(result).toMatchObject({ ok: false, status: 401 });
	});

	it('requires an Access JWT in dev without DEV_USER_EMAIL', async () => {
		const result = await identify(request, { ...access, DEV_USER_EMAIL: '' }, true);
		expect(result).toMatchObject({ ok: false, status: 401 });
	});
});
