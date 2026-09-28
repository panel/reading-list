<script lang="ts">
	import { resolve } from '$app/paths';
	import LinkImage from '$lib/components/LinkImage.svelte';
	import { displayTitle, relativeDay, siteLabel, wantsDropCap } from '$lib/format';

	let { data } = $props();
	const lead = $derived(data.queue.items[0]);
	const upNext = $derived(data.queue.items.slice(1));
</script>

<svelte:head>
	<title>Queue · Reading List</title>
</svelte:head>

<div class="mx-auto max-w-[1280px] px-3.5 lg:px-16">
	<div class="flex items-baseline justify-between px-1.5 pt-4 pb-3 lg:px-0 lg:pt-9">
		<h1 class="kicker text-ink-2">Queue · {data.queue.total}</h1>
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
			<article
				class="min-w-0 overflow-hidden rounded-md border border-rule bg-surface shadow-[0_1px_2px_rgb(21_32_32/0.06),0_8px_24px_rgb(21_32_32/0.06)] lg:col-span-8 lg:rounded-none lg:border-0 lg:border-r lg:bg-transparent lg:pr-8 lg:shadow-none"
			>
				<a href={resolve('/links/[id]', { id: lead.id })} class="block">
					<LinkImage link={lead} class="[container-type:inline-size] h-64 lg:h-96 lg:rounded" />
				</a>
				<div class="flex flex-col gap-2.5 px-5.5 pt-4.5 pb-5 lg:px-0">
					<div class="kicker text-accent">{siteLabel(lead)}</div>
					<h2 class="headline text-[1.95rem] leading-[1.08] lg:text-[3.25rem] lg:leading-[1.02]">
						<a href={resolve('/links/[id]', { id: lead.id })} class="hover:text-accent-strong"
							>{displayTitle(lead)}</a
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
						<p class="mt-1 text-[1.0625rem] leading-[1.55] text-ink-2 lg:max-w-[36rem] lg:text-lg">
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
									<LinkImage
										link={item}
										class="[container-type:inline-size] h-21 w-21 shrink-0 rounded"
									/>
								</a>
							</li>
						{/each}
					</ul>
				</aside>
			{/if}
		</div>
	{/if}
</div>
