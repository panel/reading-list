<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { swipe } from '$lib/actions/swipe';
	import { resolve } from '$app/paths';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { relativeDay } from '$lib/format';
	import { toast } from '$lib/toast.svelte';
	import type { InboxEntry } from '$lib/server/entries';

	let { data } = $props();
	let refreshing = $state(false);

	// Per-row swipe state: the card element, its action form, and the drag offset.
	const rows: Record<string, HTMLElement> = $state({});
	const forms: Record<string, HTMLFormElement> = $state({});
	let drag = $state<{ id: string; dx: number } | null>(null);
	const hint = (value: number) => Math.max(0, Math.min(1, value / 80)).toFixed(2);

	function swiped(entry: InboxEntry, direction: 1 | -1) {
		const form = forms[entry.id];
		const button = form?.querySelector<HTMLButtonElement>(
			`button[value="${direction === 1 ? 'later' : 'dismiss'}"]`
		);
		if (button && !button.disabled) form.requestSubmit(button);
		else if (rows[entry.id]) rows[entry.id].style.transform = '';
	}

	const rowAction =
		(entry: InboxEntry): SubmitFunction =>
		({ submitter }) => {
			const kind = submitter?.getAttribute('value');
			const title = entry.title ?? 'Post';
			return async ({ result, update }) => {
				await update();
				drag = null;
				if (rows[entry.id]) rows[entry.id].style.transform = '';
				if (result.type === 'failure') {
					toast.show({ message: String(result.data?.message ?? 'Something went wrong') });
				} else if (result.type === 'success') {
					if (kind === 'dismiss') {
						toast.show({
							message: `Dismissed · ${title}`,
							undo: {
								action: `${resolve('/entries/[id]', { id: entry.id })}?/dismiss`,
								fields: { dismissed: 'false' }
							}
						});
					} else if (kind === 'later') {
						toast.show({ message: `Saved to your queue · ${title}` });
					} else if (kind === 'star') {
						toast.show({
							message: result.data?.done === 'starred' ? 'Starred as a reference' : 'Unstarred'
						});
					}
				}
			};
		};

	const current = $derived(data.feeds.find((f) => f.id === data.feedId));
	const failing = $derived(data.feeds.filter((f) => f.failing));
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

	{#if failing.length}
		<p role="status" class="mt-4 rounded-md bg-sunk px-4 py-3 font-ui text-[0.9375rem] text-ink">
			{failing.length === 1
				? `${failing[0].title} keeps failing to update.`
				: `${failing.length} feeds keep failing to update.`}
			<a href={resolve('/feeds/manage')} class="font-bold text-accent hover:underline">See why</a>
		</p>
	{/if}

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
				{@const inQueue = entry.linkStatus === 'queued'}
				<li class="group/row relative overflow-hidden border-b border-rule">
					<div
						aria-hidden="true"
						class="pointer-events-none absolute inset-0 flex items-center justify-between px-1 kicker text-sm lg:hidden"
					>
						<span class="text-ink-3" style:opacity={hint(drag?.id === entry.id ? -drag.dx : 0)}
							>← Dismiss</span
						>
						<span class="text-accent" style:opacity={hint(drag?.id === entry.id ? drag.dx : 0)}
							>Later →</span
						>
					</div>
					<div
						bind:this={rows[entry.id]}
						use:swipe={{
							onswipe: (d) => swiped(entry, d),
							ondrag: (dx) => (drag = { id: entry.id, dx }),
							threshold: 90
						}}
						class="relative bg-paper"
					>
						<a
							href={resolve('/entries/[id]', { id: entry.id })}
							class="group flex gap-3.5 py-4"
							draggable="false"
						>
							<div
								class="flex min-w-0 flex-1 flex-col gap-1.5"
								class:opacity-60={entry.readAt && !inQueue}
							>
								<span class="flex items-center gap-1.5 kicker text-[0.6875rem] text-accent">
									{#if !entry.readAt}<span
											class="inline-block h-1.5 w-1.5 rounded-full bg-accent"
											aria-label="Unread"
										></span>{/if}
									{entry.feedTitle} · {relativeDay(entry.publishedAt ?? entry.createdAt)}
									{#if inQueue}<span class="text-ink-2">· In queue</span>{/if}
									{#if entry.linkIsReference}<span class="text-ink-2">· ★</span>{/if}
								</span>
								<span
									class="headline text-[1.3125rem] leading-[1.15] group-hover:text-accent-strong"
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
					</div>
					<!-- Screen-reader and keyboard access on mobile; hover buttons on desktop. -->
					<form
						bind:this={forms[entry.id]}
						method="POST"
						use:enhance={rowAction(entry)}
						class="sr-only flex gap-1.5 max-lg:focus-within:not-sr-only lg:not-sr-only lg:absolute lg:top-3 lg:bg-paper {entry.imageUrl
							? 'lg:right-[6.25rem]'
							: 'lg:right-0'} lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus-within:opacity-100"
					>
						<input type="hidden" name="starred" value={String(!entry.linkIsReference)} />
						<input type="hidden" name="dismissed" value="true" />
						<button
							value="later"
							formaction="{resolve('/entries/[id]', { id: entry.id })}?/later"
							disabled={inQueue || !entry.url}
							class="h-9 rounded-md border border-rule-strong px-3 font-ui text-[0.8125rem] font-bold text-accent hover:border-accent disabled:opacity-40"
							>{inQueue ? 'In queue' : 'Later'}</button
						>
						<button
							value="star"
							formaction="{resolve('/entries/[id]', { id: entry.id })}?/star"
							disabled={!entry.url}
							aria-label={entry.linkIsReference ? 'Unstar' : 'Star as reference'}
							aria-pressed={Boolean(entry.linkIsReference)}
							class="h-9 w-9 rounded-md border border-rule-strong font-ui text-sm hover:border-ink disabled:opacity-40 {entry.linkIsReference
								? 'text-accent'
								: 'text-ink'}">{entry.linkIsReference ? '★' : '☆'}</button
						>
						<button
							value="dismiss"
							formaction="{resolve('/entries/[id]', { id: entry.id })}?/dismiss"
							class="h-9 rounded-md border border-rule-strong px-3 font-ui text-[0.8125rem] font-bold text-ink-2 hover:border-ink hover:text-ink"
							>Dismiss</button
						>
					</form>
				</li>
			{/each}
		</ul>
		{#if data.inbox.unread}
			<form
				method="POST"
				action="?/markAllRead"
				use:enhance={({ cancel }) => {
					const scope = current ? current.title : 'all your feeds';
					if (!confirm(`Mark every post in ${scope} as read?`)) return cancel();
					return async ({ result, update }) => {
						await update();
						if (result.type === 'success') {
							const n = Number(result.data?.markedRead ?? 0);
							toast.show({ message: `Marked ${n} ${n === 1 ? 'post' : 'posts'} read` });
						}
					};
				}}
				class="flex justify-center py-6"
			>
				<input type="hidden" name="feedId" value={data.feedId ?? ''} />
				<button
					class="h-11 rounded-md border border-rule-strong px-4 font-ui text-sm font-bold text-ink-2 hover:border-ink hover:text-ink"
					>Mark all {current ? `in ${current.title}` : ''} read</button
				>
			</form>
		{/if}
	{/if}
</div>
