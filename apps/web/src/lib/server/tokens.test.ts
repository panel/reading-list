import { describe, expect, it } from 'vitest';
import { bearerToken, generateToken, hashToken, hasScope, TOKEN_PREFIX } from './tokens';

describe('generateToken', () => {
	it('is prefixed, url-safe and 256 bits', () => {
		const token = generateToken();
		expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
		expect(token.slice(TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('does not repeat', () => {
		expect(new Set(Array.from({ length: 100 }, generateToken)).size).toBe(100);
	});
});

describe('hashToken', () => {
	it('is a stable SHA-256 hex digest', async () => {
		expect(await hashToken('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});

describe('bearerToken', () => {
	it.each([
		['Bearer rl_abc', 'rl_abc'],
		['bearer   rl_abc  ', 'rl_abc'],
		['Bearer abc', null],
		['Basic rl_abc', null],
		['Bearer rl_a rl_b', null],
		['', null],
		[null, null]
	])('%j → %j', (header, expected) => {
		expect(bearerToken(header)).toBe(expected);
	});
});

describe('hasScope', () => {
	it('matches whole scope names', () => {
		expect(hasScope({ scopes: 'links:write' }, 'links:write')).toBe(true);
		expect(hasScope({ scopes: 'links:read' }, 'links:write')).toBe(false);
		expect(hasScope({ scopes: '' }, 'links:write')).toBe(false);
	});
});
