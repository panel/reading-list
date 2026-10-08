import type { Question } from './decide';
import type { Profile, ProfileItem } from './profile';

/** One inbox item, as the decision model sees it. */
export interface ItemForModel {
	kind: 'post' | 'link';
	title: string;
	source: string;
	author?: string | null;
	/** The reader's own note on a shared link. */
	note?: string | null;
	/** The article text (or a summary), plain. */
	text?: string | null;
}

/** The two questions 12c asks about every item. Categories join them in 12d. */
export const QUESTIONS = {
	open: {
		type: 'noul',
		instructions:
			'Given this reader’s history, will they open and read this item, rather than clear it from their inbox unread?'
	},
	keep: {
		type: 'noul',
		instructions:
			'Given the items this reader has starred before, will they star this item to keep it as a long-term reference?'
	}
} satisfies Record<string, Question>;

const TEXT_WORDS = 1000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function list(items: ProfileItem[]) {
	if (!items.length) return '- (none yet)';
	return items.map((i) => `- ${clip(i.title, 140)}${i.source ? ` (${i.source})` : ''}`).join('\n');
}

/** The first `words` words of a text, whitespace collapsed. */
export function firstWords(text: string, words = TEXT_WORDS) {
	const all = text.split(/\s+/).filter(Boolean);
	return all.length > words ? `${all.slice(0, words).join(' ')} …` : all.join(' ');
}

/** The state sent with the questions: the reader's history, then the item. */
export function formatState(profile: Profile, item: ItemForModel): string {
	const feeds = profile.feeds.length
		? profile.feeds
				.map((f) => `- ${f.name}: opened ${f.opened} of ${f.opened + f.skipped}`)
				.join('\n')
		: '- (no history yet)';
	const lines = [
		'# The reader',
		'How often they open posts from each feed they follow (last 90 days):',
		feeds,
		'',
		'Recently starred to keep as long-term references:',
		list(profile.starred),
		'',
		'Recently opened and read:',
		list(profile.opened),
		'',
		'Recently cleared from the inbox without opening:',
		list(profile.skipped),
		'',
		'# The item',
		`Kind: ${
			item.kind === 'post'
				? 'a new post from a feed they follow'
				: 'a link they saved to their own reading list themselves'
		}`,
		`Source: ${item.source}`,
		`Title: ${clip(item.title, 300)}`
	];
	if (item.author) lines.push(`Author: ${item.author}`);
	if (item.note) lines.push(`Their note: ${clip(item.note, 1000)}`);
	if (item.text) lines.push('', firstWords(item.text));
	return lines.join('\n');
}
