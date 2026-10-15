import { describe, expect, it } from 'vitest';
import { joinPieces, listMarker, locate, normalize, type Piece } from './highlight';

describe('joinPieces', () => {
	it('keeps a selection inside one paragraph as one line', () => {
		expect(joinPieces([{ kind: 'text', text: '  the middle of\n a sentence ' }])).toBe(
			'the middle of a sentence'
		);
	});

	it('puts each block on its own line and list items after their markers', () => {
		const pieces: Piece[] = [
			{ kind: 'text', text: 'end of the intro:' },
			{ kind: 'block', marker: '1.' },
			{ kind: 'text', text: 'First ' },
			{ kind: 'text', text: 'thing' },
			{ kind: 'block', marker: '2.' },
			{ kind: 'text', text: 'Second thing' },
			{ kind: 'block' },
			{ kind: 'text', text: 'After the list' }
		];
		expect(joinPieces(pieces)).toBe(
			'end of the intro:\n1. First thing\n2. Second thing\nAfter the list'
		);
	});

	it('drops blocks with nothing selected in them', () => {
		expect(
			joinPieces([
				{ kind: 'block', marker: '•' },
				{ kind: 'text', text: '  ' },
				{ kind: 'block', marker: '•' },
				{ kind: 'text', text: 'Only this' },
				{ kind: 'block', marker: '•' },
				{ kind: 'text', text: 'and this' }
			])
		).toBe('• Only this\n• and this');
	});

	it('leaves the marker off part of a single list item', () => {
		expect(
			joinPieces([
				{ kind: 'block', marker: '3.' },
				{ kind: 'text', text: 'part of an item' }
			])
		).toBe('part of an item');
	});
});

describe('listMarker', () => {
	it('numbers ordered lists from their start, and bullets the rest', () => {
		expect(listMarker(true, 1, 0)).toBe('1.');
		expect(listMarker(true, 4, 2)).toBe('6.');
		expect(listMarker(true, 3, 2, true)).toBe('1.');
		expect(listMarker(false, 1, 5)).toBe('•');
	});
});

describe('normalize', () => {
	it('collapses whitespace and maps back to the original', () => {
		const { text, map } = normalize('  a \n\tb');
		expect(text).toBe('a b');
		expect(map).toEqual([2, 3, 6]);
	});
});

describe('locate', () => {
	const article =
		'Intro text.\n\n  First   thing\n  Second thing\nOutro text, then First thing again.';

	it('finds a passage across whitespace differences', () => {
		const [start, end] = locate(article, 'Intro text. First thing')!;
		expect(article.slice(start, end)).toBe('Intro text.\n\n  First   thing');
	});

	it('finds list lines without their markers, in order', () => {
		const [start, end] = locate(article, '• First thing\n• Second thing')!;
		expect(article.slice(start, end)).toBe('First   thing\n  Second thing');
	});

	it('starts looking from its block', () => {
		const from = article.indexOf('Outro');
		const [start] = locate(article, 'First thing', from)!;
		expect(start).toBe(article.lastIndexOf('First thing'));
	});

	it('falls back to anywhere, and gives up when it is gone', () => {
		expect(locate(article, 'Intro text.', article.length - 5)).toEqual([0, 11]);
		expect(locate(article, 'Not in the article')).toBeNull();
		expect(locate(article, '')).toBeNull();
	});
});
