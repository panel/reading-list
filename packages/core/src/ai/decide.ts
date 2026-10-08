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

const ID = /^[A-Za-z0-9_.-]{1,100}$/;

/** Questions the API would reject, caught before spending anything on them. */
export class InvalidQuestionError extends Error {}

/**
 * Checks the API's limits: 1 to 64 questions, ids of letters, digits, `_`, `.`
 * and `-` (up to 100), and 2 to 255 options per choice, with ids like questions'.
 */
export function validateQuestions(questions: Record<string, Question>) {
	const entries = Object.entries(questions);
	if (entries.length < 1 || entries.length > 64) {
		throw new InvalidQuestionError(`Ask 1 to 64 questions, not ${entries.length}`);
	}
	for (const [id, q] of entries) {
		if (!ID.test(id)) throw new InvalidQuestionError(`Bad question id: ${id}`);
		if (!q.instructions.trim()) throw new InvalidQuestionError(`${id} has no instructions`);
		if (q.type !== 'choice') continue;
		const options = Object.keys(q.options);
		if (options.length < 2 || options.length > 255) {
			throw new InvalidQuestionError(`${id} needs 2 to 255 options, not ${options.length}`);
		}
		const bad = options.find((o) => !ID.test(o));
		if (bad !== undefined) throw new InvalidQuestionError(`${id} has a bad option id: ${bad}`);
	}
}

/** The request body for env.AI.run: questions keyed by id; a choice's options go in `criteria`. */
export function toRequest(
	model: DecisionModel,
	state: string,
	questions: Record<string, Question>
) {
	validateQuestions(questions);
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

/**
 * Input tokens the model reports having read, if the response says (`usage`,
 * possibly inside the REST `result` wrapper; the field name isn't settled).
 */
export function parseUsage(response: unknown): number | null {
	const body = (response as { result?: unknown })?.result ?? response;
	const usage = (body as { usage?: Record<string, unknown> })?.usage;
	const n = usage?.input_tokens ?? usage?.prompt_tokens ?? usage?.total_tokens;
	return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
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

/**
 * Asks a decision model on Workers AI. Spending is checked by the caller
 * (reserveNeurons before; settleNeurons after, when the response reports
 * `inputTokens`). The first call to a cold model can take close to a minute,
 * so this belongs off any page's request path.
 */
export async function decide(
	ai: AiRunner,
	model: DecisionModel,
	state: string,
	questions: Record<string, Question>
): Promise<{ answers: Answers; inputTokens: number | null; raw: unknown }> {
	const response = await ai.run(DECISION_MODELS[model].id, toRequest(model, state, questions));
	return {
		answers: parseAnswers(response, questions),
		inputTokens: parseUsage(response),
		raw: response
	};
}
