import { DECISION_MODELS, estimateNeurons, estimateTokens, type DecisionModel } from './models';

/**
 * A typed question for a decision model (Clef, Clef-flash, or TypeSafe's Jev,
 * which share an API): a yes/no probability, or a probability for each option.
 */
export type Question =
	| { type: 'noul'; instructions: string }
	| { type: 'choice'; instructions: string; options: Record<string, string> };

export type Answer =
	| { type: 'noul'; p: number }
	| { type: 'choice'; choice: string; probabilities: Record<string, number> };

export type Answers = Record<string, Answer>;

/** The part of the Workers AI binding we use, so core needs no Cloudflare types. */
export interface AiRunner {
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

/** The request body for env.AI.run: questions keyed by id; a choice's options go in `criteria`. */
export function toRequest(
	model: DecisionModel,
	state: string,
	questions: Record<string, Question>
) {
	return {
		model,
		state,
		questions: Object.fromEntries(
			Object.entries(questions).map(([id, q]) => [
				id,
				q.type === 'noul'
					? { type: 'noul', instructions: q.instructions }
					: { type: 'choice', instructions: q.instructions, criteria: q.options }
			])
		)
	};
}

const probability = (v: unknown): number | null =>
	typeof v === 'number' && v >= 0 && v <= 1 ? v : null;

/**
 * Reads the answers out of a response. Sources differ on the exact shape (a
 * yes/no answer as a bare number or as `{ noul: p }`; a choice's probabilities
 * under `probabilities` or alongside it), so this accepts each and skips
 * anything it can't read rather than guessing.
 */
export function parseAnswers(response: unknown, questions: Record<string, Question>): Answers {
	const body = (response as { result?: unknown })?.result ?? response;
	const raw = (body as { answers?: Record<string, unknown> })?.answers ?? {};
	const answers: Answers = {};
	for (const [id, q] of Object.entries(questions)) {
		const value = raw[id];
		if (q.type === 'noul') {
			const p =
				probability(value) ??
				probability((value as { noul?: unknown })?.noul) ??
				probability((value as { probability?: unknown })?.probability);
			if (p !== null) answers[id] = { type: 'noul', p };
			continue;
		}
		const v = value as { choice?: unknown; probabilities?: Record<string, unknown> } | undefined;
		const source = v?.probabilities ?? (v as Record<string, unknown> | undefined) ?? {};
		const probabilities: Record<string, number> = {};
		for (const option of Object.keys(q.options)) {
			const p = probability(source[option]);
			if (p !== null) probabilities[option] = p;
		}
		const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
		const choice =
			typeof v?.choice === 'string' && v.choice in q.options ? v.choice : ranked[0]?.[0];
		if (choice) answers[id] = { type: 'choice', choice, probabilities };
	}
	return answers;
}

/** What a call would cost, from the size of the state and the questions. */
export function estimateCall(
	model: DecisionModel,
	state: string,
	questions: Record<string, Question>
) {
	const tokens = estimateTokens(JSON.stringify(toRequest(model, state, questions)));
	return { tokens, neurons: estimateNeurons(model, tokens) };
}

/** Asks a decision model on Workers AI. Spending is checked by the caller (reserveNeurons). */
export async function decide(
	ai: AiRunner,
	model: DecisionModel,
	state: string,
	questions: Record<string, Question>
): Promise<Answers> {
	const response = await ai.run(DECISION_MODELS[model].id, toRequest(model, state, questions));
	return parseAnswers(response, questions);
}
