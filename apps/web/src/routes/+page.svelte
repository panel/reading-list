<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { flyOff, swipe } from '$lib/actions/swipe';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { displayTitle, relativeDay, siteLabel, wantsDropCap } from '$lib/format';
	import { ignoreShortcut } from '$lib/keys';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();
	const lead = $derived(data.queue.items[0]);
	const upNext = $derived(data.queue.items.slice(1));

	let card = $state<HTMLElement>();
	let laterButton = $state<HTMLButtonElement>();
	let finishButton = $state<HTMLButtonElement>();
	let starForm = $state<HTMLFormElement>();
	let dragX = $state(0);
	let busy = $state(false);

	const hint = (value: number) => Math.max(0, Math.min(1, value / 90)).toFixed(2);

	/** Finished (1) or Later (-1) on the lead card, from a swipe, button or key. */
	function act(direction: 1 | -1, animate = true) {
		if (busy || !lead) return;
		if (animate) flyOff(card, direction);
		const button = direction === 1 ? finishButton : laterButton;
		button?.form?.requestSubmit(button);
	}

	const triage: SubmitFunction = ({ submitter }) => {
		busy = true;
		const title = lead ? displayTitle(lead) : '';
		const done = submitter?.getAttribute('value');
		// Buttons pressed directly animate here; swipes have already flown off.
		if (card && !card.style.transform) flyOff(card, done === 'finished' ? 1 : -1);
		return async ({ result, update }) => {
			if (result.type === 'success' && result.data?.undo) {
				toast.show({
					message: `${result.data.done === 'finished' ? 'Finished' : 'Later'} · ${title}`,
					undo: { id: result.data.id as string, state: result.data.undo }
				});
			}
			await update();
			busy = false;
			dragX = 0;
		};
	};

	const star: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success') {
				toast.show({
					message: result.data?.done === 'starred' ? 'Starred as a reference' : 'Unstarred'
				});
			}
			await update();
		};
	};

	function onkeydown(event: KeyboardEvent) {
		if (!lead || ignoreShortcut(event)) return;
		const key = event.key.toLowerCase();
		if (key === 'e') act(1);
		else if (key === 'l') act(-1);
		else if (key === 's') starForm?.requestSubmit();
		else if (key === 'o' || key === 'enter') goto(resolve('/links/[id]', { id: lead.id }));
		else return;
		event.preventDefault();
	}

	const actionButton =
		'h-13 flex-1 rounded-md border font-ui text-[0.9375rem] font-bold disabled:opacity-60 lg:h-10 lg:flex-none lg:px-4 lg:text-sm';
</script>

<svelte:head>
	<title>Queue · Reading List</title>
</svelte:head>

<svelte:window {onkeydown} />

