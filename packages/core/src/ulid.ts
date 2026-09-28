// Crockford base32, as specified by https://github.com/ulid/spec
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;
const MAX_TIME = 2 ** 48 - 1;

/**
 * A 26-character, lexicographically time-sortable, non-guessable ID.
 * Used as the primary key for every entity so IDs are safe to expose in URLs.
 */
export function ulid(now: number = Date.now()): string {
	if (!Number.isInteger(now) || now < 0 || now > MAX_TIME) {
		throw new RangeError(`ulid: invalid timestamp ${now}`);
	}

	let time = '';
	for (let i = 0, t = now; i < TIME_LEN; i++) {
		time = ALPHABET[t % 32] + time;
		t = Math.floor(t / 32);
	}

	// Each byte maps to one character using its low 5 bits: 16 chars x 5 bits = 80 random bits.
	const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LEN));
	let random = '';
	for (const b of bytes) random += ALPHABET[b & 31];

	return time + random;
}

/** Recovers the millisecond timestamp encoded in a ULID. */
export function ulidTime(id: string): number {
	let t = 0;
	for (const ch of id.slice(0, TIME_LEN).toUpperCase()) {
		const v = ALPHABET.indexOf(ch);
		if (v === -1) throw new Error(`ulidTime: invalid ULID ${id}`);
		t = t * 32 + v;
	}
	return t;
}
