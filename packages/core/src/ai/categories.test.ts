import { describe, expect, it } from 'vitest';
import {
	CategoryError,
	formatBatchState,
	normalizeDraft,
	placement,
	slugify,
	summarizeCheck,
	type ItemText
} from './categories';
import { validateQuestions } from './decide';
import { generateJson, textNeurons } from './text';

describe('slugify', () => {
	it('makes ids the model API accepts', () => {
		expect(slugify('Local News')).toBe('local-news');
		expect(slugify('  Café & Food! ')).toBe('cafe-food');
		expect(slugify('日本')).toBe('category');
		expect(slugify('x'.repeat(60))).toHaveLength(40);
	});
});

describe('normalizeDraft', () => {
	it('trims, skips empty rows, and keeps slugs unique and away from "other"', () => {
		expect(
			normalizeDraft([
				{ name: ' Work ', description: ' My job ' },
				{ name: '', description: 'ignored' },
				{ name: 'Work', description: 'Also work' },
				{ name: 'Other', description: 'Nope' }
			])
		).toEqual([
			{ slug: 'work', name: 'Work', description: 'My job' },
			{ slug: 'work-2', name: 'Work', description: 'Also work' },
			{ slug: 'other-2', name: 'Other', description: 'Nope' }
		]);
	});

	it('keeps an existing slug when a category is renamed', () => {
		expect(normalizeDraft([{ slug: 'music', name: 'Tunes', description: 'Songs' }])[0].slug).toBe(
			'music'
		);
	});

	it('needs a description', () => {
		expect(() => normalizeDraft([{ name: 'Work', description: ' ' }])).toThrow(CategoryError);
	});
});

describe('placement', () => {
	it('takes the top pick, and a second when it is also likely', () => {
		expect(placement({ music: 0.55, local: 0.4, other: 0.05 })).toMatchObject({
			primary: 'music',
			secondary: 'local'
		});
		expect(placement({ music: 0.8, local: 0.15, other: 0.05 }).secondary).toBeNull();
		expect(placement({ music: 0.5, other: 0.45 }).secondary).toBeNull();
	});

	it('trusts the model’s named choice', () => {
		expect(placement({ a: 0.5, b: 0.5 }, 'b').primary).toBe('b');
	});
});

const defs = [
	{ slug: 'music', name: 'Music', description: 'Artists and albums' },
	{ slug: 'local', name: 'Local', description: 'News from Cleveland' }
];
const item = (id: string, title: string): ItemText => ({
	kind: 'post',
	id,
	title,
	source: 'Blog',
	text: 'Some words'
});

describe('formatBatchState', () => {
	it('lists the rules, the corrections, then numbered items', () => {
		const state = formatBatchState(
			defs,
			[{ title: 'A show downtown', category: 'Local' }],
			[item('1', 'First'), item('2', 'Second')]
		);
		expect(state).toContain('- Local: News from Cleveland');
		expect(state).toContain('- Other: Anything that fits none of the other categories');
		expect(state).toContain('- “A show downtown” → Local');
		expect(state).toContain('[1] First (Blog)');
		expect(state).toContain('[2] Second (Blog)');
	});
});

describe('summarizeCheck', () => {
	it('counts, flags unsure picks and confused pairs', () => {
		const items = [item('1', 'A'), item('2', 'B'), item('3', 'C'), item('4', 'D')];
		const placed = new Map([
			['post:1', placement({ music: 0.9, local: 0.05, other: 0.05 })],
			['post:2', placement({ music: 0.45, local: 0.4, other: 0.15 })],
			['post:3', placement({ local: 0.48, music: 0.42, other: 0.1 })],
			['post:4', placement({ other: 0.8, music: 0.1, local: 0.1 })]
		]);
		const report = summarizeCheck(defs, items, placed);
		expect(report.sampled).toBe(4);
		expect(report.categories).toEqual([
			{ slug: 'music', name: 'Music', count: 2, examples: ['A', 'B'] },
			{ slug: 'local', name: 'Local', count: 1, examples: ['C'] }
		]);
		expect(report.other).toEqual({ count: 1, examples: ['D'] });
		expect(report.unsure).toBe(2);
		expect(report.confused).toEqual([{ a: 'Local', b: 'Music', count: 2 }]);
	});
});

describe('generateJson', () => {
	const ai = (response: unknown) => ({
		run: async () => ({ response, usage: { prompt_tokens: 100, completion_tokens: 20 } })
	});
	const req = { system: 's', prompt: 'p', schema: {}, maxTokens: 10 };

	it('accepts parsed JSON, a string, or a fenced string', async () => {
		for (const response of [{ a: 1 }, '{"a":1}', '```json\n{"a":1}\n```']) {
			const r = await generateJson(ai(response), 'm', req);
			expect(r.json).toEqual({ a: 1 });
			expect(r.inputTokens).toBe(100);
			expect(r.outputTokens).toBe(20);
		}
	});

	it('fails clearly on prose', async () => {
		await expect(generateJson(ai('Sure! Here are some'), 'm', req)).rejects.toThrow(/JSON/);
	});

	it('prices output tokens too', () => {
		expect(textNeurons('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 1_000_000, 0)).toBe(26668);
		expect(textNeurons('unknown', 0, 1_000_000)).toBe(204805);
	});
});

it('batch questions stay within the API limits', () => {
	// 20 items, 30 categories + Other: valid ids and option counts.
	const many = Array.from({ length: 30 }, (_, i) => ({ name: `Cat ${i}`, description: 'x' }));
	const norm = normalizeDraft(many);
	const options = Object.fromEntries([...norm.map((d) => [d.slug, d.name]), ['other', 'Other']]);
	const questions = Object.fromEntries(
		Array.from({ length: 20 }, (_, i) => [
			`item_${i + 1}`,
			{ type: 'choice' as const, instructions: 'Which?', options }
		])
	);
	expect(() => validateQuestions(questions)).not.toThrow();
});
