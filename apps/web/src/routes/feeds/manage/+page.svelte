<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { hostname, relativeDay } from '$lib/format';
	import { toast } from '$lib/toast.svelte';

	let { data, form } = $props();
	let adding = $state(false);
	let importing = $state(false);

	const groups = $derived(
		[...data.folders, null]
			.map((folder) => ({ folder, feeds: data.feeds.filter((f) => f.folder === folder) }))
			.filter((g) => g.feeds.length)
	);

	const describe = (r: { status: string; newEntries?: number; error?: string }) =>
		r.status === 'updated'
			? `${r.newEntries} new ${r.newEntries === 1 ? 'post' : 'posts'}`
			: r.status === 'not-modified'
				? 'No new posts'
				: `Failed: ${r.error}`;

	const field =
		'h-12 min-w-0 flex-1 rounded-md border border-rule-strong bg-surface px-3.5 font-ui text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none';
	const smallButton =
		'h-10 rounded-md border border-rule-strong px-3.5 font-ui text-sm font-bold text-ink hover:border-ink';
</script>

<svelte:head>
	<title>Manage feeds · Reading List</title>
</svelte:head>

<div class="mx-auto flex max-w-xl flex-col gap-9 px-5.5 pt-5 lg:pt-10">
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
					class={field}
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

	<section class="flex flex-col gap-3" aria-labelledby="import-heading">
		<h2 id="import-heading" class="border-b-2 border-ink pb-3 kicker text-ink-2">
			Import &amp; export
		</h2>
		<p class="text-base leading-[1.55] text-ink-2">
			Moving from another reader? Export its subscriptions as OPML and import them here. Folders
			come along. New feeds fill in over the next few minutes as they’re checked.
		</p>
		<form
			method="POST"
			action="?/import"
			enctype="multipart/form-data"
			use:enhance={() => {
				importing = true;
				return async ({ result, update }) => {
					await update();
					importing = false;
					if (result.type === 'success' && result.data?.imported) {
						const { added, alreadyFollowing } = result.data.imported as {
							added: number;
							alreadyFollowing: number;
						};
						toast.show({
							message: `Imported ${added} ${added === 1 ? 'feed' : 'feeds'}${alreadyFollowing ? ` · ${alreadyFollowing} already followed` : ''}`
						});
					}
				};
			}}
			class="flex flex-col gap-2"
		>
			<label for="opml" class="sr-only">OPML file</label>
			<div class="flex flex-wrap items-center gap-2">
				<input
					id="opml"
					name="opml"
					type="file"
					accept=".opml,.xml,text/xml,application/xml,text/x-opml"
					required
					class="min-w-0 flex-1 font-ui text-sm text-ink-2 file:mr-3 file:h-10 file:rounded-md file:border file:border-rule-strong file:bg-paper file:px-3.5 file:font-bold file:text-ink"
				/>
				<button disabled={importing} class="{smallButton} disabled:opacity-60"
					>{importing ? 'Importing…' : 'Import'}</button
				>
			</div>
			{#if form?.importError}
				<p class="font-ui text-sm font-bold text-[#9b2c1f]">{form.importError}</p>
			{/if}
		</form>
		{#if data.feeds.length}
			<a
				href={resolve('/export/feeds.opml')}
				class="font-ui text-sm font-bold text-accent hover:underline"
				>Export subscriptions as OPML ↓</a
			>
		{/if}
	</section>

	<section class="flex flex-col" aria-labelledby="following-heading">
		<h2 id="following-heading" class="border-b-2 border-ink pb-3 kicker text-ink-2">
			Following · {data.feeds.length}
		</h2>
		{#if data.feeds.length === 0}
			<p class="py-6 font-ui text-[0.9375rem] text-ink-3">Nothing yet.</p>
		{/if}

		<datalist id="folders">
			{#each data.folders as folder (folder)}<option value={folder}></option>{/each}
		</datalist>

		{#each groups as group (group.folder ?? '')}
			{#if data.folders.length}
				<h3 class="mt-6 headline text-lg">{group.folder ?? 'No folder'}</h3>
			{/if}
			<ul>
				{#each group.feeds as feed (feed.id)}
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
						<div class="flex flex-wrap gap-2">
							<form
								method="POST"
								action="?/folder"
								use:enhance={() =>
									async ({ result, update }) => {
										await update({ reset: false });
										if (result.type === 'success') toast.show({ message: `Moved ${feed.title}` });
									}}
								class="flex gap-1.5"
							>
								<input type="hidden" name="feedId" value={feed.id} />
								<label for="folder-{feed.id}" class="sr-only">Folder for {feed.title}</label>
								<input
									id="folder-{feed.id}"
									name="folder"
									list="folders"
									value={feed.folder ?? ''}
									placeholder="Folder"
									autocomplete="off"
									class="h-10 w-32 rounded-md border border-rule-strong bg-surface px-2.5 font-ui text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
								/>
								<button class={smallButton}>Move</button>
							</form>
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
								<button class={smallButton}>Refresh</button>
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
		{/each}
	</section>
</div>
