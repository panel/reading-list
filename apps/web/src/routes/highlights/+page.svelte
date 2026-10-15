<script lang="ts">
	import { resolve } from '$app/paths';
	import { hostname, relativeDay } from '$lib/format';
	import { savedAt } from '$lib/highlight';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();
	type Item = (typeof data.highlights)[number];

	/** Highlights in a row from the same article share its heading. */
	const groups = $derived(
		data.highlights.reduce<Item[][]>((out, h) => {
			const last = out.at(-1);
			if (last && last[0].itemKind === h.itemKind && last[0].itemId === h.itemId) last.push(h);
			else out.push([h]);
			return out;
		}, [])
	);

	const href = (h: Item) =>
		h.itemKind === 'post'
			? resolve('/entries/[id]', { id: h.itemId })
			: resolve('/links/[id]', { id: h.itemId });

	const titleOf = (h: Item) => h.title ?? (h.url ? hostname(h.url) : 'Untitled');

	/** The passage, then where it's from, ready to paste. */
	async function copy(h: Item) {
		const from = [titleOf(h), h.url].filter(Boolean).join(' ');
		await navigator.clipboard.writeText(`“${h.text}”\n— ${from}`);
		toast.show({ message: 'Highlight copied' });
	}
</script>

<svelte:head>
	<title>Highlights · Reading List</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-5 pt-5 pb-10 lg:pt-10">
	<header class="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
		<div>
			<h1 class="headline text-[2.1rem] leading-[1.05] lg:text-5xl">Highlights</h1>
			<p class="mt-1.5 font-ui text-[0.9375rem] text-ink-2">
				{data.total}
				{data.total === 1 ? 'passage' : 'passages'} you saved while reading, newest first
			</p>
		</div>
		<a href={resolve('/library')} class="font-ui text-sm font-bold text-accent hover:underline"
			>Library →</a
		>
	</header>

	{#if data.highlights.length === 0}
		<p class="py-12 text-center text-[1.0625rem] text-ink-2 italic">
			Nothing here yet. Select some text in an article and tap Highlight.
		</p>
	{:else}
		{#each groups as group (group[0].id)}
			<section class="flex flex-col gap-3 border-b border-rule py-5">
				<a href={href(group[0])} class="group flex flex-col gap-1">
					{#if group[0].url}
						<span class="kicker text-[0.6875rem] text-accent">{hostname(group[0].url)}</span>
					{/if}
					<h2 class="headline text-[1.375rem] leading-[1.15] group-hover:text-accent-strong">
						{titleOf(group[0])}
					</h2>
				</a>
				<ul class="flex flex-col gap-4">
					{#each group as h (h.id)}
						<li class="flex flex-col gap-2">
							<blockquote
								class="border-l-2 border-accent pl-3.5 text-[1.0625rem] leading-[1.55] whitespace-pre-line"
							>
								{h.text}
							</blockquote>
							{#if h.note}
								<p class="pl-4 text-base leading-[1.55] whitespace-pre-line text-ink-2">
									{h.note}
								</p>
							{/if}
							<div class="flex items-center gap-3 pl-4 font-ui text-[0.8125rem] text-ink-3">
								<time datetime={h.createdAt.toISOString()}
									>{savedAt(h.createdAt, relativeDay(h.createdAt))}</time
								>
								<button
									type="button"
									onclick={() => copy(h)}
									class="h-9 font-bold text-accent hover:underline">Copy</button
								>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/each}

		{#if data.pageCount > 1}
			<nav class="flex justify-between py-6 font-ui text-sm font-bold" aria-label="Pages">
				{#if data.page > 1}
					<a
						href="{resolve('/highlights')}?page={data.page - 1}"
						class="text-accent hover:underline">← Newer</a
					>
				{:else}<span></span>{/if}
				{#if data.page < data.pageCount}
					<a
						href="{resolve('/highlights')}?page={data.page + 1}"
						class="text-accent hover:underline">Older →</a
					>
				{/if}
			</nav>
		{/if}
	{/if}
</div>
