<!--
	"Read to me": reads the article aloud with the device's own voices (Web
	Speech API), a paragraph at a time, highlighting the one being read. Free and
	on-device. iOS stops speaking when the screen locks or the app is left.
-->
<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import { nextRate, pickVoice, RATES, splitSpeech } from '$lib/speech';

	let { title, target }: { title: string; target: HTMLElement | undefined } = $props();

	// What gets read, innermost first, so a <p> inside a <blockquote> is read once.
	const BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, dt, dd';
	const RATE_KEY = 'readAloudRate';
	// Room the pinned controls take at the top of the screen.
	const BAR = 72;

	type Item = { el: HTMLElement | null; parts: string[] };

	let supported = $state(false);
	let status = $state<'idle' | 'playing' | 'paused'>('idle');
	let rate = $state<number>(RATES[0]);
	let index = $state(0);
	let items: Item[] = $state([]);
	// Bumped on every start, pause and stop, so callbacks from a cancelled
	// utterance (which still fire) know to do nothing.
	let run = 0;
	// Held until they finish so the browser doesn't garbage-collect one
	// mid-sentence, which silently stops it (a Chrome bug).
	// Bookkeeping only, nothing renders from it, so a plain Set.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const speaking = new Set<SpeechSynthesisUtterance>();
	let marked: HTMLElement | null = null;
	// When we last scrolled to follow along; a smooth scroll still under way
	// shouldn't read as you having scrolled away.
	let followedAt = 0;

	onMount(() => {
		supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
		try {
			const saved = Number(localStorage.getItem(RATE_KEY));
			if ((RATES as readonly number[]).includes(saved)) rate = saved;
		} catch {
			// Storage blocked (private browsing): keep the default speed.
		}
		// iOS stops speaking in the background; pause so Resume picks up cleanly.
		const onHide = () => document.visibilityState === 'hidden' && status === 'playing' && pause();
		document.addEventListener('visibilitychange', onHide);
		return () => {
			document.removeEventListener('visibilitychange', onHide);
			stop();
		};
	});

	// Leaving the page (or going to the next post, which reuses this component) stops reading.
	beforeNavigate(() => stop());

	function collect(root: HTMLElement): Item[] {
		const found = [...root.querySelectorAll<HTMLElement>(BLOCKS)].filter(
			(el) => !el.querySelector(BLOCKS) && !el.closest('pre')
		);
		const blocks = (found.length ? found : [root])
			.map((el) => ({ el, parts: splitSpeech(el.innerText) }))
			.filter((item) => item.parts.length);
		return [{ el: null, parts: splitSpeech(title) }, ...blocks];
	}

	/** Where to start: the title at the top of the page, else the first paragraph in view. */
	function startIndex(list: Item[]): number {
		if (!target || target.getBoundingClientRect().top > BAR) return 0;
		const i = list.findIndex((item) => item.el && item.el.getBoundingClientRect().bottom > BAR);
		return Math.max(i, 0);
	}

	const inView = (el: HTMLElement) => {
		const r = el.getBoundingClientRect();
		return r.bottom > BAR && r.top < window.innerHeight;
	};

	/** Highlights the paragraph being read, and scrolls to it if you were following along. */
	function mark(el: HTMLElement | null) {
		const following = !marked || inView(marked) || Date.now() - followedAt < 1000;
		marked?.classList.remove('reading-now');
		marked = el;
		if (!el) return;
		el.classList.add('reading-now');
		const r = el.getBoundingClientRect();
		if (following && (r.top < BAR || r.bottom > window.innerHeight - 96)) {
			followedAt = Date.now();
			el.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	}

	function speakItem() {
		const id = ++run;
		const item = items[index];
		if (!item) return stop();
		mark(item.el);
		speakPart(item.parts, 0, id);
	}

	function speakPart(parts: string[], i: number, id: number) {
		if (i >= parts.length) {
			index++;
			speakItem();
			return;
		}
		const u = new SpeechSynthesisUtterance(parts[i]);
		const lang = document.documentElement.lang || navigator.language || 'en';
		const voice = pickVoice(speechSynthesis.getVoices(), lang);
		if (voice) u.voice = voice;
		u.lang = voice?.lang ?? lang;
		u.rate = rate;
		u.onend = () => {
			speaking.delete(u);
			if (id === run && status === 'playing') speakPart(parts, i + 1, id);
		};
		u.onerror = (event) => {
			speaking.delete(u);
			if (id !== run || event.error === 'interrupted' || event.error === 'canceled') return;
			stop();
		};
		speaking.add(u);
		speechSynthesis.speak(u);
	}

	function start() {
		if (!target) return;
		speechSynthesis.cancel();
		items = collect(target);
		index = startIndex(items);
		status = 'playing';
		speakItem();
	}

	function pause() {
		run++;
		status = 'paused';
		speechSynthesis.cancel();
	}

	/** Picks up at the start of the paragraph that was being read. */
	function resume() {
		status = 'playing';
		speakItem();
	}

	function stop() {
		run++;
		if (status !== 'idle') speechSynthesis.cancel();
		status = 'idle';
		speaking.clear();
		marked?.classList.remove('reading-now');
		marked = null;
	}

	function changeRate() {
		rate = nextRate(rate);
		try {
			localStorage.setItem(RATE_KEY, String(rate));
		} catch {
			// Not remembered, but still used for this article.
		}
		// Restart the current paragraph so the new speed is heard right away.
		if (status === 'playing') {
			run++;
			speechSynthesis.cancel();
			speakItem();
		}
	}

	const control =
		'flex h-10 items-center justify-center gap-1.5 rounded-full border px-3.5 font-ui text-sm font-bold';
</script>

{#if supported}
	{#if status === 'idle'}
		<button
			type="button"
			onclick={start}
			class="{control} mt-5 w-fit border-rule-strong text-ink hover:border-ink"
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
				><path d="M7 4.5v15l12.5-7.5z" /></svg
			>
			Read to me
		</button>
	{:else}
		<div
			role="group"
			aria-label="Reading aloud"
			class="sticky top-0 z-20 -mx-5.5 mt-5 flex items-center gap-2 border-b border-rule bg-paper/95 px-5.5 py-2.5 backdrop-blur"
		>
			{#if status === 'playing'}
				<button
					type="button"
					onclick={pause}
					class="{control} border-ink bg-ink text-paper hover:bg-accent-strong"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
						><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg
					>
					Pause
				</button>
			{:else}
				<button
					type="button"
					onclick={resume}
					class="{control} border-ink bg-ink text-paper hover:bg-accent-strong"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
						><path d="M7 4.5v15l12.5-7.5z" /></svg
					>
					Resume
				</button>
			{/if}
			<button
				type="button"
				onclick={changeRate}
				aria-label="Reading speed {rate}×, change"
				class="{control} min-w-16 border-rule-strong text-ink tabular-nums hover:border-ink"
				>{rate}×</button
			>
			<span class="flex-1 truncate font-ui text-[0.8125rem] text-ink-3" aria-live="polite">
				{index === 0 ? 'Title' : `${index} of ${items.length - 1}`}
			</span>
			<button
				type="button"
				onclick={stop}
				aria-label="Stop reading"
				class="{control} w-10 border-rule-strong px-0 text-ink hover:border-ink"
			>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
					><path d="M5 5h14v14H5z" /></svg
				>
			</button>
		</div>
	{/if}
{/if}
