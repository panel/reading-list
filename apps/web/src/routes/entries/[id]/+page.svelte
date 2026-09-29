<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { ignoreShortcut } from '$lib/keys';
	import { resolve } from '$app/paths';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { hostname, relativeDay } from '$lib/format';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();
	const entry = $derived(data.entry);
	const original = $derived(entry.url ?? entry.siteUrl);
	const host = $derived(original ? hostname(original) : null);

	const starred = $derived(Boolean(data.link?.isReference));
	const nextHref = $derived(
		!data.next
			? resolve('/')
			: data.next.kind === 'post'
				? resolve('/entries/[id]', { id: data.next.id })
				: resolve('/links/[id]', { id: data.next.id })
	);
	let starForm = $state<HTMLFormElement>();
	let editingNote = $state(false);
	let noteForm = $state<HTMLFormElement>();

	// Lift toasts above this page's fixed action bar.
	$effect(() => {
		toast.raised = true;
		return () => (toast.raised = false);
	});

	const star: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			if (result.type === 'success') {
				const starred = result.data?.done === 'starred';
				toast.show({ message: starred ? 'Starred as a reference' : 'Unstarred' });
				// Starring opens the note and tags, so you can say why it's worth keeping.
				editingNote = starred;
				if (starred) {
					await tick();
					noteForm?.scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
			} else if (result.type === 'failure') {
				toast.show({ message: String(result.data?.message ?? 'Couldn’t star this post') });
			}
		};

	async function copyLink() {
		if (!original) return;
		await navigator.clipboard.writeText(original);
		toast.show({ message: 'Link copied' });
	}

	function onkeydown(event: KeyboardEvent) {
		if (ignoreShortcut(event)) return;
		const key = event.key.toLowerCase();
		if (key === 's') starForm?.requestSubmit();
		else if (key === 'j' || key === 'e') goto(nextHref);
		else if (key === 'o' && original) window.open(original, '_blank', 'noopener,noreferrer');
		else return;
		event.preventDefault();
	}

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

<svelte:window {onkeydown} />

<article class="pb-28">
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
			href={resolve('/')}
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
			Inbox
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

		{#if editingNote && data.link}
			<form
				bind:this={noteForm}
				method="POST"
				action="{resolve('/links/[id]', { id: data.link.id })}?/edit"
				use:enhance={() =>
					async ({ result, update }) => {
						await update({ reset: false });
						if (result.type === 'success') {
							editingNote = false;
							toast.show({ message: 'Note saved' });
						}
					}}
				class="mt-6 flex flex-col gap-2.5 rounded-md border border-accent bg-surface p-4"
			>
				<p class="kicker text-accent">★ In your library · add a note?</p>
				<label for="save-note" class="sr-only">Note</label>
				<textarea
					id="save-note"
					name="note"
					rows="3"
					placeholder="Why it's worth keeping, when you'd cite it…"
					class="w-full resize-y rounded-md border border-rule-strong bg-surface px-3.5 py-3 text-[1.0625rem] leading-[1.55] placeholder:text-ink-3 focus:border-accent focus:outline-none"
					>{data.link.note ?? ''}</textarea
				>
				<label for="save-tags" class="sr-only">Tags</label>
				<input
					id="save-tags"
					name="tags"
					type="text"
					autocomplete="off"
					autocapitalize="none"
					value={data.link.tags.join(', ')}
					placeholder="Tags, e.g. architecture, testing"
					class="h-12 w-full rounded-md border border-rule-strong bg-surface px-3.5 font-ui text-base placeholder:text-ink-3 focus:border-accent focus:outline-none"
				/>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={() => (editingNote = false)}
						class="h-11 rounded-md px-4 font-ui text-sm font-bold text-ink-2 hover:text-ink"
						>Skip</button
					>
					<button
						class="h-11 rounded-md bg-ink px-5 font-ui text-sm font-bold text-paper hover:bg-accent-strong"
						>Save</button
					>
				</div>
			</form>
		{:else if starred && data.link}
			<div class="mt-6 flex flex-col gap-2 rounded-md bg-sunk px-4 py-3.5">
				<div class="flex items-center justify-between gap-3">
					<p class="kicker text-[0.6875rem] text-accent">★ Your note</p>
					<button
						type="button"
						onclick={() => (editingNote = true)}
						class="-my-2 h-10 px-2 font-ui text-sm font-bold text-accent hover:underline"
						>{data.link.note || data.link.tags.length ? 'Edit' : 'Add a note'}</button
					>
				</div>
				{#if data.link.note}
					<p class="text-[1.0625rem] leading-[1.55] whitespace-pre-line">{data.link.note}</p>
				{/if}
				{#if data.link.tags.length}
					<p class="font-ui text-[0.8125rem] text-ink-2">
						{data.link.tags.map((t) => `#${t}`).join('  ')}
					</p>
				{/if}
			</div>
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
				<a href={nextHref} class="group flex gap-3.5">
					<div class="flex min-w-0 flex-1 flex-col gap-1.5">
						<span class="kicker text-[0.6875rem] text-accent"
							>{data.next.kind === 'shared' ? 'Shared · ' : ''}{data.next.source}</span
						>
						<span class="headline text-[1.375rem] leading-[1.15] group-hover:text-accent-strong"
							>{data.next.title}</span
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

<!-- Action bar: above the mobile tab bar, at the bottom of the window on desktop. -->
<div
	class="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-rule bg-paper/95 backdrop-blur lg:bottom-0"
>
	<div class="mx-auto flex max-w-[44rem] gap-2 px-3.5 py-2.5">
		<form bind:this={starForm} method="POST" action="?/star" use:enhance={star}>
			<input type="hidden" name="starred" value={String(!starred)} />
			<button
				disabled={!original}
				aria-label={starred ? 'Unstar' : 'Star as reference'}
				aria-pressed={starred}
				class="flex h-12.5 w-12.5 items-center justify-center rounded-md border border-rule-strong bg-paper hover:border-ink disabled:opacity-50 {starred
					? 'text-accent'
					: 'text-ink'}"
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill={starred ? 'currentColor' : 'none'}
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linejoin="round"
					aria-hidden="true"
					><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg
				>
			</button>
		</form>
		<button
			type="button"
			onclick={copyLink}
			disabled={!original}
			aria-label="Copy link"
			class="flex h-12.5 w-12.5 items-center justify-center rounded-md border border-rule-strong bg-paper text-ink hover:border-ink disabled:opacity-50"
		>
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path
					d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
				/></svg
			>
		</button>
		<a
			href={nextHref}
			class="flex h-12.5 flex-1 items-center justify-center rounded-md bg-ink font-ui text-[0.9375rem] font-bold text-paper hover:bg-accent-strong"
			>{data.next ? 'Next →' : 'Back to inbox'}</a
		>
	</div>
</div>
