import { deserialize } from '$app/forms';
import { resolve } from '$app/paths';

/**
 * Posts to a page's form action from script, the way the readers record that
 * something was opened. Resolves true if the action succeeded.
 */
export async function postAction(path: string, fields: Record<string, string> = {}) {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	try {
		const response = await fetch(path, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		return deserialize(await response.text()).type === 'success';
	} catch {
		return false;
	}
}

/** Records that a link's URL was copied (Slice 12's "cited"). Best effort. */
export const citeLink = (id: string) => postAction(`${resolve('/links/[id]', { id })}?/cite`);

/** Records that a post's URL was copied. Best effort. */
export const citeEntry = (id: string) => postAction(`${resolve('/entries/[id]', { id })}?/cite`);
