/** What a token may do. */
export const SCOPES = {
	'links:read': 'Read & search links',
	'links:write': 'Save & edit links',
	'feeds:read': 'Read feed posts',
	'feeds:write': 'Triage feed posts'
} as const;

export type Scope = keyof typeof SCOPES;

export const isScope = (value: string): value is Scope => value in SCOPES;

/** Common combinations offered when creating a token. */
export const PRESETS: { id: string; label: string; hint: string; scopes: Scope[] }[] = [
	{
		id: 'shortcut',
		label: 'iPhone Shortcut',
		hint: 'Save links only',
		scopes: ['links:write']
	},
	{
		id: 'reader',
		label: 'Read-only agent',
		hint: 'Search links and read feeds; changes nothing',
		scopes: ['links:read', 'feeds:read']
	},
	{
		id: 'agent',
		label: 'Agent',
		hint: 'Read, save, edit and triage (every change is logged and can be undone)',
		scopes: ['links:read', 'links:write', 'feeds:read', 'feeds:write']
	}
];
