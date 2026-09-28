<script lang="ts">
	import { enhance } from '$app/forms';
	import { relativeDay } from '$lib/format';
	import { SCOPES, type Scope } from '$lib/tokens';

	let { data, form } = $props();
	let copied = $state(false);

	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const scopeLabels = (scopes: string) =>
		scopes
			.split(/\s+/)
			.map((s) => SCOPES[s as Scope] ?? s)
			.join(', ');
</script>

<svelte:head>
	<title>Settings · Reading List</title>
</svelte:head>

<div class="mx-auto flex max-w-xl flex-col gap-8 px-5.5 pt-6 lg:pt-12">
	<header>
		<h1 class="headline text-[2.1rem] leading-[1.05] lg:text-5xl">Settings</h1>
		<p class="mt-2 font-ui text-[0.9375rem] text-ink-2">Signed in as {data.email}</p>
	</header>

	<section class="flex flex-col gap-4" aria-labelledby="tokens-heading">
		<div class="border-b-2 border-ink pb-3">
			<h2 id="tokens-heading" class="kicker text-ink-2">API tokens</h2>
		</div>
		<p class="text-[1.0625rem] leading-[1.55]">
			Tokens let the iPhone Shortcut save links without signing in. Make one per device, and revoke
			it if the device is lost. Setup steps are in
			<code class="font-ui text-[0.9375rem]">docs/ios-shortcut.md</code>.
		</p>

		{#if form?.created}
			<div role="status" class="flex flex-col gap-3 rounded-md border border-accent bg-surface p-4">
				<p class="kicker text-accent">New token · {form.created.name}</p>
				<p class="font-ui text-[0.9375rem] text-ink">Copy it now. It won’t be shown again.</p>
				<code
					class="block rounded bg-sunk px-3 py-2.5 font-mono text-[0.8125rem] break-all text-ink select-all"
					>{form.created.token}</code
				>
				<button
					type="button"
					onclick={() => copy(form.created!.token)}
					class="h-11 rounded-md bg-ink font-ui text-[0.9375rem] font-bold text-paper hover:bg-accent-strong"
				>
					{copied ? 'Copied' : 'Copy token'}
				</button>
				<p class="font-ui text-[0.8125rem] text-ink-3">
					API address: <span class="break-all text-ink-2">{data.apiUrl}</span>
				</p>
			</div>
		{/if}

		<form method="POST" action="?/create" use:enhance class="flex flex-col gap-2">
			<label for="token-name" class="kicker text-accent">New token</label>
			<div class="flex gap-2">
				<input
					id="token-name"
					name="name"
					type="text"
					autocomplete="off"
					placeholder="iPhone Shortcut"
					aria-invalid={form?.createError ? 'true' : undefined}
					class="h-12 min-w-0 flex-1 rounded-md border border-rule-strong bg-surface px-3.5 font-ui text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
				/>
				<button
					class="h-12 shrink-0 rounded-md border border-ink px-4.5 font-ui text-[0.9375rem] font-bold text-ink hover:bg-ink hover:text-paper"
					>Create</button
				>
			</div>
			{#if form?.createError}
				<p class="font-ui text-sm font-bold text-[#9b2c1f]">{form.createError}</p>
			{/if}
		</form>

		{#if data.tokens.length}
			<ul class="flex flex-col">
				{#each data.tokens as token (token.id)}
					<li class="flex items-center gap-3 border-b border-rule py-3.5">
						<div class="flex min-w-0 flex-1 flex-col gap-0.5">
							<span class="font-ui font-bold text-ink">{token.name}</span>
							<span class="font-ui text-[0.8125rem] text-ink-3">
								<code class="font-mono">{token.tokenPrefix}…</code> · {scopeLabels(token.scopes)} ·
								{token.lastUsedAt
									? `used ${relativeDay(token.lastUsedAt)}`
									: `created ${relativeDay(token.createdAt)}, not used yet`}
							</span>
						</div>
						<form
							method="POST"
							action="?/revoke"
							use:enhance={({ cancel }) => {
								if (!confirm(`Revoke “${token.name}”? Anything using it stops working.`)) cancel();
							}}
						>
							<input type="hidden" name="id" value={token.id} />
							<button
								class="h-11 rounded-md border border-rule-strong px-3.5 font-ui text-sm font-bold text-ink-2 hover:border-ink hover:text-ink"
								>Revoke</button
							>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="font-ui text-[0.9375rem] text-ink-3">No tokens yet.</p>
		{/if}
	</section>
</div>
