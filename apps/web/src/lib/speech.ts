/**
 * Reading an article aloud with the device's own voices (the Web Speech API):
 * free, on-device, nothing sent anywhere. Pure helpers, so they can be tested.
 */

/**
 * Browsers cut off or stall on long utterances (Chrome after ~15 s), so text
 * is spoken in pieces of whole sentences up to about this many characters.
 */
export const MAX_UTTERANCE = 280;

/** Splits text into speakable pieces: whole sentences, packed up to `max` characters. */
export function splitSpeech(text: string, max = MAX_UTTERANCE): string[] {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (!clean) return [];
	const sentences = clean.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) ?? [clean];
	const pieces: string[] = [];
	let current = '';
	for (const sentence of sentences.flatMap((s) => (s.length > max ? splitLong(s, max) : [s]))) {
		if (current && current.length + sentence.length > max) {
			pieces.push(current.trim());
			current = '';
		}
		current += sentence;
	}
	if (current.trim()) pieces.push(current.trim());
	return pieces;
}

/** A sentence too long to speak in one go: break it after commas, else between words. */
function splitLong(sentence: string, max: number): string[] {
	const parts: string[] = [];
	let current = '';
	for (const word of sentence.split(/(?<=[,;:—]\s|\s)/)) {
		if (current && current.length + word.length > max) {
			parts.push(current);
			current = '';
		}
		current += word;
	}
	if (current) parts.push(current);
	return parts;
}

type Voice = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'voiceURI' | 'default' | 'localService'>;

/** How good a voice usually sounds: Apple's premium and enhanced voices first, novelty voices last. */
function quality(v: Voice): number {
	const id = `${v.voiceURI} ${v.name}`.toLowerCase();
	if (id.includes('premium')) return 4;
	if (id.includes('enhanced') || id.includes('natural')) return 3;
	// macOS and iOS novelty and legacy voices (Bubbles, Zarvox, Eloquence's Grandpa…).
	if (id.includes('speech.synthesis') || id.includes('eloquence')) return 0;
	if (v.default) return 2;
	return 1;
}

/**
 * The best voice for a language ("en", "en-US"): same language, best quality,
 * the exact region first, then on-device voices. Null when there's none.
 */
export function pickVoice<V extends Voice>(voices: V[], lang: string): V | null {
	const want = lang.toLowerCase();
	const base = want.split('-')[0];
	const matching = voices.filter(
		(v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === base
	);
	if (matching.length === 0) return null;
	const region = (v: V) => (v.lang.toLowerCase().replace('_', '-') === want ? 1 : 0);
	return [...matching].sort(
		(a, b) =>
			quality(b) - quality(a) ||
			region(b) - region(a) ||
			Number(b.localService) - Number(a.localService)
	)[0];
}

/** Reading speeds offered, cycled by the speed button. */
export const RATES = [1, 1.25, 1.5, 0.85] as const;

export const nextRate = (rate: number) =>
	RATES[(RATES.indexOf(rate as (typeof RATES)[number]) + 1) % RATES.length];
