<script lang="ts">
	import { resolve } from '$app/paths';
	import { displayTitle, highlightSegments, relativeDay, siteLabel } from '$lib/format';
	import { toast } from '$lib/toast.svelte';
	import type { SearchResult } from '$lib/server/search';

	let { result }: { result: SearchResult } = $props();

	const status = $derived(
		[
			result.status === 'queued'
				? 'In inbox'
				: `Done ${result.readAt ? relativeDay(result.readAt) : ''}`,
			result.isReference ? '★ Reference' : null
		]
			.filter(Boolean)
			.join(' · ')
	);

	async function copy() {
		await navigator.clipboard.writeText(result.url);
		toast.show({ message: `Copied · ${displayTitle(result)}` });
	}
</script>

<li class="flex gap-3 border-b border-rule py-4">
	<div class="flex min-w-0 flex-1 flex-col gap-1.5">
		<span class="kicker text-[0.6875rem] text-accent"
			>{siteLabel(result)} <span class="text-ink-3">· {status}</span></span
		>
		<a
			href={resolve('/links/[id]', { id: result.id })}
			class="headline text-[1.3125rem] leading-[1.15] hover:text-accent-strong"
			>{displayTitle(result)}</a
		>
		{#if result.snippet}
			<p class="line-clamp-3 text-[0.9375rem] leading-[1.5] text-ink-2">
				{#each highlightSegments(result.snippet) as seg, i (i)}{#if seg.match}<mark
							class="rounded-sm bg-accent/15 px-0.5 text-ink">{seg.text}</mark
						>{:else}{seg.text}{/if}{/each}
			</p>
		{:else if result.note}
			<p class="line-clamp-2 text-[0.9375rem] leading-[1.5] text-ink-2">{result.note}</p>
		{/if}
		{#if result.tags.length}
			<p class="font-ui text-[0.8125rem] text-ink-3">
				{result.tags.map((t) => `#${t}`).join('  ')}
			</p>
		{/if}
	</div>
	<button
		type="button"
		onclick={copy}
		aria-label="Copy link to {displayTitle(result)}"
		class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-rule-strong text-ink hover:border-ink"
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
			><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path
				d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
			/></svg
		>
	</button>
</li>
