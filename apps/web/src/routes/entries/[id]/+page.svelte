<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { hostname, relativeDay } from '$lib/format';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();
	const entry = $derived(data.entry);
	const original = $derived(entry.url ?? entry.siteUrl);
	const host = $derived(original ? hostname(original) : null);

	// Opening a post marks it read.
	$effect(() => {
		if (data.entry.readAt) return;
		const body = new FormData();
		body.set('read', 'true');
		fetch(`${resolve('/entries/[id]', { id: data.entry.id })}?/read`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).then(async (r) => {
			if (deserialize(await r.text()).type === 'success') invalidateAll();
		});
	});
</script>

<svelte:head>
	<title>{entry.title ?? 'Post'} · Reading List</title>
</svelte:head>

<article class="pb-16">
	{#if entry.imageUrl}
		<LinkImage
			link={{
				url: original ?? 'https://example.com',
				imageUrl: entry.imageUrl,
				title: entry.title
			}}
			class="h-[min(18.75rem,45vh)] lg:mx-auto lg:mt-8 lg:h-[26rem] lg:max-w-4xl lg:rounded-md"
		/>
	{/if}

	<div class="mx-auto max-w-[44rem] px-5.5">
		<a
			href={resolve('/feeds')}
			class="mt-3 -ml-1 flex h-11 w-fit items-center gap-1.5 kicker text-ink-2 hover:text-ink"
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

		<header class="flex flex-col gap-3 pt-3">
			<div class="kicker text-accent">
				{entry.feedTitle} · {data.minutes} min read
			</div>
			<h1 class="headline text-[2.375rem] leading-[1.04] tracking-[-0.018em] lg:text-[3.25rem]">
				{entry.title ?? 'Untitled'}
			</h1>
			<div
				class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-y border-rule py-3.5 font-ui text-sm text-ink-2"
			>
				{#if entry.author}<span class="font-bold text-ink">{entry.author}</span><span
						aria-hidden="true">·</span
					>{/if}
				{#if original && host}
					<a
						href={original}
						target="_blank"
						rel="noopener noreferrer"
						class="font-bold text-accent hover:underline">{host} ↗</a
					><span aria-hidden="true">·</span>
				{/if}
				<span>{relativeDay(entry.publishedAt ?? entry.createdAt)}</span>
			</div>
		</header>

		{#if data.html}
			<!-- Sanitized server-side (sanitizeEntryHtml) and covered by the CSP. -->
			<div class="prose mt-6">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html data.html}
			</div>
		{:else if entry.summary}
			<p class="prose mt-6">{entry.summary}</p>
		{/if}

		<div aria-hidden="true" class="mt-6 text-center text-sm tracking-[0.4em] text-accent">■</div>

		{#if original && host}
			<a
				href={original}
				target="_blank"
				rel="noopener noreferrer"
				class="mt-6 flex h-12 items-center justify-center gap-2 rounded-md border border-rule-strong font-ui text-[0.9375rem] font-bold text-ink hover:border-ink"
				>Read the original on {host} ↗</a
			>
		{/if}

		<form
			method="POST"
			action="?/read"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'success')
						toast.show({ message: result.data?.read ? 'Marked read' : 'Marked unread' });
				}}
			class="mt-2 flex justify-center"
		>
			<input type="hidden" name="read" value={entry.readAt ? 'false' : 'true'} />
			<button class="h-11 px-3 font-ui text-sm text-ink-3 hover:text-ink"
				>{entry.readAt ? 'Mark unread' : 'Mark read'}</button
			>
		</form>

		{#if data.next}
			<section
				class="mt-8 flex flex-col gap-3 border-t border-rule pt-3.5"
				aria-labelledby="next-heading"
			>
				<h2 id="next-heading" class="kicker text-ink-2">Up next</h2>
				<a href={resolve('/entries/[id]', { id: data.next.id })} class="group flex gap-3.5">
					<div class="flex min-w-0 flex-1 flex-col gap-1.5">
						<span class="kicker text-[0.6875rem] text-accent">{data.next.feedTitle}</span>
						<span class="headline text-[1.375rem] leading-[1.15] group-hover:text-accent-strong"
							>{data.next.title ?? 'Untitled'}</span
						>
					</div>
					{#if data.next.imageUrl}
						<LinkImage
							link={{
								url: data.next.url ?? 'https://example.com',
								imageUrl: data.next.imageUrl,
								title: data.next.title
							}}
							class="h-21 w-21 shrink-0 rounded"
						/>
					{/if}
				</a>
			</section>
		{/if}
	</div>
</article>
