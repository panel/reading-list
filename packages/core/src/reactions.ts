/**
 * How strongly the user reacted to something they read (Slice 13: the reading
 * digest), from what they did with it rather than what a model guesses.
 */

export interface ReadingSignals {
	/** They wrote a note on it: their own words, the strongest sign there is. */
	note: boolean;
	starred: boolean;
	/** Times they copied its link to share or cite it. */
	cites: number;
	opened: boolean;
	/** Finished (Done), with or without opening it. */
	done: boolean;
}

/** Higher means a stronger reaction. Ranks the digest. */
export function reactionScore(s: ReadingSignals): number {
	return (
		(s.note ? 3 : 0) +
		(s.starred ? 3 : 0) +
		Math.min(s.cites, 3) * 2 +
		(s.opened ? 1 : 0) +
		(s.done ? 0.5 : 0)
	);
}

/** The same signals in words, so an agent can say why it picked something. */
export function reactionReasons(s: ReadingSignals): string[] {
	const reasons: string[] = [];
	if (s.note) reasons.push('wrote a note');
	if (s.starred) reasons.push('starred it');
	if (s.cites > 0) reasons.push(s.cites === 1 ? 'shared the link' : `shared the link ${s.cites}×`);
	if (s.opened) reasons.push('opened it');
	if (s.done) reasons.push('finished it');
	return reasons;
}
