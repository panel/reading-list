import { describe, expect, it } from 'vitest';
import { csvCell } from './export';

describe('csvCell', () => {
	it.each([
		[null, ''],
		['plain', 'plain'],
		['has, comma', '"has, comma"'],
		['say "hi"', '"say ""hi"""'],
		['two\nlines', '"two\nlines"'],
		[['a', 'b'], 'a b'],
		[true, 'true'],
		['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
		['+1', "'+1"],
		['@cmd', "'@cmd"],
		['-2', "'-2"]
	])('%j → %j', (value, expected) => {
		expect(csvCell(value)).toBe(expected);
	});
});
