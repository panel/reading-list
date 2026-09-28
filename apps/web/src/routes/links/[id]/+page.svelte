<script lang="ts">
	import { resolve } from '$app/paths';
	import Favicon from '$lib/components/Favicon.svelte';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { displayTitle, hostname, relativeDay, siteLabel, wantsDropCap } from '$lib/format';

	let { data } = $props();
	const link = $derived(data.link);
	const host = $derived(hostname(link.url));
</script>

<svelte:head>
	<title>{displayTitle(link)} · Reading List</title>
</svelte:head>

<div class="mx-auto flex max-w-xl flex-col gap-4.5 px-5.5 pt-4 lg:pt-10">
	<a
		href={resolve('/')}
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
		Queue
	</a>

	{#if data.notice}
		<p role="status" class="rounded-md bg-sunk px-4 py-3 font-ui text-[0.9375rem] text-ink">
			{data.notice === 'saved'
				? 'Saved to your queue.'
				: 'You’d already saved this. It’s updated and back in your queue.'}
		</p>
	{/if}

	<a
		href={link.url}
		target="_blank"
		rel="noopener noreferrer"
		class="group flex flex-col overflow-hidden rounded-md border border-rule bg-surface"
	>
		<LinkImage {link} class="[container-type:inline-size] h-49 lg:h-64" />
		<div class="flex flex-col gap-2 px-4.5 pt-4 pb-4.5">
			<div class="flex items-center gap-2 kicker text-accent">
				<Favicon src={link.faviconUrl} />{siteLabel(link)}
			</div>
			<h1 class="headline text-[1.7rem] leading-[1.1] group-hover:text-accent-strong lg:text-4xl">
				{displayTitle(link)}
			</h1>
			{#if link.description}
				<p class="text-base leading-normal text-ink-2">{link.description}</p>
			{/if}
			{#if link.author}
				<p class="text-sm text-ink-3 italic">by {link.author}</p>
			{/if}
		</div>
	</a>

	<a
		href={link.url}
		target="_blank"
		rel="noopener noreferrer"
		class="flex h-13.5 items-center justify-center gap-2 rounded-md bg-ink font-ui text-base font-bold text-paper hover:bg-accent-strong"
	>
		Open on {host}
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"><path d="M7 17L17 7" /><path d="M8 7h9v9" /></svg
		>
	</a>

	<section class="flex flex-col gap-1.5 rounded-md bg-sunk px-4 py-3.5">
		<h2 class="kicker text-[0.6875rem] text-accent">
			Your note · saved {relativeDay(link.savedAt)}
		</h2>
		{#if link.note}
			<p
				class:dropcap={wantsDropCap(link.note)}
				class="text-[1.0625rem] leading-[1.55] whitespace-pre-line"
			>
				{link.note}
			</p>
		{:else}
			<p class="text-base text-ink-3 italic">No note yet.</p>
		{/if}
		{#if link.tags.length}
			<p class="font-ui text-[0.8125rem] text-ink-2">{link.tags.map((t) => `#${t}`).join('  ')}</p>
		{/if}
	</section>
</div>
