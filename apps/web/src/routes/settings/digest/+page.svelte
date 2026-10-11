<script lang="ts">
	import { resolve } from '$app/paths';
	import { relativeDay } from '$lib/format';

	let { data } = $props();

	const count = (reason: string) =>
		data.items.filter((i) => i.reasons.some((r) => r.startsWith(reason))).length;
	const summary = $derived(
		[
			`${data.items.length} ${data.items.length === 1 ? 'item' : 'items'}${data.items.length === 50 ? ' (the top 50)' : ''}`,
			...(
				[
					[count('wrote a note'), 'with a note'],
					[count('starred'), 'starred'],
					[count('shared'), 'shared']
				] as const
			)
				.filter(([n]) => n)
				.map(([n, label]) => `${n} ${label}`)
		].join(' · ')
	);
	const href = (item: (typeof data.items)[number]) =>
		item.kind === 'link'
			? resolve('/links/[id]', { id: item.id })
			: resolve('/entries/[id]', { id: item.id });
	const excerpt = (note: string) => (note.length > 280 ? `${note.slice(0, 280).trimEnd()}…` : note);
</script>

<svelte:head>
	<title>Reading digest · Reading List</title>
</svelte:head>

<div class="mx-auto flex max-w-xl flex-col gap-6 px-5.5 pt-6 lg:pt-12">
	<a
		href={resolve('/settings')}
		class="-mb-3 -ml-1 flex h-11 w-fit items-center gap-1.5 kicker text-ink-2 hover:text-ink"
	>
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg
		>
		Settings
	</a>

	<header class="border-b-2 border-ink pb-4">
		<h1 class="headline text-[2.1rem] leading-[1.05] lg:text-5xl">Reading digest</h1>
		<p class="mt-2 text-[1.0625rem] leading-[1.55] text-ink-2">
			What you read and reacted to lately, strongest reaction first: a note or a star counts most,
			then sharing the link, then opening it. Your agent sees the same list.
		</p>
	</header>

	<nav aria-label="Time window" class="grid grid-cols-4 gap-2 font-ui text-sm font-bold">
		{#each data.windows as days (days)}
			<a
				href="{resolve('/settings/digest')}?days={days}"
				aria-current={days === data.days ? 'page' : undefined}
				class="flex h-10 items-center justify-center rounded-full border {days === data.days
					? 'border-ink bg-ink text-paper'
					: 'border-rule-strong text-ink hover:border-ink'}">{days} days</a
			>
		{/each}
	</nav>

	{#if data.items.length === 0}
		<p class="py-10 text-center text-[1.0625rem] text-ink-2 italic">
			Nothing in the last {data.days} days yet. Open, star or write a note on what you read and it shows
			up here.
		</p>
	{:else}
		<p class="-mt-2 font-ui text-[0.875rem] text-ink-3">{summary}</p>
		<ol>
			{#each data.items as item (`${item.kind}:${item.id}`)}
				<li class="flex flex-col gap-1.5 border-b border-rule py-4">
					<span class="kicker text-[0.6875rem] text-accent"
						>{item.source ?? (item.kind === 'post' ? 'Feed post' : 'Link')}{#if item.category}<span
								class="text-ink-3"
							>
								· {item.category}</span
							>{/if}</span
					>
					<a href={href(item)} class="headline text-lg leading-[1.2] hover:text-accent-strong"
						>{item.title ?? item.url ?? 'Untitled'}</a
					>
					<span class="font-ui text-[0.8125rem] text-ink-2"
						>You {item.reasons.join(', ')} · {relativeDay(item.lastActivity)}</span
					>
					{#if item.note?.trim()}
						<p
							class="mt-1 rounded-md bg-sunk px-3.5 py-2.5 text-[0.9375rem] leading-[1.5] whitespace-pre-line"
						>
							{excerpt(item.note.trim())}
						</p>
					{/if}
					{#if item.tags.length}
						<p class="font-ui text-[0.8125rem] text-ink-3">
							{item.tags.map((t) => `#${t}`).join('  ')}
						</p>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>
