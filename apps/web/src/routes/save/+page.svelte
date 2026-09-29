<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let saving = $state(false);

	const inputClass =
		'w-full rounded-md border border-rule-strong bg-surface px-3.5 text-[1.0625rem] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none';
	const labelClass = 'kicker text-accent';
</script>

<svelte:head>
	<title>Save a link · Reading List</title>
</svelte:head>

<div class="mx-auto max-w-xl px-5.5 pt-6 lg:pt-12">
	<h1 class="headline text-[2.1rem] leading-[1.05] lg:text-5xl">Save a link</h1>
	<p class="mt-2 text-[1.0625rem] text-ink-2">
		It shows up in your inbox under Shared, with its title, summary and image.
	</p>

	<form
		method="POST"
		class="mt-7 flex flex-col gap-6"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update();
				saving = false;
			};
		}}
	>
		<div class="flex flex-col gap-2">
			<label for="url" class={labelClass}>Link</label>
			<input
				id="url"
				name="url"
				type="text"
				inputmode="url"
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
				required
				placeholder="https://…"
				value={form?.url ?? data.prefill.url}
				aria-invalid={form?.error ? 'true' : undefined}
				aria-describedby={form?.error ? 'url-error' : undefined}
				class="{inputClass} h-13 font-ui"
			/>
			{#if form?.error}
				<p id="url-error" class="font-ui text-sm font-bold text-[#9b2c1f]">{form.error}</p>
			{/if}
		</div>

		<div class="flex flex-col gap-2">
			<label for="note" class={labelClass}>Note <span class="text-ink-3">· optional</span></label>
			<textarea
				id="note"
				name="note"
				rows="4"
				placeholder="Why you saved it, who to send it to…"
				class="{inputClass} resize-y py-3 leading-[1.55]"
				>{form?.note ?? data.prefill.note}</textarea
			>
		</div>

		<div class="flex flex-col gap-2">
			<label for="tags" class={labelClass}>Tags <span class="text-ink-3">· optional</span></label>
			<input
				id="tags"
				name="tags"
				type="text"
				autocomplete="off"
				autocapitalize="none"
				placeholder="architecture, reference"
				value={form?.tags ?? data.prefill.tags}
				class="{inputClass} h-12 font-ui"
			/>
			<p class="font-ui text-[0.8125rem] text-ink-3">Separate with commas or spaces.</p>
		</div>

		<button
			type="submit"
			disabled={saving}
			class="h-13 rounded-md bg-ink font-ui text-base font-bold text-paper hover:bg-accent-strong disabled:opacity-70"
		>
			{saving ? 'Saving… fetching the page' : 'Save'}
		</button>
	</form>
</div>
