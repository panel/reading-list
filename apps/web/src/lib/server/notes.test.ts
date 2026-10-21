import { describe, expect, it } from 'vitest';
import { composeNotes, linkParts, postParts } from './notes';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 9, minute));

describe('composeNotes', () => {
	it('puts the article note first, then highlights as quoted notes in the order saved', () => {
		const notes = composeNotes({ note: '  Worth citing.  ', at: at(30) }, [
			{ id: 'b', text: 'Second passage', note: null, createdAt: at(20) },
			{ id: 'a', text: 'First passage', note: 'Why it matters', createdAt: at(10) }
		]);
		expect(notes).toEqual([
			{ quote: null, text: 'Worth citing.', at: at(30).toISOString() },
			{ quote: 'First passage', text: 'Why it matters', at: at(10).toISOString() },
			{ quote: 'Second passage', text: null, at: at(20).toISOString() }
		]);
	});

	it('leaves out an empty note and a highlight listed twice', () => {
		const h = { id: 'a', text: 'Passage', note: null, createdAt: at(1) };
		expect(composeNotes({ note: ' ', at: at(2) }, [h, h])).toEqual([
			{ quote: 'Passage', text: null, at: at(1).toISOString() }
		]);
		expect(composeNotes(null, [])).toEqual([]);
	});
});

describe('linkParts and postParts', () => {
	it('join a link and the post it came from', () => {
		expect(linkParts({ id: 'l', sourceEntryId: 'p' })).toEqual([
			{ kind: 'link', id: 'l' },
			{ kind: 'post', id: 'p' }
		]);
		expect(linkParts({ id: 'l', sourceEntryId: null })).toEqual([{ kind: 'link', id: 'l' }]);
		expect(postParts({ id: 'p', linkId: 'l' })).toEqual([
			{ kind: 'post', id: 'p' },
			{ kind: 'link', id: 'l' }
		]);
	});
});
