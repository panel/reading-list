<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { relativeDay } from '$lib/format';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();
	let refreshing = $state(false);

	const current = $derived(data.feeds.find((f) => f.id === data.feedId));
	const summary = $derived(
		[
			`${data.inbox.unread} unread`,
			!current &&
				data.feeds.length &&
				`${data.feeds.length} ${data.feeds.length === 1 ? 'feed' : 'feeds'}`
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<svelte:head>
	<title>Feeds · Reading List</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-5 pt-5 lg:pt-10">
	<header class="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
		<div>
			<h1 class="headline text-[2.1rem] leading-[1.05] lg:text-5xl">{current?.title ?? 'Feeds'}</h1>
			<p class="mt-1.5 font-ui text-[0.9375rem] text-ink-2">
				{summary}
			</p>
		</div>
		<div class="flex gap-2">
			{#if data.feeds.length}
				<form
					method="POST"
					action="?/refresh"
					use:enhance={() => {
						refreshing = true;
						return async ({ result, update }) => {
							await update();
							refreshing = false;
							if (result.type === 'success') {
								const { newEntries, errors } = result.data as {
									newEntries: number;
									errors: number;
								};
								toast.show({
									message:
										(newEntries
											? `${newEntries} new ${newEntries === 1 ? 'post' : 'posts'}`
											: 'No new posts') +
										(errors ? ` · ${errors} ${errors === 1 ? 'feed' : 'feeds'} failed` : '')
								});
							}
						};
					}}
				>
					<button
						disabled={refreshing}
						class="h-11 rounded-md border border-rule-strong px-4 font-ui text-sm font-bold text-ink hover:border-ink disabled:opacity-60"
						>{refreshing ? 'Refreshing…' : 'Refresh'}</button
					>
				</form>
			{/if}
			<a
				href={resolve('/feeds/manage')}
				class="flex h-11 items-center rounded-md bg-ink px-4 font-ui text-sm font-bold text-paper hover:bg-accent-strong"
				>{data.feeds.length ? 'Manage' : 'Add a feed'}</a
			>
		</div>
	</header>

	{#if data.feeds.length > 1}
		<nav aria-label="Filter by feed" class="-mx-5 overflow-x-auto px-5">
			<ul class="flex gap-2 py-3">
				<li>
					<a
						href={resolve('/feeds')}
						aria-current={!data.feedId ? 'page' : undefined}
						class="flex h-9 items-center rounded-full border px-3.5 font-ui text-[0.8125rem] font-bold whitespace-nowrap {!data.feedId
							? 'border-ink bg-ink text-paper'
							: 'border-rule-strong text-ink-2 hover:border-ink'}">All</a
					>
				</li>
				{#each data.feeds as feed (feed.id)}
					<li>
						<a
							href="{resolve('/feeds')}?feed={encodeURIComponent(feed.id)}"
							aria-current={data.feedId === feed.id ? 'page' : undefined}
							class="flex h-9 items-center gap-1.5 rounded-full border px-3.5 font-ui text-[0.8125rem] font-bold whitespace-nowrap {data.feedId ===
							feed.id
								? 'border-ink bg-ink text-paper'
								: 'border-rule-strong text-ink-2 hover:border-ink'}"
							>{feed.title}{#if feed.unread}<span class="font-normal opacity-75">{feed.unread}</span
								>{/if}</a
						>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	{#if data.feeds.length === 0}
		<div class="mx-auto max-w-md py-14 text-center">
			<p class="headline text-3xl">Follow the writers you read</p>
			<p class="mt-3 text-[1.0625rem] leading-relaxed text-ink-2">
				Add a blog or a feed and its new posts show up here to read in full.
			</p>
			<a
				href={resolve('/feeds/manage')}
				class="mt-6 inline-flex h-12 items-center rounded-md bg-ink px-6 font-ui font-bold text-paper hover:bg-accent-strong"
				>Add a feed</a
			>
		</div>
	{:else if data.inbox.entries.length === 0}
		<p class="py-12 text-center text-[1.0625rem] text-ink-2 italic">No posts yet. Try Refresh.</p>
	{:else}
		<ul>
			{#each data.inbox.entries as entry (entry.id)}
				<li class="border-b border-rule">
					<a href={resolve('/entries/[id]', { id: entry.id })} class="group flex gap-3.5 py-4">
						<div class="flex min-w-0 flex-1 flex-col gap-1.5" class:opacity-60={entry.readAt}>
							<span class="flex items-center gap-1.5 kicker text-[0.6875rem] text-accent">
								{#if !entry.readAt}<span
										class="inline-block h-1.5 w-1.5 rounded-full bg-accent"
										aria-label="Unread"
									></span>{/if}
								{entry.feedTitle} · {relativeDay(entry.publishedAt ?? entry.createdAt)}
							</span>
							<span class="headline text-[1.3125rem] leading-[1.15] group-hover:text-accent-strong"
								>{entry.title ?? entry.summary?.slice(0, 80) ?? 'Untitled'}</span
							>
							{#if entry.summary}
								<span class="line-clamp-2 text-[0.9375rem] leading-[1.45] text-ink-2"
									>{entry.summary}</span
								>
							{/if}
						</div>
						{#if entry.imageUrl}
							<LinkImage
								link={{
									url: entry.url ?? 'https://example.com',
									imageUrl: entry.imageUrl,
									title: entry.title
								}}
								class="h-21 w-21 shrink-0 rounded"
							/>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
