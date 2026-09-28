<script lang="ts">
	import { resolve } from '$app/paths';
	import SearchResult from '$lib/components/SearchResult.svelte';

	let { data } = $props();

	const chip = (active: boolean) =>
		`flex h-9 items-center gap-1.5 rounded-full border px-3.5 font-ui text-[0.8125rem] font-bold whitespace-nowrap ${
			active ? 'border-ink bg-ink text-paper' : 'border-rule-strong text-ink-2 hover:border-ink'
		}`;
	const filtered = $derived(Boolean(data.q || data.tag || data.site));
</script>

<svelte:head>
	<title>Library · Reading List</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-5 pt-5 lg:pt-10">
	<header class="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
		<div>
			<h1 class="headline text-[2.1rem] leading-[1.05] lg:text-5xl">Library</h1>
			<p class="mt-1.5 font-ui text-[0.9375rem] text-ink-2">
				{data.facets.total}
				{data.facets.total === 1 ? 'reference' : 'references'} · the links you keep coming back to
			</p>
		</div>
		<a href={resolve('/archive')} class="font-ui text-sm font-bold text-accent hover:underline"
			>Archive →</a
		>
	</header>

	<form method="GET" role="search" class="mt-4 flex gap-2">
		{#if data.tag}<input type="hidden" name="tag" value={data.tag} />{/if}
		{#if data.site}<input type="hidden" name="site" value={data.site} />{/if}
		<label for="library-q" class="sr-only">Search references</label>
		<input
			id="library-q"
			name="q"
			type="search"
			value={data.q}
			autocomplete="off"
			autocapitalize="none"
			placeholder="Search references…"
			class="h-11 min-w-0 flex-1 rounded-md border border-rule-strong bg-surface px-3.5 font-ui text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
		/>
		<button
			class="h-11 rounded-md border border-ink px-4 font-ui text-sm font-bold text-ink hover:bg-ink hover:text-paper"
			>Search</button
		>
	</form>

	{#if data.facets.tags.length}
		<nav aria-label="Tags" class="-mx-5 overflow-x-auto px-5">
			<ul class="flex gap-2 pt-4">
				<li>
					<a href={resolve('/library')} class={chip(!filtered)}>All</a>
				</li>
				{#each data.facets.tags as t (t.name)}
					<li>
						<a
							href="{resolve('/library')}?tag={encodeURIComponent(t.name)}"
							aria-current={data.tag === t.name ? 'page' : undefined}
							class={chip(data.tag === t.name)}
							>#{t.name}<span class="font-normal opacity-75">{t.n}</span></a
						>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
	{#if data.facets.sites.length > 1}
		<nav aria-label="Sites" class="-mx-5 overflow-x-auto px-5">
			<ul class="flex gap-2 py-3">
				{#each data.facets.sites as s (s.host)}
					<li>
						<a
							href="{resolve('/library')}?site={encodeURIComponent(s.host)}"
							aria-current={data.site === s.host ? 'page' : undefined}
							class={chip(data.site === s.host)}
							>{s.host}<span class="font-normal opacity-75">{s.n}</span></a
						>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	{#if data.results.length}
		<ul>
			{#each data.results as result (result.id)}
				<SearchResult {result} />
			{/each}
		</ul>
	{:else if filtered}
		<p class="py-10 text-center text-[1.0625rem] text-ink-2 italic">No references match.</p>
	{:else}
		<div class="mx-auto max-w-md py-14 text-center">
			<p class="headline text-3xl">Nothing here yet</p>
			<p class="mt-3 text-[1.0625rem] leading-relaxed text-ink-2">
				Star a link or a feed post (☆, or press S) and it’s kept here, ready to find and share.
			</p>
		</div>
	{/if}
</div>
