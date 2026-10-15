<!--
	Highlights in a reader. Select text in the article and a Highlight button
	appears; it saves the passage (list items keep their bullets or numbers),
	with a note if you want one. Saved passages are marked in the text (CSS
	Custom Highlights, where the browser has them) and listed after the article
	with their notes and when you saved them.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { joinPieces, listMarker, locate, savedAt, type Piece } from '$lib/highlight';
	import { relativeDay } from '$lib/format';
	import { articleBlocks, TOP_PX } from '$lib/place';
	import { toast } from '$lib/toast.svelte';

	interface Saved {
		id: string;
		text: string;
		note: string | null;
		block: number;
		createdAt: Date;
	}

	let {
		target,
		page,
		highlights
	}: {
		/** The article body. */
		target: HTMLElement | undefined;
		/** The reader's own path; its actions are `?/highlight` and friends. */
		page: string;
		highlights: Saved[];
	} = $props();

	/** The selection in the article, ready to save. */
	let selected = $state<{ text: string; block: number } | null>(null);
	/** The selection being saved, while the note sheet is open. */
	let composing = $state<{ text: string; block: number } | null>(null);
	let editing = $state<string | null>(null);
	let saving = $state(false);
	let noteField = $state<HTMLTextAreaElement>();
	/** Where each saved highlight is in the article, for Show. */
	let ranges = $state.raw(new Map<string, Range>());

	const supportsMarks = () => typeof CSS !== 'undefined' && 'highlights' in CSS;

	/** Walks the selected part of the article: its text, and where blocks begin. */
	function selectionPieces(range: Range, root: HTMLElement): Piece[] {
		const blocks = new Set<Node>(articleBlocks(root));
		const pieces: Piece[] = [];
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!range.intersectsNode(node)) continue;
			if (node instanceof Text) {
				const start = node === range.startContainer ? range.startOffset : 0;
				const end = node === range.endContainer ? range.endOffset : node.data.length;
				pieces.push({ kind: 'text', text: node.data.slice(start, end) });
			} else if (node instanceof HTMLLIElement && blocks.has(node)) {
				const list = node.parentElement;
				const ordered = list instanceof HTMLOListElement;
				const items = list ? [...list.children].filter((el) => el.tagName === 'LI') : [node];
				const marker = listMarker(
					ordered,
					ordered ? list.start : 1,
					items.indexOf(node),
					ordered && list.reversed
				);
				pieces.push({ kind: 'block', marker });
			} else if (blocks.has(node) || node.nodeName === 'BR') {
				pieces.push({ kind: 'block' });
			}
		}
		return pieces;
	}

	/** The text the article's text nodes add up to, and where each starts. */
	function textIndex(root: HTMLElement) {
		const nodes: { node: Text; start: number }[] = [];
		let text = '';
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			nodes.push({ node: node as Text, start: text.length });
			text += (node as Text).data;
		}
		return { text, nodes };
	}

	function rangeAt(nodes: { node: Text; start: number }[], start: number, end: number) {
		const at = (offset: number, isEnd: boolean) => {
			// The text node holding this offset (an end may sit at a node's very end).
			for (let i = nodes.length - 1; i >= 0; i--) {
				const { node, start: s } = nodes[i];
				if (isEnd ? s < offset : s <= offset)
					return { node, offset: Math.min(offset - s, node.data.length) };
			}
			return { node: nodes[0].node, offset: 0 };
		};
		const a = at(start, false);
		const b = at(end, true);
		const range = document.createRange();
		range.setStart(a.node, a.offset);
		range.setEnd(b.node, b.offset);
		return range;
	}

	// Keep track of a selection inside the article (not the note sheet, not the page).
	$effect(() => {
		const root = target;
		if (!root) return;
		const onChange = () => {
			const selection = document.getSelection();
			if (!selection || selection.isCollapsed || !selection.rangeCount) {
				selected = null;
				return;
			}
			const range = selection.getRangeAt(0);
			if (!root.contains(range.commonAncestorContainer)) {
				selected = null;
				return;
			}
			const text = joinPieces(selectionPieces(range, root));
			const block = articleBlocks(root).findIndex((el) => range.intersectsNode(el));
			selected = text ? { text, block: Math.max(0, block) } : null;
		};
		document.addEventListener('selectionchange', onChange);
		return () => document.removeEventListener('selectionchange', onChange);
	});

	// Mark the saved passages in the text.
	$effect(() => {
		const root = target;
		const list = highlights;
		if (!root) return;
		const { text, nodes } = textIndex(root);
		if (!nodes.length) return;
		const blocks = articleBlocks(root);
		// Built here and handed over whole; nothing reads it while it's built.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const found = new Map<string, Range>();
		for (const h of list) {
			const block = blocks[Math.min(h.block, blocks.length - 1)];
			const first = nodes.find(({ node }) => block.contains(node));
			const at = locate(text, h.text, first?.start ?? 0);
			if (at) found.set(h.id, rangeAt(nodes, at[0], at[1]));
		}
		ranges = found;
		if (!supportsMarks()) return;
		CSS.highlights.set('saved-highlight', new Highlight(...found.values()));
		return () => CSS.highlights.delete('saved-highlight');
	});

	async function compose() {
		if (!selected) return;
		composing = selected;
		await tick();
		noteField?.focus({ preventScroll: true });
	}

	function close() {
		composing = null;
	}

	function show(id: string) {
		const range = ranges.get(id);
		if (!range) return;
		const top = range.getBoundingClientRect().top + window.scrollY;
		window.scrollTo({ top: top - TOP_PX * 4, behavior: 'smooth' });
		const selection = document.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	const save: SubmitFunction = () => {
		saving = true;
		return async ({ result, update }) => {
			saving = false;
			if (result.type === 'success') {
				composing = null;
				selected = null;
				document.getSelection()?.removeAllRanges();
				toast.show({ message: 'Highlight saved' });
			} else if (result.type === 'failure') {
				toast.show({ message: String(result.data?.message ?? 'Couldn’t save that highlight') });
			}
			await update({ reset: false });
		};
	};

	const afterNote: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				editing = null;
				toast.show({ message: 'Note saved' });
			} else if (result.type === 'failure') {
				toast.show({ message: String(result.data?.message ?? 'Couldn’t save that note') });
			}
		};

	const remove: SubmitFunction = ({ cancel }) => {
		if (!confirm('Delete this highlight and its note?')) return cancel();
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success') toast.show({ message: 'Highlight deleted' });
		};
	};

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && composing) {
			event.preventDefault();
			close();
		}
	}

	const fieldClass =
		'w-full resize-y rounded-md border border-rule-strong bg-surface px-3.5 py-3 text-[1.0625rem] leading-[1.55] placeholder:text-ink-3 focus:border-accent focus:outline-none';
