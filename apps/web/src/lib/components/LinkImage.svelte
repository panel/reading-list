<script lang="ts">
	import { displayTitle, hostname, toneFor } from '$lib/format';

	let {
		link,
		class: className = ''
	}: {
		link: { url: string; imageUrl: string | null; title: string | null };
		class?: string;
	} = $props();

	let failed = $state(false);
	const host = $derived(hostname(link.url));
	const initial = $derived(displayTitle(link).trim().charAt(0).toUpperCase());
</script>

<!-- container-type: size lets the placeholder letter scale with the box's height. -->
<div
	class="[container-type:size] relative overflow-hidden {className}"
	style:background-color={toneFor(host)}
>
	{#if link.imageUrl && !failed}
		<img
			src={link.imageUrl}
			alt=""
			loading="lazy"
			decoding="async"
			referrerpolicy="no-referrer"
			class="absolute inset-0 h-full w-full object-cover"
			onerror={() => (failed = true)}
		/>
	{:else}
		<span
			aria-hidden="true"
			class="absolute right-[4cqh] bottom-[-28cqh] font-display text-[115cqh] leading-none font-light text-ink/10 italic select-none"
			>{initial}</span
		>
	{/if}
</div>
