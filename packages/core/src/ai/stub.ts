import type { AiRunner } from './decide';

/**
 * A stand-in for Workers AI in local dev and tests (Workers AI only runs
 * remotely): decision questions get fixed or deterministic answers, and the
 * text model returns a canned set of categories.
 */
export function stubAi(): AiRunner {
	return {
		async run(_model, input) {
			if (Array.isArray(input.messages)) {
				return {
					response: {
						categories: [
							{
								name: 'Work',
								description: 'Their job, their field, and the tools they use at work.',
								examples: []
							},
							{
								name: 'Music',
								description: 'Artists, albums, concerts and music gear.',
								examples: []
							},
							{ name: 'Local', description: 'News and events where they live.', examples: [] }
						]
					},
					usage: { prompt_tokens: 3000, completion_tokens: 300 }
				};
			}
			const questions = (input.questions ?? {}) as Record<
				string,
				{ type: string; criteria?: Record<string, string> }
			>;
			const answers: Record<string, unknown> = {};
			for (const [id, q] of Object.entries(questions)) {
				if (q.type === 'choice' && q.criteria) {
					// Deterministic per question: rotate the favourite through the options.
					const options = Object.keys(q.criteria);
					const pick = [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % options.length;
					const rest = (1 - 0.7) / Math.max(1, options.length - 1);
					answers[id] = {
						choice: options[pick],
						probabilities: Object.fromEntries(options.map((o, i) => [o, i === pick ? 0.7 : rest]))
					};
				} else {
					answers[id] = { noul: id === 'keep' ? 0.2 : 0.7 };
				}
			}
			return { answers, usage: { input_tokens: 1000 } };
		}
	};
}
