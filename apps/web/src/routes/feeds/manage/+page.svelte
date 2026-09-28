<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { hostname, relativeDay } from '$lib/format';
	import { toast } from '$lib/toast.svelte';

	let { data, form } = $props();
	let adding = $state(false);

	const describe = (r: { status: string; newEntries?: number; error?: string }) =>
		r.status === 'updated'
			? `${r.newEntries} new ${r.newEntries === 1 ? 'post' : 'posts'}`
			: r.status === 'not-modified'
				? 'No new posts'
				: `Failed: ${r.error}`;
</script>

<svelte:head>
	<title>Manage feeds · Reading List</title>
</svelte:head>

<div class="mx-auto flex max-w-xl flex-col gap-8 px-5.5 pt-5 lg:pt-10">
	<a
		href={resolve('/feeds')}
		class="-ml-1 flex h-11 w-fit items-center gap-1.5 kicker text-ink-2 hover:text-ink"
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
		Feeds
	</a>

	<section class="flex flex-col gap-3" aria-labelledby="add-heading">
		<h1 id="add-heading" class="headline text-[2.1rem] leading-[1.05] lg:text-5xl">Add a feed</h1>
		<p class="text-[1.0625rem] leading-[1.55] text-ink-2">
			Paste a blog’s address or its feed URL. If it’s a site, the feed is found for you.
		</p>
		<form
			method="POST"
			action="?/subscribe"
			use:enhance={() => {
				adding = true;
				return async ({ result, update }) => {
					await update();
					adding = false;
					if (result.type === 'success' && result.data?.subscribed) {
						const s = result.data.subscribed as {
							title: string;
							newEntries: number;
							alreadySubscribed: boolean;
						};
						toast.show({
							message: s.alreadySubscribed
								? `You already follow ${s.title}`
								: `Following ${s.title} · ${s.newEntries} ${s.newEntries === 1 ? 'post' : 'posts'}`
						});
					}
				};
			}}
			class="flex flex-col gap-2"
		>
			<label for="feed-url" class="kicker text-accent">Site or feed</label>
			<div class="flex gap-2">
				<input
					id="feed-url"
					name="url"
					type="text"
					inputmode="url"
					autocomplete="off"
					autocapitalize="none"
					spellcheck="false"
					required
					placeholder="simonwillison.net"
					value={form?.url ?? ''}
					aria-invalid={form?.error ? 'true' : undefined}
					class="h-12 min-w-0 flex-1 rounded-md border border-rule-strong bg-surface px-3.5 font-ui text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
				/>
				<button
					disabled={adding}
					class="h-12 shrink-0 rounded-md bg-ink px-5 font-ui text-[0.9375rem] font-bold text-paper hover:bg-accent-strong disabled:opacity-70"
					>{adding ? 'Finding…' : 'Follow'}</button
				>
			</div>
			{#if form?.error}
				<p class="font-ui text-sm font-bold text-[#9b2c1f]">{form.error}</p>
			{/if}
		</form>
	</section>

	<section class="flex flex-col" aria-labelledby="following-heading">
		<h2 id="following-heading" class="border-b-2 border-ink pb-3 kicker text-ink-2">
			Following · {data.feeds.length}
		</h2>
		{#if data.feeds.length === 0}
			<p class="py-6 font-ui text-[0.9375rem] text-ink-3">Nothing yet.</p>
		{/if}
		<ul>
			{#each data.feeds as feed (feed.id)}
				<li class="flex flex-col gap-2 border-b border-rule py-4">
					<div class="flex items-baseline justify-between gap-3">
						<a
							href="{resolve('/feeds')}?feed={encodeURIComponent(feed.id)}"
							class="min-w-0 headline text-xl leading-tight hover:text-accent-strong"
							>{feed.title}</a
						>
						{#if feed.unread}<span class="shrink-0 font-ui text-sm font-bold text-accent"
								>{feed.unread} unread</span
							>{/if}
					</div>
					<p class="font-ui text-[0.8125rem] break-all text-ink-3">
						{hostname(feed.siteUrl ?? feed.url)} · {feed.lastFetchedAt
							? `checked ${relativeDay(feed.lastFetchedAt)}`
							: 'not checked yet'}
					</p>
					{#if feed.lastError}
						<p class="font-ui text-[0.8125rem] font-bold text-[#9b2c1f]">
							Last check failed{feed.errorCount > 1 ? ` ${feed.errorCount} times` : ''}: {feed.lastError}
						</p>
					{/if}
					<div class="flex gap-2">
						<form
							method="POST"
							action="?/refresh"
							use:enhance={() =>
								async ({ result, update }) => {
									await update();
									if (result.type === 'success' && result.data?.refreshedOne) {
										toast.show({
											message: `${feed.title}: ${describe(result.data.refreshedOne as never)}`
										});
									}
								}}
						>
							<input type="hidden" name="feedId" value={feed.id} />
							<button
								class="h-10 rounded-md border border-rule-strong px-3.5 font-ui text-sm font-bold text-ink hover:border-ink"
								>Refresh</button
							>
						</form>
						<form
							method="POST"
							action="?/unsubscribe"
							use:enhance={({ cancel }) => {
								if (!confirm(`Stop following ${feed.title}?`)) return cancel();
								return async ({ result, update }) => {
									await update();
									if (result.type === 'success')
										toast.show({ message: `Unfollowed ${feed.title}` });
								};
							}}
						>
							<input type="hidden" name="feedId" value={feed.id} />
							<button class="h-10 rounded-md px-3 font-ui text-sm text-ink-3 hover:text-[#9b2c1f]"
								>Unfollow</button
							>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	</section>
</div>
