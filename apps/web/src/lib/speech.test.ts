import { describe, expect, it } from 'vitest';
import { nextRate, pickVoice, splitSpeech } from './speech';

describe('splitSpeech', () => {
	it('keeps short text whole and tidies whitespace', () => {
		expect(splitSpeech('  One sentence.\n Two  sentences! ')).toEqual([
			'One sentence. Two sentences!'
		]);
		expect(splitSpeech('   ')).toEqual([]);
	});

	it('packs whole sentences up to the limit', () => {
		const text = 'Alpha beta gamma. Delta epsilon zeta? Eta theta iota.';
		expect(splitSpeech(text, 40)).toEqual([
			'Alpha beta gamma. Delta epsilon zeta?',
			'Eta theta iota.'
		]);
	});

	it('keeps closing quotes with their sentence and handles a last sentence without a stop', () => {
		expect(splitSpeech('He said “stop.” Then nothing', 20)).toEqual([
			'He said “stop.”',
			'Then nothing'
		]);
	});

	it('breaks an over-long sentence after commas or between words, never mid-word', () => {
		const long = `${'word '.repeat(40)}end, and then ${'more '.repeat(30)}words.`;
		const pieces = splitSpeech(long, 60);
		expect(pieces.every((p) => p.length <= 60)).toBe(true);
		expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' ').trim());
	});
});

describe('pickVoice', () => {
	const v = (name: string, lang: string, voiceURI = name, extra = {}) => ({
		name,
		lang,
		voiceURI,
		default: false,
		localService: true,
		...extra
	});

	it('prefers premium and enhanced voices in the language', () => {
		const voices = [
			v('Samantha', 'en-US', 'com.apple.voice.compact.en-US.Samantha'),
			v('Zoe', 'en-US', 'com.apple.voice.premium.en-US.Zoe'),
			v('Ava', 'en-US', 'com.apple.voice.enhanced.en-US.Ava'),
			v('Thomas', 'fr-FR', 'com.apple.voice.premium.fr-FR.Thomas')
		];
		expect(pickVoice(voices, 'en')?.name).toBe('Zoe');
	});

	it('avoids novelty voices and prefers the exact region', () => {
		const voices = [
			v('Bubbles', 'en-US', 'com.apple.speech.synthesis.voice.Bubbles'),
			v('Daniel', 'en-GB'),
			v('Fred', 'en-US')
		];
		expect(pickVoice(voices, 'en-US')?.name).toBe('Fred');
		expect(pickVoice(voices, 'en-GB')?.name).toBe('Daniel');
	});

	it('matches Android-style language tags and returns null without a match', () => {
		expect(pickVoice([v('Android', 'en_US')], 'en')?.name).toBe('Android');
		expect(pickVoice([v('Thomas', 'fr-FR')], 'en')).toBeNull();
	});
});

describe('nextRate', () => {
	it('cycles through the speeds', () => {
		expect([1, 1.25, 1.5, 0.85].map(nextRate)).toEqual([1.25, 1.5, 0.85, 1]);
		expect(nextRate(2)).toBe(1);
	});
});
