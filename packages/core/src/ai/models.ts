/**
 * Workers AI models used by Slice 12, with their published neuron rates, so
 * every call can be priced before it's made. Rates are per million input
 * tokens; decision models don't bill output.
 */
export const DECISION_MODELS = {
	'clef-flash': { id: '@cf/cloudflare/clef-flash', neuronsPerMTokens: 8182 },
	clef: { id: '@cf/cloudflare/clef', neuronsPerMTokens: 21818 }
} as const;

export type DecisionModel = keyof typeof DECISION_MODELS;

/** A rough token count (about 4 characters per token), rounded up to be safe. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function estimateNeurons(model: DecisionModel, inputTokens: number): number {
	return Math.ceil((inputTokens * DECISION_MODELS[model].neuronsPerMTokens) / 1_000_000);
}