<div class="mx-auto max-w-[1280px] px-3.5 lg:px-16">
	<div class="flex items-baseline justify-between px-1.5 pt-4 pb-3 lg:px-0 lg:pt-9">
		<h1 class="kicker text-ink-2">Queue · {data.queue.total}</h1>
		{#if lead}
			<p class="hidden font-ui text-[0.8125rem] text-ink-3 lg:block">
				<kbd>E</kbd> finished · <kbd>L</kbd> later · <kbd>S</kbd> star · <kbd>O</kbd> open
			</p>
		{/if}
	</div>

	{#if !lead}
		<div class="mx-auto max-w-md px-3 py-16 text-center">
			<p class="headline text-3xl">Nothing in your queue</p>
			<p class="mt-3 text-[1.0625rem] leading-relaxed text-ink-2">
				Save a link and it shows up here, ready to read.
			</p>
			<a
				href={resolve('/save')}
				class="mt-6 inline-flex h-12 items-center rounded-md bg-ink px-6 font-ui font-bold text-paper hover:bg-accent-strong"
				>Save a link</a
			>
		</div>
	{:else}
		<div class="grid gap-8 lg:grid-cols-12">
			<div class="min-w-0 lg:col-span-8 lg:border-r lg:border-rule lg:pr-8">
				<!-- The stage: swipe hints and the next card sit behind the lead card. -->
				<div class="relative">
					<div
						aria-hidden="true"
						class="pointer-events-none absolute inset-0 flex items-center justify-between px-5 kicker text-sm lg:hidden"
					>
						<span class="text-accent" style:opacity={hint(-dragX)}>← Later</span>
						<span class="text-ink" style:opacity={hint(dragX)}>Finished →</span>
					</div>
					{#if upNext[0]}
						<div
							aria-hidden="true"
							class="absolute inset-x-2.5 top-3 bottom-0 rounded-md border border-rule bg-surface opacity-70 lg:hidden"
						></div>
					{/if}

					{#key lead.id}
						<article
							bind:this={card}
							use:swipe={{
								onswipe: (d) => act(d, false),
								ondrag: (x) => (dragX = x),
								disabled: busy
							}}
							class="relative overflow-hidden rounded-md border border-rule bg-surface shadow-[0_1px_2px_rgb(21_32_32/0.06),0_8px_24px_rgb(21_32_32/0.06)] select-none lg:rounded-none lg:border-0 lg:bg-paper lg:shadow-none lg:select-auto"
						>
							<a href={resolve('/links/[id]', { id: lead.id })} class="block" draggable="false">
								<LinkImage link={lead} class="h-64 lg:h-96 lg:rounded" />
							</a>
							<div class="flex flex-col gap-2.5 px-5.5 pt-4.5 pb-5 lg:px-0">
								<div class="kicker text-accent">
									{siteLabel(lead)}{#if lead.isReference}<span class="text-ink-3">
											· ★ Reference</span
										>{/if}
								</div>
								<h2
									class="headline text-[1.95rem] leading-[1.08] lg:text-[3.25rem] lg:leading-[1.02]"
								>
									<a
										href={resolve('/links/[id]', { id: lead.id })}
										class="hover:text-accent-strong"
										draggable="false">{displayTitle(lead)}</a
									>
								</h2>
								<p class="text-[0.9375rem] text-ink-2 italic">
									{[lead.author && `by ${lead.author}`, `saved ${relativeDay(lead.savedAt)}`]
										.filter(Boolean)
										.join(' · ')}
								</p>
								{#if lead.note}
									<p
										class:dropcap={wantsDropCap(lead.note)}
										class="mt-1 text-[1.0625rem] leading-[1.55] whitespace-pre-line lg:max-w-[36rem] lg:text-lg"
									>
										{lead.note}
									</p>
								{:else if lead.description}
									<p
										class="mt-1 text-[1.0625rem] leading-[1.55] text-ink-2 lg:max-w-[36rem] lg:text-lg"
									>
										{lead.description}
									</p>
								{/if}
								{#if lead.tags.length}
									<p class="font-ui text-[0.8125rem] text-ink-2">
										{lead.tags.map((t) => `#${t}`).join('  ')}
									</p>
								{/if}
							</div>
						</article>
					{/key}
				</div>

				<div class="mt-3 flex flex-col gap-2 lg:mt-0 lg:flex-row-reverse lg:justify-end">
					<p class="text-center font-ui text-xs text-ink-3 lg:hidden">
						Swipe right when finished · left to save it for later
					</p>
					<form method="POST" use:enhance={triage} class="flex gap-2">
						<button
							bind:this={laterButton}
							formaction="{resolve('/links/[id]', { id: lead.id })}?/later"
							value="later"
							disabled={busy}
							class="{actionButton} border-rule-strong bg-paper text-accent hover:border-accent"
							>Later</button
						>
						<a
							href={lead.url}
							target="_blank"
							rel="noopener noreferrer"
							class="{actionButton} flex flex-[1.4] items-center justify-center border-ink bg-ink text-paper hover:bg-accent-strong lg:order-first"
							>Read now</a
						>
						<button
							bind:this={finishButton}
							formaction="{resolve('/links/[id]', { id: lead.id })}?/finish"
							value="finished"
							disabled={busy}
							class="{actionButton} border-rule-strong bg-paper text-ink hover:border-ink"
							>Finished</button
						>
					</form>
					<form
						bind:this={starForm}
						method="POST"
						action="{resolve('/links/[id]', { id: lead.id })}?/star"
						use:enhance={star}
						class="hidden lg:block"
					>
						<input type="hidden" name="starred" value={String(!lead.isReference)} />
						<button
							class="{actionButton} border-rule-strong bg-paper text-ink hover:border-ink"
							aria-pressed={lead.isReference}>{lead.isReference ? '★ Starred' : '☆ Star'}</button
						>
					</form>
				</div>
			</div>

			{#if upNext.length}
				<aside class="min-w-0 px-1.5 lg:col-span-4 lg:px-0">
					<h2 class="border-b-2 border-ink pb-3 kicker text-ink-2">Up next</h2>
					<ul>
						{#each upNext as item (item.id)}
							<li class="border-b border-rule">
								<a href={resolve('/links/[id]', { id: item.id })} class="group flex gap-3.5 py-4">
									<div class="flex min-w-0 flex-1 flex-col gap-1.5">
										<span class="kicker text-[0.6875rem] text-accent">{siteLabel(item)}</span>
										<span
											class="headline text-[1.3125rem] leading-[1.15] group-hover:text-accent-strong"
											>{displayTitle(item)}</span
										>
										{#if item.note}
											<span class="line-clamp-2 text-sm leading-[1.45] text-ink-2">{item.note}</span
											>
										{/if}
									</div>
									<LinkImage link={item} class="h-21 w-21 shrink-0 rounded" />
								</a>
							</li>
						{/each}
					</ul>
				</aside>
			{/if}
		</div>
	{/if}
</div>
