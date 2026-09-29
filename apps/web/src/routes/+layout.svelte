<script lang="ts">
	import { resolve } from '$app/paths';
	import '@fontsource-variable/fraunces/opsz.css';
	import '@fontsource-variable/fraunces/opsz-italic.css';
	import '@fontsource-variable/literata/opsz.css';
	import '@fontsource-variable/literata/opsz-italic.css';
	import '@fontsource/atkinson-hyperlegible/400.css';
	import '@fontsource/atkinson-hyperlegible/700.css';
	import './layout.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import Palette from '$lib/components/Palette.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { palette } from '$lib/palette.svelte';

	let { children, data } = $props();
	const badge = (n: number) => (n > 99 ? '99+' : String(n));

	const tabs = [
		{
			href: resolve('/'),
			label: 'Inbox',
			icon: 'M4 13l2.5-8h11l2.5 8v6H4zM4 13h5l1 2h4l1-2h5'
		},
		{
			href: resolve('/library'),
			label: 'Library',
			icon: 'M4 4h5v16H4zM10 4h4v16h-4zM15.5 5l3.8-1 2.7 15.6-3.8 1z'
		},
		{ href: resolve('/save'), label: 'Save', icon: 'M12 5v14M5 12h14' },
		{
			href: resolve('/archive'),
			label: 'Archive',
			icon: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4'
		},
		{
			href: resolve('/settings'),
			label: 'Settings',
			icon: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4'
		}
	];
	// Posts and shared links belong to the inbox, and so do the feed settings.
	const isActive = (href: string) =>
		href === resolve('/')
			? ['/', '/links', '/entries', '/feeds'].some(
					(p) => page.url.pathname === p || page.url.pathname.startsWith(`${p}/`)
				)
			: page.url.pathname.startsWith(href);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#f4f8f7" />
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<header class="border-b border-rule">
		<div class="mx-auto flex h-14 max-w-[1280px] items-center gap-9 px-5 lg:h-18 lg:px-16">
			<a href={resolve('/')} class="headline text-[1.45rem] text-ink italic lg:text-[1.75rem]"
				>Reading List</a
			>
			<nav
				aria-label="Sections"
				class="hidden gap-6 font-ui text-sm font-bold tracking-[0.08em] uppercase lg:flex"
			>
				<a
					href={resolve('/')}
					aria-current={isActive(resolve('/')) ? 'page' : undefined}
					class="border-b-2 py-1.5 {isActive(resolve('/'))
						? 'border-accent text-ink'
						: 'border-transparent text-ink-2 hover:text-ink'}"
					>Inbox{#if data.unread}<span class="ml-1.5 text-accent">{badge(data.unread)}</span
						>{/if}</a
				>
				<a
					href={resolve('/library')}
					aria-current={isActive(resolve('/library')) ? 'page' : undefined}
					class="border-b-2 py-1.5 {isActive(resolve('/library'))
						? 'border-accent text-ink'
						: 'border-transparent text-ink-2 hover:text-ink'}">Library</a
				>
				<a
					href={resolve('/archive')}
					aria-current={isActive(resolve('/archive')) ? 'page' : undefined}
					class="border-b-2 py-1.5 {isActive(resolve('/archive'))
						? 'border-accent text-ink'
						: 'border-transparent text-ink-2 hover:text-ink'}">Archive</a
				>
				<a
					href={resolve('/settings')}
					aria-current={isActive(resolve('/settings')) ? 'page' : undefined}
					class="border-b-2 py-1.5 {isActive(resolve('/settings'))
						? 'border-accent text-ink'
						: 'border-transparent text-ink-2 hover:text-ink'}">Settings</a
				>
			</nav>
			<div class="flex-1"></div>
			<button
				type="button"
				onclick={() => (palette.open = true)}
				class="hidden h-10 w-64 items-center gap-2.5 rounded-md border border-rule-strong bg-surface px-3 font-ui text-sm text-ink-3 hover:border-ink lg:flex"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg
				>
				<span class="flex-1 text-left">Find a link…</span>
				<kbd class="rounded border border-rule px-1.5 text-xs">⌘K</kbd>
			</button>
			<a
				href={resolve('/search')}
				aria-label="Search"
				class="-mr-2 flex h-11 w-11 items-center justify-center text-ink lg:hidden"
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg
				>
			</a>
			<a
				href={resolve('/save')}
				class="hidden h-10 items-center rounded-md border border-ink bg-ink px-4.5 font-ui text-sm font-bold text-paper hover:bg-accent-strong lg:flex"
				>Save a link</a
			>
		</div>
	</header>

	<main class="flex-1 pb-20 lg:pb-12">
		{@render children()}
	</main>

	<Toast />
	<Palette />

	<nav
		aria-label="Sections"
		class="fixed inset-x-0 bottom-0 flex h-16 border-t border-rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
	>
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				aria-current={isActive(tab.href) ? 'page' : undefined}
				class="relative flex flex-1 flex-col items-center justify-center gap-0.5 font-ui text-xs {isActive(
					tab.href
				)
					? 'font-bold text-ink'
					: 'text-ink-3'}"
			>
				<svg
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"><path d={tab.icon} /></svg
				>
				{tab.label}
				{#if tab.label === 'Inbox' && data.unread}
					<span
						class="absolute top-1.5 left-1/2 ml-2 min-w-4.5 rounded-full bg-accent px-1 text-center text-[0.6875rem] leading-4.5 font-bold text-paper"
						aria-label="{data.unread} unread">{badge(data.unread)}</span
					>
				{/if}
			</a>
		{/each}
	</nav>
</div>
