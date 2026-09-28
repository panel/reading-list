/** What a token may do. Agents (Slice 9) will add read and triage scopes. */
export const SCOPES = {
	'links:write': 'Save links'
} as const;

export type Scope = keyof typeof SCOPES;
