<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { displayTitle, relativeDay, siteLabel } from '$lib/format';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Archive · Reading List</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-5 pt-6 lg:pt-12">
	<header class="border-b-2 border-ink pb-4">
		<h1 class="headline text-[2.1rem] leading-[1.05] lg:text-5xl">Archive</h1>
		<p class="mt-2 font-ui text-[0.9375rem] text-ink-2">
			{data.archive.total}
			{data.archive.total === 1 ? 'link' : 'links'} you’re done with, most recent first.
		</p>
	</header>

	{#if data.archive.items.length === 0}
		<p class="py-12 text-center text-[1.0625rem] text-ink-2 italic">
			Nothing here yet. Swipe left on a shared link in your inbox when you’re done with it.
		</p>
	{:else}
		<ul>
			{#each data.archive.items as item (item.id)}
				<li class="flex items-center gap-3.5 border-b border-rule py-4">
					<LinkImage link={item} class="h-16 w-16 shrink-0 rounded" />
					<a
						href={resolve('/links/[id]', { id: item.id })}
						class="group flex min-w-0 flex-1 flex-col gap-1"
					>
						<span class="kicker text-[0.6875rem] text-accent"
							>{siteLabel(item)}{#if item.isReference}<span class="text-ink-3">
									· ★</span
								>{/if}</span
						>
						<span class="headline text-lg leading-[1.2] group-hover:text-accent-strong"
							>{displayTitle(item)}</span
						>
						{#if item.readAt}
							<span class="font-ui text-[0.8125rem] text-ink-3"
								>Done {relativeDay(item.readAt)}</span
							>
						{/if}
					</a>
					<form
						method="POST"
						action="{resolve('/links/[id]', { id: item.id })}?/restore"
						use:enhance={() =>
							async ({ result, update }) => {
								if (result.type === 'success') toast.show({ message: 'Back in your inbox' });
								await update();
							}}
					>
						<button
							class="h-11 shrink-0 rounded-md border border-rule-strong px-3 font-ui text-sm font-bold text-accent hover:border-accent"
							>Back to inbox</button
						>
					</form>
				</li>
			{/each}
		</ul>

		{#if data.pageCount > 1}
			<nav aria-label="Pages" class="flex justify-between py-6 font-ui text-sm font-bold">
				{#if data.page > 1}
					<a href="{resolve('/archive')}?page={data.page - 1}" class="text-accent">← Newer</a>
				{:else}<span></span>{/if}
				<span class="text-ink-3">Page {data.page} of {data.pageCount}</span>
				{#if data.page < data.pageCount}
					<a href="{resolve('/archive')}?page={data.page + 1}" class="text-accent">Older →</a>
				{:else}<span></span>{/if}
			</nav>
		{/if}
	{/if}
</div>