</script>

<svelte:window {onkeydown} />

{#if selected && !composing}
	<!-- Above the action bar and its toasts, clear of the phone's own copy/look-up menu over the selection. -->
	<div
		class="pointer-events-none fixed inset-x-0 bottom-[calc(12rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3.5 lg:bottom-36"
	>
		<button
			type="button"
			onpointerdown={(event) => event.preventDefault()}
			onclick={compose}
			class="pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-ink px-5 font-ui text-[0.9375rem] font-bold text-paper shadow-lg hover:bg-accent-strong"
		>
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path d="M9 11l-6 6v3h9l3-3" /><path
					d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"
				/></svg
			>
			Highlight
		</button>
	</div>
{/if}

{#if composing}
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="highlight-heading"
		class="fixed inset-0 z-50 flex items-end justify-center bg-ink/25 lg:items-center"
	>
		<button
			type="button"
			aria-label="Cancel"
			class="absolute inset-0 cursor-default"
			onclick={close}
		></button>
		<form
			method="POST"
			action="{page}?/highlight"
			use:enhance={save}
			class="relative flex max-h-[85vh] w-full max-w-[44rem] flex-col gap-3 rounded-t-xl border-t border-rule bg-paper px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:rounded-xl lg:border"
		>
			<h2 id="highlight-heading" class="kicker text-accent">Save highlight</h2>
			<blockquote
				class="max-h-[30vh] overflow-y-auto border-l-2 border-accent pl-3.5 text-[1.0625rem] leading-[1.55] whitespace-pre-line text-ink"
			>
				{composing.text}
			</blockquote>
			<input type="hidden" name="text" value={composing.text} />
			<input type="hidden" name="block" value={composing.block} />
			<label for="highlight-note" class="sr-only">Note (optional)</label>
			<textarea
				bind:this={noteField}
				id="highlight-note"
				name="note"
				rows="3"
				placeholder="Add a note (optional)"
				class={fieldClass}></textarea>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					onclick={close}
					class="h-11 rounded-md px-4 font-ui text-sm font-bold text-ink-2 hover:text-ink"
					>Cancel</button
				>
				<button
					disabled={saving}
					class="h-11 rounded-md bg-ink px-5 font-ui text-sm font-bold text-paper hover:bg-accent-strong disabled:opacity-60"
					>Save highlight</button
				>
			</div>
		</form>
	</div>
{/if}

{#if highlights.length}
	<section
		class="mt-6 flex flex-col gap-3 border-t border-rule pt-3.5"
		aria-labelledby="highlights-heading"
	>
		<h2 id="highlights-heading" class="kicker text-ink-2">
			Your highlights <span class="text-ink-3">· {highlights.length}</span>
		</h2>
		<ul class="flex flex-col gap-4">
			{#each highlights as h (h.id)}
				<li
					class="flex flex-col gap-2 rounded-md bg-surface px-4 py-3.5 shadow-[0_0_0_1px_var(--color-rule)]"
				>
					<blockquote
						class="border-l-2 border-accent pl-3.5 text-[1.0625rem] leading-[1.55] whitespace-pre-line"
					>
						{h.text}
					</blockquote>
					{#if editing === h.id}
						<form
							method="POST"
							action="{page}?/highlightNote"
							use:enhance={afterNote}
							class="flex flex-col gap-2"
						>
							<input type="hidden" name="id" value={h.id} />
							<label for="note-{h.id}" class="sr-only">Note</label>
							<!-- svelte-ignore a11y_autofocus -->
							<textarea
								id="note-{h.id}"
								name="note"
								rows="3"
								autofocus
								placeholder="Add a note"
								class={fieldClass}>{h.note ?? ''}</textarea
							>
							<div class="flex justify-end gap-2">
								<button
									type="button"
									onclick={() => (editing = null)}
									class="h-10 rounded-md px-3.5 font-ui text-sm font-bold text-ink-2 hover:text-ink"
									>Cancel</button
								>
								<button
									class="h-10 rounded-md bg-ink px-4 font-ui text-sm font-bold text-paper hover:bg-accent-strong"
									>Save</button
								>
							</div>
						</form>
					{:else if h.note}
						<p class="text-base leading-[1.55] whitespace-pre-line text-ink-2">{h.note}</p>
					{/if}
					<div class="flex flex-wrap items-center gap-x-3 font-ui text-[0.8125rem] text-ink-3">
						<time datetime={h.createdAt.toISOString()}
							>{savedAt(h.createdAt, relativeDay(h.createdAt))}</time
						>
						<span class="flex-1"></span>
						{#if ranges.has(h.id)}
							<button
								type="button"
								onclick={() => show(h.id)}
								class="h-9 font-bold text-accent hover:underline">Show</button
							>
						{/if}
						{#if editing !== h.id}
							<button
								type="button"
								onclick={() => (editing = h.id)}
								class="h-9 font-bold text-accent hover:underline"
								>{h.note ? 'Edit note' : 'Add note'}</button
							>
						{/if}
						<form method="POST" action="{page}?/unhighlight" use:enhance={remove}>
							<input type="hidden" name="id" value={h.id} />
							<button class="h-9 hover:text-[#9b2c1f] hover:underline">Delete</button>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
