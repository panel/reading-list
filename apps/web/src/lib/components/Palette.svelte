<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { highlightSegments } from '$lib/format';
	import { ignoreShortcut } from '$lib/keys';
	import { palette } from '$lib/palette.svelte';
	import { toast } from '$lib/toast.svelte';

	interface Result {
		id: string;
		url: string;
		title: string;
		site: string;
		isReference: boolean;
		snippet: string | null;
	}

	let dialog = $state<HTMLDialogElement>();
	let input = $state<HTMLInputElement>();
	let q = $state('');
	let results = $state<Result[]>([]);
	let selected = $state(0);
	let loading = $state(false);
	let controller: AbortController | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (!dialog) return;
		if (palette.open && !dialog.open) {
			dialog.showModal();
			input?.select();
		} else if (!palette.open && dialog.open) {
			dialog.close();
		}
	});

	// The query the current results belong to, so Enter never acts on stale ones.
	let resultsFor = '';

	async function fetchResults(value: string) {
		controller?.abort();
		controller = new AbortController();
		loading = true;
		try {
			const response = await fetch(`${resolve('/search/palette')}?q=${encodeURIComponent(value)}`, {
				signal: controller.signal
			});
			results = ((await response.json()) as { results: Result[] }).results;
			resultsFor = value;
			selected = 0;
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				results = [];
				resultsFor = value;
			}
		} finally {
			loading = false;
		}
	}

	function search(value: string) {
		clearTimeout(timer);
		if (!value.trim()) {
			controller?.abort();
			results = [];
			resultsFor = value;
			loading = false;
			return;
		}
		timer = setTimeout(() => fetchResults(value), 120);
	}

	/** Results for exactly what's typed now, fetching them first if they're still pending. */
	async function currentResults(): Promise<Result[]> {
		if (resultsFor !== q) {
			clearTimeout(timer);
			await fetchResults(q);
		}
		return results;
	}

	async function copy(result: Result) {
		await navigator.clipboard.writeText(result.url);
		palette.open = false;
		toast.show({ message: `Copied · ${result.title}` });
	}

	function open(result: Result) {
		palette.open = false;
		goto(resolve('/links/[id]', { id: result.id }));
	}

	function onDialogKey(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!results.length) return;
			selected =
				(selected + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
			document.getElementById(`palette-${selected}`)?.scrollIntoView({ block: 'nearest' });
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const openIt = event.metaKey || event.ctrlKey;
			currentResults().then((list) => {
				const result = list[selected] ?? list[0];
				if (!result) return;
				if (openIt) open(result);
				else copy(result);
			});
		}
	}

	function onWindowKey(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			palette.open = !palette.open;
		} else if (event.key === '/' && !palette.open && !ignoreShortcut(event)) {
			event.preventDefault();
			palette.open = true;
		}
	}
</script>

<svelte:window onkeydown={onWindowKey} />

<dialog
	bind:this={dialog}
	onclose={() => (palette.open = false)}
	onclick={(e) => e.target === dialog && (palette.open = false)}
	aria-label="Find a link"
	class="mx-auto mt-[12vh] w-[min(40rem,calc(100vw-1.5rem))] rounded-lg border border-rule bg-paper p-0 text-ink shadow-[0_24px_64px_rgb(21_32_32/0.25)] backdrop:bg-ink/30"
>
	<div class="flex items-center gap-3 border-b border-rule px-4">
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
			class="shrink-0 text-ink-3"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg
		>
		<input
			bind:this={input}
			bind:value={q}
			oninput={() => search(q)}
			onkeydown={onDialogKey}
			type="text"
			role="combobox"
			aria-expanded={results.length > 0}
			aria-controls="palette-results"
			aria-activedescendant={results.length ? `palette-${selected}` : undefined}
			aria-label="Find a link"
			autocomplete="off"
			autocapitalize="none"
			spellcheck="false"
			placeholder="Find a link to copy…"
			class="h-14 min-w-0 flex-1 bg-transparent font-ui text-lg text-ink placeholder:text-ink-3 focus:outline-none"
		/>
		<kbd class="hidden rounded border border-rule px-1.5 font-ui text-xs text-ink-3 sm:block"
			>esc</kbd
		>
	</div>

	{#if results.length}
		<ul id="palette-results" role="listbox" class="max-h-[50vh] overflow-y-auto py-1.5">
			{#each results as result, i (result.id)}
				<li
					id="palette-{i}"
					role="option"
					aria-selected={i === selected}
					class="flex cursor-pointer items-center gap-3 px-4 py-2.5 {i === selected
						? 'bg-sunk'
						: ''}"
					onmouseenter={() => (selected = i)}
					onclick={() => copy(result)}
					onkeydown={() => {}}
				>
					<div class="flex min-w-0 flex-1 flex-col gap-0.5">
						<span class="kicker text-[0.625rem] text-accent"
							>{result.site}{#if result.isReference}<span class="text-ink-3"> · ★</span>{/if}</span
						>
						<span class="truncate headline text-base leading-snug">{result.title}</span>
						{#if result.snippet}
							<span class="truncate text-[0.8125rem] text-ink-2"
								>{#each highlightSegments(result.snippet) as seg, j (j)}{#if seg.match}<mark
											class="rounded-sm bg-accent/15 px-0.5 text-ink">{seg.text}</mark
										>{:else}{seg.text}{/if}{/each}</span
							>
						{/if}
					</div>
					{#if i === selected}
						<span class="shrink-0 font-ui text-xs text-ink-3">↵ copy</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if q.trim() && !loading}
		<p class="px-4 py-6 text-center font-ui text-sm text-ink-3">No links match “{q}”.</p>
	{/if}

	<p
		class="flex flex-wrap justify-between gap-2 border-t border-rule px-4 py-2.5 font-ui text-xs text-ink-3"
	>
		<span>↑↓ choose · ↵ copy link · ⌘↵ open</span>
		<a
			href="{resolve('/search')}?q={encodeURIComponent(q)}"
			onclick={() => (palette.open = false)}
			class="font-bold text-accent hover:underline">All results →</a
		>
	</p>
</dialog>
