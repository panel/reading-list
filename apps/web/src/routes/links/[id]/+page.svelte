<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Favicon from '$lib/components/Favicon.svelte';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { displayTitle, hostname, relativeDay, siteLabel, wantsDropCap } from '$lib/format';
	import { ignoreShortcut } from '$lib/keys';
	import { citeLink, postAction } from '$lib/signals';
	import { toast, undoQueueChange } from '$lib/toast.svelte';

	let { data } = $props();
	const link = $derived(data.link);
	const host = $derived(hostname(link.url));
	const archived = $derived(link.status === 'archived');
	const action = (name: string) => `${resolve('/links/[id]', { id: link.id })}?/${name}`;

	// Lift toasts above this page's fixed action bar while it's shown.
	$effect(() => {
		toast.raised = true;
		return () => (toast.raised = false);
	});

	let editing = $state(false);
	let noteSection = $state<HTMLElement>();
	let busy = $state(false);

	// Opening the link page records the open, unless it's the page you land on
	// right after saving it. Reading the post here also counts as opening it in
	// its feed, as in the post reader.
	$effect(() => {
		if (data.notice === 'saved') return;
		if (!link.openedAt) postAction(action('opened'));
		const entryId = data.reader?.entryId;
		if (!entryId || data.reader?.entryOpened) return;
		postAction(`${resolve('/entries/[id]', { id: entryId })}?/read`, {
			read: 'true',
			opened: 'true'
		}).then((ok) => {
			if (ok) invalidateAll();
		});
	});

	// While a readable copy is being saved, check back a few times so it appears
	// without a manual refresh.
	let checks = 0;
	$effect(() => {
		const status = data.copy?.status;
		if ((status !== 'pending' && status !== 'fetching') || checks >= 10) return;
		const timer = setTimeout(() => {
			checks++;
			invalidateAll();
		}, 3000);
		return () => clearTimeout(timer);
	});
	const shortDate = (date: Date) =>
		date.toLocaleDateString('en', { month: 'short', day: 'numeric' });

	/** Star: when starring, open the note and tags so you can say why it's worth keeping. */
	const star: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			if (result.type === 'failure') {
				toast.show({ message: String(result.data?.message ?? 'Something went wrong') });
			} else if (result.type === 'success') {
				const starred = result.data?.done === 'starred';
				toast.show({ message: starred ? 'Starred as a reference' : 'Unstarred' });
				if (starred) {
					editing = true;
					noteSection?.scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
			}
		};
	let finishButton = $state<HTMLButtonElement>();
	let starForm = $state<HTMLFormElement>();

	const nextHref = $derived(
		!data.next
			? resolve('/')
			: data.next.kind === 'post'
				? resolve('/entries/[id]', { id: data.next.id })
				: resolve('/links/[id]', { id: data.next.id })
	);

	/** Done: offer Undo, then move on to the top of the inbox. */
	const triage: SubmitFunction = () => {
		busy = true;
		const title = displayTitle(link);
		const next = nextHref;
		return async ({ result, update }) => {
			busy = false;
			if (result.type !== 'success' || !result.data?.undo) return update();
			toast.show({
				message: `Done · ${title}`,
				undo: undoQueueChange(resolve('/links/[id]', { id: link.id }), result.data.undo)
			});
			await goto(next, { invalidateAll: true });
		};
	};

	const withToast =
		(message: (data: Record<string, unknown> | undefined) => string): SubmitFunction =>
		() =>
		async ({ result, update }) => {
			await update({ reset: result.type === 'success' });
			if (result.type === 'success') toast.show({ message: message(result.data) });
			else if (result.type === 'failure')
				toast.show({ message: String(result.data?.message ?? 'Something went wrong') });
		};

	async function copyLink() {
		await navigator.clipboard.writeText(link.url);
		toast.show({ message: 'Link copied' });
		citeLink(link.id);
	}

	function onkeydown(event: KeyboardEvent) {
		if (ignoreShortcut(event)) return;
		const key = event.key.toLowerCase();
		if (key === 'e' && !archived) finishButton?.form?.requestSubmit(finishButton);
		else if (key === 's') starForm?.requestSubmit();
		else if (key === 'j' && data.next) goto(nextHref);
		else if (key === 'o') window.open(link.url, '_blank', 'noopener,noreferrer');
		else return;
		event.preventDefault();
	}

	const barButton =
		'flex h-12.5 items-center justify-center rounded-md border font-ui text-[0.9375rem] font-bold disabled:opacity-60';
	const iconButton = `${barButton} w-12.5 shrink-0 border-rule-strong bg-paper text-ink hover:border-ink`;
	const fieldClass =
		'w-full rounded-md border border-rule-strong bg-surface px-3.5 text-[1.0625rem] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none';
