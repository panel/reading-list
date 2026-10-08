import { describe, expect, it } from 'vitest';
import {
	decide,
	estimateCall,
	InvalidQuestionError,
	parseAnswers,
	parseUsage,
	toRequest,
	type Question
} from './decide';
import { estimateNeurons } from './models';
import { dailyCap, usageDay } from './usage';

const questions: Record<string, Question> = {
	open: { type: 'noul', instructions: 'Will they open this?' },
	category: {
		type: 'choice',
		instructions: 'What is this about?',
		options: { work: 'Their job', music: 'Artists and albums', other: 'Anything else' }
	}
};

describe('toRequest', () => {
	it('keys questions by id and puts choice options in criteria', () => {
		expect(toRequest('clef-flash', 'state', questions)).toEqual({
			model: 'clef-flash',
			state: 'state',
			questions: {
				open: { type: 'noul', instructions: 'Will they open this?' },
				category: {
					type: 'choice',
					instructions: 'What is this about?',
					criteria: { work: 'Their job', music: 'Artists and albums', other: 'Anything else' }
				}
			}
		});
	});
});

describe('validation', () => {
	const choice = (options: Record<string, string>): Record<string, Question> => ({
		c: { type: 'choice', instructions: 'Which?', options }
	});

	it.each([
		['no questions', {}],
		['a bad question id', { 'has space': questions.open }],
		['a choice with one option', choice({ only: 'One' })],
		['a bad option id', choice({ ok: 'Fine', 'not ok': 'Spaces' })],
		['empty instructions', { q: { type: 'noul', instructions: ' ' } }]
	] as [string, Record<string, Question>][])('rejects %s before sending', (_, qs) => {
		expect(() => toRequest('clef-flash', 'state', qs)).toThrow(InvalidQuestionError);
	});

	it('rejects more than 64 questions', () => {
		const many = Object.fromEntries(
			Array.from({ length: 65 }, (_, i) => [`q${i}`, questions.open])
		);
		expect(() => toRequest('clef-flash', 'state', many)).toThrow(InvalidQuestionError);
	});
});

describe('parseUsage', () => {
	it('reads input tokens from either wrapper, or reports none', () => {
		expect(parseUsage({ usage: { input_tokens: 10 } })).toBe(10);
		expect(parseUsage({ result: { usage: { prompt_tokens: 20 } } })).toBe(20);
		expect(parseUsage({ answers: {} })).toBeNull();
	});
});

describe('parseAnswers', () => {
	it('reads { noul } and a choice with probabilities', () => {
		const answers = parseAnswers(
			{
				answers: {
					open: { noul: 0.82 },
					category: { choice: 'music', probabilities: { work: 0.1, music: 0.85, other: 0.05 } }
				}
			},
			questions
		);
		expect(answers).toEqual({
			open: { type: 'noul', p: 0.82 },
			category: {
				type: 'choice',
				choice: 'music',
				probabilities: { work: 0.1, music: 0.85, other: 0.05 }
			}
		});
	});

	it('reads a bare probability, a REST `result` wrapper, and picks the top option when no choice is named', () => {
		const answers = parseAnswers(
			{ result: { answers: { open: 0.3, category: { work: 0.6, music: 0.3, other: 0.1 } } } },
			questions
		);
		expect(answers.open).toEqual({ type: 'noul', p: 0.3 });
		expect(answers.category).toMatchObject({ type: 'choice', choice: 'work' });
	});

	it('skips answers it cannot read instead of guessing', () => {
		const answers = parseAnswers(
			{ answers: { open: 'yes', category: { choice: 'sports' } } },
			questions
		);
		expect(answers).toEqual({});
	});
});

describe('decide', () => {
	it('calls the model by its Workers AI id', async () => {
		const calls: [string, unknown][] = [];
		const ai = {
			run: async (model: string, input: Record<string, unknown>) => {
				calls.push([model, input]);
				return { answers: { open: { noul: 0.5 } }, usage: { input_tokens: 812 } };
			}
		};
		const { answers, inputTokens } = await decide(ai, 'clef-flash', 'state', {
			open: questions.open
		});
		expect(calls[0][0]).toBe('@cf/cloudflare/clef-flash');
		expect(calls[0][1]).toMatchObject({ model: 'clef-flash', state: 'state' });
		expect(answers.open).toEqual({ type: 'noul', p: 0.5 });
		expect(inputTokens).toBe(812);
	});
});

describe('costs', () => {
	it('prices tokens at the model rate, rounded up', () => {
		expect(estimateNeurons('clef-flash', 1_000_000)).toBe(8182);
		expect(estimateNeurons('clef-flash', 3000)).toBe(25);
		expect(estimateNeurons('clef', 3000)).toBe(66);
	});

	it('estimates a call from the request size', () => {
		const { tokens, neurons } = estimateCall('clef-flash', 'x'.repeat(12_000), questions);
		expect(tokens).toBeGreaterThan(3000);
		expect(neurons).toBeGreaterThan(24);
	});
});

describe('usage helpers', () => {
	it('uses UTC days, when Workers AI resets', () => {
		expect(usageDay(new Date('2026-10-07T23:30:00-07:00'))).toBe('2026-10-08');
	});

	it('reads the cap variable, falling back on nonsense', () => {
		expect(dailyCap('500')).toBe(500);
		expect(dailyCap(undefined)).toBe(2000);
		expect(dailyCap('lots')).toBe(2000);
		expect(dailyCap('-1')).toBe(2000);
	});
});
