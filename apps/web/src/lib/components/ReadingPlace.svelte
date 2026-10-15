<!--
	Keeps your place in a long read: saves the paragraph you're on as you scroll
	(and when you leave), brings you back to it next time, on any device, and
	clears it once you reach the end. Renders nothing; `progress` drives the
	reader's progress line.
-->
<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import {
		articleBlocks,
		countWords,
		currentBlock,
		progressAt,
		SAVE_EVERY_MS,
		STARTED,
		TOP_PX
	} from '$lib/place';
	import { postAction } from '$lib/signals';
	import { toast } from '$lib/toast.svelte';
	import { untrack } from 'svelte';

	let {
		target,
		action,
		saved,
		enabled,
		progress = $bindable(0)
	}: {
		/** The article body. */
		target: HTMLElement | undefined;
		/** The page's `?/place` action. */
		action: string;
		/** Where you left off last time, if you did. */
		saved: { block: number; progress: number } | null;
		/** Only long reads keep a place. */
		enabled: boolean;
		progress?: number;
	} = $props();

	/** Lines the block up at the top of the window. */
	const scrollToBlock = (el: HTMLElement) =>
		window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - TOP_PX });

	// Coming to the page (not back to it: the browser puts you where you were then).
	afterNavigate(({ type }) => {
		if (!enabled || !target || !saved || saved.block === 0 || type === 'popstate') return;
		if (window.scrollY > 40) return;
		const list = articleBlocks(target);
		const el = list[Math.min(saved.block, list.length - 1)];
		scrollToBlock(el);
		// Images above it load late and push it down; keep it in place until you scroll.
		const images = [...target.querySelectorAll('img')];
		let moved = false;
		const stopFollowing = () => (moved = true);
		const realign = () => !moved && scrollToBlock(el);
		const intents = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
		intents.forEach((name) => window.addEventListener(name, stopFollowing, { once: true }));
		images.forEach((img) => img.addEventListener('load', realign, { once: true }));
		setTimeout(() => {
			intents.forEach((name) => window.removeEventListener(name, stopFollowing));
			images.forEach((img) => img.removeEventListener('load', realign));
		}, 3000);
		toast.show({
			message: 'Back where you left off',
			action: {
				label: 'Start over',
				run: () => {
					window.scrollTo({ top: 0 });
					postAction(action, { finished: 'true' });
				}
			}
		});
	});

	$effect(() => {
		// Set up once per article; reloading the page's data (which brings a new
		// `saved`) doesn't start over.
		const root = target;
		const url = action;
		if (!root) return;
		const keep = untrack(() => enabled);
		const list = articleBlocks(root);
		const words = list.map((el) => countWords(el.textContent ?? ''));
		// What's been saved, so an unchanged place isn't posted again.
		let savedBlock = untrack(() => saved?.block ?? -1);
		let finished = false;
		let lastSave = 0;
		let pending: { block: number; progress: number } | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let frame = 0;

		function flush(keepalive = false) {
			clearTimeout(timer);
			if (!pending || !keep) return;
			const place = pending;
			pending = null;
			savedBlock = place.block;
			lastSave = Date.now();
			postAction(
				url,
				{ block: String(place.block), progress: place.progress.toFixed(4) },
				{ keepalive }
			);
		}

		function measure() {
			frame = 0;
			const block = currentBlock(list.map((el) => el.getBoundingClientRect().bottom));
			const atEnd = list[list.length - 1].getBoundingClientRect().bottom <= window.innerHeight;
			progress = atEnd ? 1 : progressAt(words, block);
			if (!keep || finished) return;
			if (atEnd) {
				// Read to the end: it's no longer in progress (scrolling back up won't undo that).
				finished = true;
				pending = null;
				clearTimeout(timer);
				if (savedBlock !== -1) postAction(url, { finished: 'true' });
				return;
			}
			if (progress < STARTED || block === savedBlock) return;
			pending = { block, progress };
			clearTimeout(timer);
			if (Date.now() - lastSave >= SAVE_EVERY_MS) flush();
			else timer = setTimeout(flush, SAVE_EVERY_MS);
		}

		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(measure);
		};
		const onHide = () => document.visibilityState === 'hidden' && flush(true);
		const onPageHide = () => flush(true);
		measure();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });
		document.addEventListener('visibilitychange', onHide);
		window.addEventListener('pagehide', onPageHide);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('pagehide', onPageHide);
			// Leaving for another page (Next, the inbox): save where you were.
			flush(true);
		};
	});
</script>
