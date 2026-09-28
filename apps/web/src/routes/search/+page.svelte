<script lang="ts">
	import { resolve } from '$app/paths';
	import SearchResult from '$lib/components/SearchResult.svelte';

	let { data } = $props();

	const examples = [
		['boring technology', 'words anywhere: title, note, tags, site'],
		['"innovation tokens"', 'an exact phrase'],
		['tag:architecture', 'links with a tag (or #architecture)'],
		['site:paulgraham.com', 'links from a site'],
		['is:ref', 'references (starred) · also is:queued, is:archived'],
		['-rewrite', 'leave out links matching a word']
	];
</script>

<svelte:head>
	<title>{data.q ? `${data.q} · Search` : 'Search'} · Reading List</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-5 pt-5 lg:pt-10">
	<form method="GET" action={resolve('/search')} role="search" class="flex gap-2">
		<label for="q" class="sr-only">Search your links</label>
		<input
			id="q"
			name="q"
			type="search"
			value={data.q}
			autocomplete="off"
			autocapitalize="none"
			spellcheck="false"
			placeholder="Search titles, notes, tags, sites…"
			class="h-12 min-w-0 flex-1 rounded-md border border-rule-strong bg-surface px-3.5 font-ui text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
		/>
		<button class="h-12 rounded-md bg-ink px-5 font-ui font-bold text-paper hover:bg-accent-strong"
			>Search</button
		>
	</form>

	{#if data.q}
		<h1 class="mt-6 border-b-2 border-ink pb-3 kicker text-ink-2">
			{data.results.length}
			{data.results.length === 1 ? 'result' : 'results'} for “{data.q}”
		</h1>
		<ul>
			{#each data.results as result (result.id)}
				<SearchResult {result} />
			{/each}
		</ul>
		{#if data.results.length === 0}
			<p class="py-10 text-center text-[1.0625rem] text-ink-2 italic">
				Nothing matches. Try fewer words, or one of the filters below.
			</p>
		{/if}
	{/if}

	<section class="mt-8 rounded-md bg-sunk px-4 py-4" aria-labelledby="syntax-heading">
		<h2 id="syntax-heading" class="kicker text-accent">Search tips</h2>
		<dl class="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 font-ui text-sm sm:grid-cols-[auto_1fr]">
			{#each examples as [example, meaning] (example)}
				<dt>
					<a
						href="{resolve('/search')}?q={encodeURIComponent(example)}"
						class="font-mono text-[0.8125rem] text-ink hover:text-accent">{example}</a
					>
				</dt>
				<dd class="text-ink-2">{meaning}</dd>
			{/each}
		</dl>
		<p class="mt-3 font-ui text-sm text-ink-3">
			Combine them: <span class="font-mono text-[0.8125rem]">tag:reference is:ref boring</span>.
			Press <kbd>⌘K</kbd> anywhere to find a link and copy it.
		</p>
	</section>
</div>
