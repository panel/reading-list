<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { swipe } from '$lib/actions/swipe';
	import { resolve } from '$app/paths';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { relativeDay } from '$lib/format';
	import { toast, undoQueueChange } from '$lib/toast.svelte';
	import type { InboxItem } from '$lib/server/inbox';

	let { data } = $props();
	let refreshing = $state(false);

	const SHARED = 'shared';
	const showingShared = $derived(data.feedId === SHARED);

	const hrefFor = (item: InboxItem) =>
		item.kind === 'post'
			? resolve('/entries/[id]', { id: item.id })
			: resolve('/links/[id]', { id: item.id });
	const keyFor = (item: InboxItem) => `${item.kind}:${item.id}`;

	// Per-row swipe state: the card element, its action form, and the drag offset.
	const rows: Record<string, HTMLElement> = $state({});
	const forms: Record<string, HTMLFormElement> = $state({});
	let drag = $state<{ key: string; dx: number } | null>(null);
	const hint = (value: number) => Math.max(0, Math.min(1, value / 80)).toFixed(2);

	/** Swipe left is Done; swipe right stars (and springs back if it's starred already). */
	function swiped(item: InboxItem, direction: 1 | -1) {
		const key = keyFor(item);
		const form = forms[key];
		const button = form?.querySelector<HTMLButtonElement>(
			`button[value="${direction === 1 ? 'star' : 'done'}"]`
		);
		if (button && !button.disabled && !(direction === 1 && item.starred)) {
			form.requestSubmit(button);
		} else {
			drag = null;
			if (rows[key]) rows[key].style.transform = '';
		}
	}

	const rowAction =
		(item: InboxItem): SubmitFunction =>
		({ submitter }) => {
			const kind = submitter?.getAttribute('value');
			const key = keyFor(item);
			return async ({ result, update }) => {
				await update();
				drag = null;
				if (rows[key]) rows[key].style.transform = '';
				if (result.type === 'failure') {
					toast.show({ message: String(result.data?.message ?? 'Something went wrong') });
				} else if (result.type === 'success') {
					if (kind === 'done') {
						toast.show({
							message: `Done · ${item.title}`,
							undo:
								item.kind === 'post'
									? {
											action: `${resolve('/entries/[id]', { id: item.id })}?/dismiss`,
											fields: { dismissed: 'false' }
										}
									: result.data?.undo
										? undoQueueChange(
												resolve('/links/[id]', { id: item.id }),
												result.data.undo as Parameters<typeof undoQueueChange>[1]
											)
										: undefined
						});
					} else if (kind === 'star') {
						toast.show({
							message: result.data?.done === 'starred' ? 'Starred as a reference' : 'Unstarred'
						});
					}
				}
			};
		};

	const current = $derived(data.feeds.find((f) => f.id === data.feedId));
	const folders = $derived(
		[...new Set(data.feeds.map((f) => f.folder).filter((f): f is string => Boolean(f)))]
			.sort((a, b) => a.localeCompare(b))
			.map((name) => ({
				name,
				unread: data.feeds.filter((f) => f.folder === name).reduce((n, f) => n + f.unread, 0)
			}))
	);
	const categoryName = $derived(
		new Map([...data.categories.map((c) => [c.slug, c.name] as const), ['other', 'Other'] as const])
	);
	const currentCategory = $derived(
		data.category
			? data.category === 'other'
				? 'Other'
				: (data.categories.find((c) => c.slug === data.category)?.name ?? null)
			: null
	);
	// The filter the page is showing: Shared, a category, one feed, one folder, or everything.
	const scopeTitle = $derived(
		showingShared ? 'Shared' : (currentCategory ?? current?.title ?? data.folder ?? null)
	);
	const showingAll = $derived(!data.feedId && !data.folder && !data.category);
	const failing = $derived(data.feeds.filter((f) => f.failing));
	const unreadPosts = $derived(data.inbox.items.filter((i) => i.kind === 'post' && !i.read).length);
	const empty = $derived(data.feeds.length === 0 && data.inbox.shared === 0);
	const summary = $derived(
		[
			`${data.inbox.unread} unread`,
			!scopeTitle && data.inbox.shared && `${data.inbox.shared} shared`,
			!scopeTitle &&
				data.feeds.length &&
				`${data.feeds.length} ${data.feeds.length === 1 ? 'feed' : 'feeds'}`
		]
			.filter(Boolean)
			.join(' · ')
	);

	const chip = (active: boolean, tone: 'ink' | 'accent' = 'ink') =>
		`flex h-9 items-center gap-1.5 rounded-full border px-3.5 font-ui text-[0.8125rem] font-bold whitespace-nowrap ${
			active
				? tone === 'ink'
					? 'border-ink bg-ink text-paper'
					: 'border-accent bg-accent text-paper'
				: tone === 'ink'
					? 'border-rule-strong text-ink-2 hover:border-ink'
					: 'border-accent/40 text-accent hover:border-accent'
		}`;