</script>

<svelte:head>
	<title>{displayTitle(link)} · Reading List</title>
</svelte:head>

<svelte:window {onkeydown} />

<div
	class="mx-auto flex flex-col gap-4.5 px-5.5 pt-4 pb-24 lg:pt-10 {data.reader
		? 'max-w-[44rem]'
		: 'max-w-xl'}"
>
	<div class="flex items-center justify-between">
		<a
			href={resolve(archived ? '/archive' : '/')}
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
			{archived ? 'Archive' : 'Inbox'}
		</a>
		<p class="hidden font-ui text-[0.8125rem] text-ink-3 lg:block">
			<kbd>E</kbd> done · <kbd>S</kbd> star · <kbd>J</kbd> next · <kbd>O</kbd> open
		</p>
	</div>

	{#if data.notice}
		<p role="status" class="rounded-md bg-sunk px-4 py-3 font-ui text-[0.9375rem] text-ink">
			{data.notice === 'saved'
				? 'Saved. It’s in your inbox under Shared.'
				: 'You’d already saved this. It’s updated and back in your inbox.'}
		</p>
	{/if}

	{#if archived}
		<form
			method="POST"
			action={action('restore')}
			use:enhance={withToast(() => 'Back in your inbox')}
			class="flex items-center justify-between gap-3 rounded-md bg-sunk px-4 py-2"
		>
			<span class="font-ui text-[0.9375rem] text-ink">
				Done {link.readAt ? relativeDay(link.readAt) : ''}
			</span>
			<button class="h-11 rounded-md px-2 font-ui text-sm font-bold text-accent hover:underline"
				>Back to inbox</button
			>
		</form>
	{/if}

	{#if data.reader}
		<!-- The saved copy (or a matching feed post), read here like a post in the reader. -->
		{#if link.imageUrl}
			<LinkImage {link} class="h-[min(18.75rem,45vh)] rounded-md lg:h-[26rem]" />
		{/if}
		<header class="flex flex-col gap-3">
			<div class="kicker text-accent">
				{data.reader.kicker} · {data.reader.minutes} min read{#if link.isReference}<span
						class="text-ink-3"
					>
						· ★ Reference</span
					>{/if}
			</div>
			<h1 class="headline text-[2.375rem] leading-[1.04] tracking-[-0.018em] lg:text-[3.25rem]">
				{displayTitle(link)}
			</h1>
			<div
				class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-y border-rule py-3.5 font-ui text-sm text-ink-2"
			>
				{#if data.reader.author}<span class="font-bold text-ink">{data.reader.author}</span><span
						aria-hidden="true">·</span
					>{/if}
				<a
					href={link.url}
					target="_blank"
					rel="noopener noreferrer"
					class="font-bold text-accent hover:underline">{host} ↗</a
				>{#if data.reader.date}<span aria-hidden="true">·</span>
					<span>{relativeDay(data.reader.date)}</span>{/if}
			</div>
		</header>
	{:else}
		<a
			href={link.url}
			target="_blank"
			rel="noopener noreferrer"
			class="group flex flex-col overflow-hidden rounded-md border border-rule bg-surface"
		>
			<LinkImage {link} class="h-49 lg:h-64" />
			<div class="flex flex-col gap-2 px-4.5 pt-4 pb-4.5">
				<div class="flex items-center gap-2 kicker text-accent">
					<Favicon src={link.faviconUrl} />{siteLabel(link)}
					{#if link.isReference}<span class="text-ink-3">· ★ Reference</span>{/if}
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
	{/if}

	{@render copyStatus()}

	<section
		bind:this={noteSection}
		class="flex flex-col gap-2 rounded-md bg-sunk px-4 py-3.5"
		aria-labelledby="note-heading"
	>
		<div class="flex items-center justify-between gap-3">
			<h2 id="note-heading" class="kicker text-[0.6875rem] text-accent">
				Your note · saved {relativeDay(link.savedAt)}
			</h2>
			{#if !editing}
				<button
					type="button"
					onclick={() => (editing = true)}
					class="-my-2 h-10 px-2 font-ui text-sm font-bold text-accent hover:underline">Edit</button
				>
			{/if}
		</div>
		{#if editing}
			<form
				method="POST"
				action={action('edit')}
				use:enhance={() => {
					return async ({ result, update }) => {
						await update({ reset: false });
						if (result.type === 'success') {
							editing = false;
							toast.show({ message: 'Saved' });
						}
					};
				}}
				class="flex flex-col gap-3"
			>
				<label class="sr-only" for="edit-note">Note</label>
				<textarea
					id="edit-note"
					name="note"
					rows="5"
					class="{fieldClass} resize-y py-3 leading-[1.55]">{link.note ?? ''}</textarea
				>
				<label for="edit-tags" class="kicker text-[0.6875rem] text-accent">Tags</label>
				<input
					id="edit-tags"
					name="tags"
					type="text"
					autocomplete="off"
					autocapitalize="none"
					value={link.tags.join(', ')}
					class="{fieldClass} h-12 font-ui"
				/>
				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={() => (editing = false)}
						class="h-11 rounded-md px-4 font-ui text-sm font-bold text-ink-2 hover:text-ink"
						>Cancel</button
					>
					<button
						class="h-11 rounded-md bg-ink px-5 font-ui text-sm font-bold text-paper hover:bg-accent-strong"
						>Save</button
					>
				</div>
			</form>
		{:else}
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
				<p class="font-ui text-[0.8125rem] text-ink-2">
					{link.tags.map((t) => `#${t}`).join('  ')}
				</p>
			{/if}
		{/if}
	</section>

	{#if data.reader}
		<!-- Sanitized server-side (sanitizeEntryHtml) and covered by the CSP. -->
		<div class="prose mt-2">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html data.reader.html}
		</div>
		<div aria-hidden="true" class="mt-2 text-center text-sm tracking-[0.4em] text-accent">■</div>
		<a
			href={link.url}
			target="_blank"
			rel="noopener noreferrer"
			class="flex h-12 items-center justify-center gap-2 rounded-md border border-rule-strong font-ui text-[0.9375rem] font-bold text-ink hover:border-ink"
			>Read the original on {host} ↗</a
		>
	{/if}

	<form
		method="POST"
		action={action('addNote')}
		use:enhance={withToast(() => 'Note added')}
		class="mt-4 flex flex-col gap-2.5 border-t-2 border-ink pt-4"
	>
		<label for="add-note" class="kicker text-accent">Your notes</label>
		<textarea
			id="add-note"
			name="note"
			rows="4"
			required
			placeholder="What stuck with you? Quotes, takeaways, who to send it to…"
			class="{fieldClass} resize-y py-3 leading-[1.55]"></textarea>
		<div class="flex items-center justify-between gap-3">
			<span class="font-ui text-[0.8125rem] text-ink-3">Added to the note above</span>
			<button
				class="h-11 rounded-md border border-ink px-4.5 font-ui text-[0.9375rem] font-bold text-ink hover:bg-ink hover:text-paper"
				>Save note</button
			>
		</div>
	</form>

	{#if data.next}
		<section
			class="mt-4 flex flex-col gap-3 border-t border-rule pt-3.5"
			aria-labelledby="next-heading"
		>
			<h2 id="next-heading" class="kicker text-ink-2">
				Up next{#if !archived}<span class="text-ink-3"> · Done takes you here</span>{/if}
			</h2>
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

	<form
		method="POST"
		action={action('delete')}
		use:enhance={({ cancel }) => {
			if (!confirm('Delete this link and its notes? This can’t be undone.')) return cancel();
			return async ({ result, update }) => {
				if (result.type === 'redirect') toast.show({ message: 'Deleted' });
				await update();
			};
		}}
		class="mt-6 flex justify-center"
	>
		<button
			class="h-11 px-3 font-ui text-sm text-ink-3 underline-offset-2 hover:text-[#9b2c1f] hover:underline"
			>Delete link</button
		>
	</form>
</div>

<!-- Action bar: sits above the mobile tab bar, at the bottom of the window on desktop. -->
<div
	class="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-rule bg-paper/95 backdrop-blur lg:bottom-0"
>
	<div class="mx-auto flex max-w-xl gap-2 px-3.5 py-2.5">
		<form bind:this={starForm} method="POST" action={action('star')} use:enhance={star}>
			<input type="hidden" name="starred" value={String(!link.isReference)} />
			<button
				aria-label={link.isReference ? 'Unstar' : 'Star as reference'}
				aria-pressed={link.isReference}
				class="{iconButton} {link.isReference ? 'text-accent' : ''}"
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill={link.isReference ? 'currentColor' : 'none'}
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linejoin="round"
					aria-hidden="true"
					><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg
				>
			</button>
		</form>
		<button type="button" onclick={copyLink} aria-label="Copy link" class={iconButton}>
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
		{#if archived}
			<form
				method="POST"
				action={action('restore')}
				use:enhance={withToast(() => 'Back in your inbox')}
				class="flex flex-[2.3]"
			>
				<button class="{barButton} flex-1 border-ink bg-ink text-paper hover:bg-accent-strong"
					>Back to inbox</button
				>
			</form>
		{:else}
			<form method="POST" use:enhance={triage} class="flex flex-1">
				<button
					bind:this={finishButton}
					formaction={action('finish')}
					disabled={busy}
					class="{barButton} flex-1 border-ink bg-ink text-paper hover:bg-accent-strong"
					>Done</button
				>
			</form>
		{/if}
	</div>
</div>

<!-- The readable copy: saved (and until when), on its way, failed, or cleared. -->
{#snippet copyStatus()}
	{@const copy = data.copy}
	{#if copy?.status === 'ready'}
		<p class="-mt-1.5 font-ui text-[0.8125rem] text-ink-3">
			{[
				'Saved copy',
				copy.capturedAt && relativeDay(copy.capturedAt),
				copy.keepUntil
					? `kept until ${shortDate(copy.keepUntil)} (star it to keep it)`
					: link.isReference && 'kept for good'
			]
				.filter(Boolean)
				.join(' · ')}
		</p>
	{:else if copy?.status === 'pending' || copy?.status === 'fetching'}
		<p role="status" class="-mt-1.5 font-ui text-[0.8125rem] text-ink-3">Saving a readable copy…</p>
	{:else if !data.reader || copy?.status === 'failed'}
		<form
			method="POST"
			action={action('archive')}
			use:enhance={() =>
				async ({ update }) => {
					checks = 0;
					await update();
				}}
			class="-mt-1.5 flex flex-wrap items-center gap-x-3 font-ui text-[0.8125rem] text-ink-3"
		>
			<span>
				{#if copy?.status === 'failed'}
					Couldn’t save a readable copy{copy.error ? `: ${copy.error}` : ''}.
				{:else if archived && !link.isReference}
					The readable copy was cleared 14 days after you finished this.
				{:else}
					No readable copy yet.
				{/if}
			</span>
			<button class="h-9 font-bold text-accent hover:underline"
				>{copy?.status === 'failed' ? 'Try again' : 'Make a readable copy'}</button
			>
		</form>
	{/if}
{/snippet}
