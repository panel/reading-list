<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { toast } from '$lib/toast.svelte';
</script>

<!-- Sits above the mobile tab bar. aria-live announces each new message. -->
<div
	aria-live="polite"
	class="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3.5 {toast.raised
		? 'bottom-[calc(8.25rem+env(safe-area-inset-bottom))] lg:bottom-22'
		: 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-8'}"
>
	{#if toast.current}
		{@const current = toast.current}
		<div
			class="pointer-events-auto flex min-h-13 w-full max-w-md items-center gap-3 rounded-md bg-ink py-1.5 pr-1.5 pl-4.5 font-ui text-[0.9375rem] text-paper shadow-[0_8px_24px_rgb(21_32_32/0.25)]"
		>
			<span class="min-w-0 flex-1 truncate">{current.message}</span>
			{#if current.undo}
				{@const undo = current.undo}
				<form
					method="POST"
					action="{resolve('/links/[id]', { id: undo.id })}?/restore"
					use:enhance={() => {
						toast.clear();
						return async ({ update }) => {
							await update({ reset: false });
							toast.show({ message: 'Undone' });
						};
					}}
				>
					<input type="hidden" name="status" value={undo.state.status} />
					<input type="hidden" name="queuedAt" value={undo.state.queuedAt} />
					<input type="hidden" name="readAt" value={undo.state.readAt ?? ''} />
					<button
						class="h-10 rounded px-3.5 font-bold text-[#9fd3d6] hover:bg-paper/10 hover:text-paper"
						>Undo</button
					>
				</form>
			{/if}
			<button
				type="button"
				aria-label="Dismiss"
				onclick={() => toast.clear()}
				class="flex h-10 w-10 items-center justify-center rounded text-paper/70 hover:bg-paper/10 hover:text-paper"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg
				>
			</button>
		</div>
	{/if}
</div>
