<script lang="ts">
	let { src }: { src: string | null } = $props();
	let failed = $state(false);
</script>

{#if src && !failed}
	<img
		{src}
		alt=""
		width="16"
		height="16"
		loading="lazy"
		referrerpolicy="no-referrer"
		class="h-4 w-4 shrink-0 rounded-[3px]"
		onerror={() => (failed = true)}
	/>
{:else}
	<span aria-hidden="true" class="inline-block h-4 w-4 shrink-0 rounded-[3px] bg-rule"></span>
{/if}
