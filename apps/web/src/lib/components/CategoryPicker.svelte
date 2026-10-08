<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from '$lib/toast.svelte';

	/**
	 * Shows an item's category and lets you correct it. A correction is kept
	 * when categories are re-sorted, and recent ones teach the model by example.
	 */
	let {
		categories,
		current,
		action
	}: {
		categories: { slug: string; name: string }[];
		/** The item's main category slug, or null if it hasn't been sorted yet. */
		current: string | null;
		action: string;
	} = $props();

	let form = $state<HTMLFormElement>();
	const options = $derived([...categories, { slug: 'other', name: 'Other' }]);
</script>

{#if categories.length}
	<form
		bind:this={form}
		method="POST"
		{action}
		use:enhance={({ formData }) =>
			async ({ result, update }) => {
				await update({ reset: false });
				const name = options.find((o) => o.slug === formData.get('category'))?.name;
				if (result.type === 'success') toast.show({ message: `Moved to ${name}` });
				else if (result.type === 'failure')
					toast.show({ message: String(result.data?.message ?? 'Couldn’t change the category') });
			}}
		class="inline-flex items-center gap-1.5"
	>
		<label for="item-category" class="text-ink-3">Category</label>
		<select
			id="item-category"
			name="category"
			value={current ?? ''}
			onchange={() => form?.requestSubmit()}
			class="h-8 rounded-md border border-rule-strong bg-paper px-2 font-ui text-sm font-bold text-ink focus:border-accent focus:outline-none"
		>
			{#if !current}<option value="" disabled>Not sorted yet</option>{/if}
			{#each options as o (o.slug)}<option value={o.slug}>{o.name}</option>{/each}
		</select>
	</form>
{/if}