</script>

<svelte:head>
	<title>{scopeTitle ?? 'Inbox'} · Reading List</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-5 pt-5 lg:pt-10">
	<header class="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-4">
		<div>
			<h1 class="headline text-[2.1rem] leading-[1.05] lg:text-5xl">{scopeTitle ?? 'Inbox'}</h1>
			<p class="mt-1.5 font-ui text-[0.9375rem] text-ink-2">
				{summary}
			</p>
		</div>
		<div class="flex gap-2">
			{#if data.feeds.length && !showingShared}
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
			{#if showingShared}
				<a
					href={resolve('/save')}
					class="flex h-11 items-center rounded-md bg-ink px-4 font-ui text-sm font-bold text-paper hover:bg-accent-strong"
					>Save a link</a
				>
			{:else}
				<a
					href={resolve('/feeds/manage')}
					class="flex h-11 items-center rounded-md bg-ink px-4 font-ui text-sm font-bold text-paper hover:bg-accent-strong"
					>{data.feeds.length ? 'Manage feeds' : 'Add a feed'}</a
				>
			{/if}
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

	{#if !empty}
		<nav aria-label="Filter the inbox" class="-mx-5 overflow-x-auto px-5">
			<ul class="flex gap-2 py-3">
				<li>
					<a
						href={resolve('/')}
						aria-current={showingAll ? 'page' : undefined}
						class={chip(showingAll)}>All</a
					>
				</li>
				<li>
					<a
						href="{resolve('/')}?feed={SHARED}"
						aria-current={showingShared ? 'page' : undefined}
						class={chip(showingShared)}
						>Shared{#if data.inbox.shared}<span class="font-normal opacity-75"
								>{data.inbox.shared}</span
							>{/if}</a
					>
				</li>
				{#each [...data.categories, ...(data.categories.length ? [{ slug: 'other', name: 'Other' }] : [])] as c (c.slug)}
					<li>
						<a
							href="{resolve('/')}?category={encodeURIComponent(c.slug)}"
							aria-current={data.category === c.slug ? 'page' : undefined}
							class={chip(data.category === c.slug)}>{c.name}</a
						>
					</li>
				{/each}
				{#each folders as f (f.name)}
					<li>
						<a
							href="{resolve('/')}?folder={encodeURIComponent(f.name)}"
							aria-current={data.folder === f.name ? 'page' : undefined}
							class={chip(data.folder === f.name, 'accent')}
							>{f.name}{#if f.unread}<span class="font-normal opacity-75">{f.unread}</span>{/if}</a
						>
					</li>
				{/each}
				{#each data.feeds.filter((f) => !data.folder || f.folder === data.folder) as feed (feed.id)}
					<li>
						<a
							href="{resolve('/')}?feed={encodeURIComponent(feed.id)}"
							aria-current={data.feedId === feed.id ? 'page' : undefined}
							class={chip(data.feedId === feed.id)}
							>{feed.title}{#if feed.unread}<span class="font-normal opacity-75">{feed.unread}</span
								>{/if}</a
						>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	{#if empty}
		<div class="mx-auto max-w-md py-14 text-center">
			<p class="headline text-3xl">Everything you read, in one place</p>
			<p class="mt-3 text-[1.0625rem] leading-relaxed text-ink-2">
				Links you share in and new posts from the blogs you follow show up here.
			</p>
			<div class="mt-6 flex justify-center gap-2">
				<a
					href={resolve('/save')}
					class="inline-flex h-12 items-center rounded-md bg-ink px-6 font-ui font-bold text-paper hover:bg-accent-strong"
					>Save a link</a
				>
				<a
					href={resolve('/feeds/manage')}
					class="inline-flex h-12 items-center rounded-md border border-rule-strong px-6 font-ui font-bold text-ink hover:border-ink"
					>Add a feed</a
				>
			</div>
		</div>
	{:else if data.inbox.items.length === 0}
		<p class="py-12 text-center text-[1.0625rem] text-ink-2 italic">
			{showingShared
				? 'Nothing shared right now. Links you send in from your phone land here.'
				: 'Nothing new. Try Refresh.'}
		</p>
	{:else}
		<ul>
			{#each data.inbox.items as item (keyFor(item))}
				{@const key = keyFor(item)}
				{@const base = hrefFor(item)}
				<li class="group/row relative overflow-hidden border-b border-rule">
					<div
						aria-hidden="true"
						class="pointer-events-none absolute inset-0 flex items-center justify-between px-1 kicker text-sm lg:hidden"
					>
						<span class="text-ink-3" style:opacity={hint(drag?.key === key ? -drag.dx : 0)}
							>← Done</span
						>
						<span class="text-accent" style:opacity={hint(drag?.key === key ? drag.dx : 0)}
							>{item.starred ? '★ Starred' : '☆ Star'} →</span
						>
					</div>
					<div
						bind:this={rows[key]}
						use:swipe={{
							onswipe: (d) => swiped(item, d),
							ondrag: (dx) => (drag = { key, dx }),
							threshold: 90
						}}
						class="relative bg-paper"
					>
						<a href={base} class="group flex gap-3.5 py-4" draggable="false">
							<div class="flex min-w-0 flex-1 flex-col gap-1.5" class:opacity-60={item.read}>
								<span class="flex items-center gap-1.5 kicker text-[0.6875rem] text-accent">
									{#if !item.read}<span
											class="inline-block h-1.5 w-1.5 rounded-full bg-accent"
											aria-label="Unread"
										></span>{/if}
									{#if item.kind === 'shared'}<span class="text-ink-2">Shared ·</span>{/if}
									{item.source} · {relativeDay(item.date)}
									{#if item.starred}<span class="text-ink-2">· ★</span>{/if}
									{#if item.categories.length && !data.category}<span class="text-ink-3"
											>· {item.categories.map((c) => categoryName.get(c) ?? c).join(', ')}</span
										>{/if}
								</span>
								<span
									class="headline text-[1.3125rem] leading-[1.15] group-hover:text-accent-strong"
									>{item.title}</span
								>
								{#if item.summary}
									<span
										class="line-clamp-2 text-[0.9375rem] leading-[1.45] {item.note
											? 'text-ink'
											: 'text-ink-2'}">{item.summary}</span
									>
								{/if}
							</div>
							{#if item.imageUrl}
								<LinkImage
									link={{
										url: item.url ?? 'https://example.com',
										imageUrl: item.imageUrl,
										title: item.title
									}}
									class="h-21 w-21 shrink-0 rounded"
								/>
							{/if}
						</a>
					</div>
					<!-- Screen-reader and keyboard access on mobile; hover buttons on desktop. -->
					<form
						bind:this={forms[key]}
						method="POST"
						use:enhance={rowAction(item)}
						class="sr-only flex gap-1.5 max-lg:focus-within:not-sr-only lg:not-sr-only lg:absolute lg:top-3 lg:bg-paper {item.imageUrl
							? 'lg:right-[6.25rem]'
							: 'lg:right-0'} lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus-within:opacity-100"
					>
						<input type="hidden" name="starred" value={String(!item.starred)} />
						<input type="hidden" name="dismissed" value="true" />
						<button
							value="star"
							formaction="{base}?/star"
							disabled={!item.url}
							aria-label={item.starred ? 'Unstar' : 'Star as reference'}
							aria-pressed={item.starred}
							class="h-9 w-9 rounded-md border border-rule-strong font-ui text-sm hover:border-ink disabled:opacity-40 {item.starred
								? 'text-accent'
								: 'text-ink'}">{item.starred ? '★' : '☆'}</button
						>
						<button
							value="done"
							formaction="{base}?/{item.kind === 'post' ? 'dismiss' : 'finish'}"
							class="h-9 rounded-md border border-rule-strong px-3 font-ui text-[0.8125rem] font-bold text-ink-2 hover:border-ink hover:text-ink"
							>Done</button
						>
					</form>
				</li>
			{/each}
		</ul>
		{#if unreadPosts && !showingShared && !data.category}
			<form
				method="POST"
				action="?/markAllRead"
				use:enhance={({ cancel }) => {
					const scope = scopeTitle ?? 'all your feeds';
					if (!confirm(`Mark every post in ${scope} as read? Shared links stay.`)) return cancel();
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
				<input type="hidden" name="folder" value={data.folder ?? ''} />
				<button
					class="h-11 rounded-md border border-rule-strong px-4 font-ui text-sm font-bold text-ink-2 hover:border-ink hover:text-ink"
					>Mark all posts {scopeTitle ? `in ${scopeTitle}` : ''} read</button
				>
			</form>
		{/if}
	{/if}
</div>
