import type { AiRunner } from './decide';

/**
 * The Workers AI text model behind "Suggest categories" (Slice 12d): a small
 * on-demand job, so a mid-size open model is plenty. Overridable with the
 * AI_TEXT_MODEL variable. Neuron rates are per million tokens, from the
 * Workers AI pricing page; a model not listed here is priced at the first
 * one's rates, to stay on the safe side of the daily cap.
 */
export const TEXT_MODELS: Record<string, { inPerM: number; outPerM: number }> = {
	'@cf/meta/llama-3.3-70b-instruct-fp8-fast': { inPerM: 26668, outPerM: 204805 },
	'@cf/meta/llama-3.1-8b-instruct-fast': { inPerM: 4119, outPerM: 34868 }
};

export const DEFAULT_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const rates = (model: string) => TEXT_MODELS[model] ?? TEXT_MODELS[DEFAULT_TEXT_MODEL];

export function textNeurons(model: string, inputTokens: number, outputTokens: number) {
	const r = rates(model);
	return Math.ceil((inputTokens * r.inPerM + outputTokens * r.outPerM) / 1_000_000);
}

export interface TextRequest {
	system: string;
	prompt: string;
	/** JSON Schema the reply must follow (Workers AI JSON mode). */
	schema: Record<string, unknown>;
	maxTokens: number;
}

/**
 * Asks the text model for JSON. The reply's `response` may arrive parsed (JSON
 * mode) or as a string, possibly wrapped in a code fence; either is accepted.
 */
export async function generateJson(
	ai: AiRunner,
	model: string,
	req: TextRequest
): Promise<{ json: unknown; inputTokens: number | null; outputTokens: number | null }> {
	const raw = (await ai.run(model, {
		messages: [
			{ role: 'system', content: req.system },
			{ role: 'user', content: req.prompt }
		],
		max_tokens: req.maxTokens,
		response_format: { type: 'json_schema', json_schema: req.schema }
	})) as { response?: unknown; usage?: Record<string, unknown>; result?: unknown };
	const body = (raw?.result ?? raw) as { response?: unknown; usage?: Record<string, unknown> };
	let json = body?.response;
	if (typeof json === 'string') {
		const text = json.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
		try {
			json = JSON.parse(text);
		} catch {
			throw new Error(`The text model didn’t return JSON: ${text.slice(0, 200)}`);
		}
	}
	const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
	return {
		json,
		inputTokens: n(body?.usage?.prompt_tokens),
		outputTokens: n(body?.usage?.completion_tokens)
	};
}
