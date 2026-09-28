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
	import Toast from '$lib/components/Toast.svelte';

	let { children } = $props();

	const tabs = [
		{ href: resolve('/'), label: 'Queue', icon: 'M6 3h12v18l-6-4-6 4z' },
		{ href: resolve('/save'), label: 'Save', icon: 'M12 5v14M5 12h14' },
		{ href: resolve('/archive'), label: 'Archive', icon: 'M3 8h18v12H3zM5 4h14l2 4H3zM10 12h4' },
		{
			href: resolve('/settings'),
			label: 'Settings',
			icon: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4'
		}
	];
	const isActive = (href: string) =>
		href === resolve('/')
			? page.url.pathname === '/' || page.url.pathname.startsWith('/links')
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
					aria-current={isActive('/') ? 'page' : undefined}
					class="border-b-2 py-1.5 {isActive('/')
						? 'border-accent text-ink'
						: 'border-transparent text-ink-2 hover:text-ink'}">Queue</a
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

	<nav
		aria-label="Sections"
		class="fixed inset-x-0 bottom-0 flex h-16 border-t border-rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
	>
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				aria-current={isActive(tab.href) ? 'page' : undefined}
				class="flex flex-1 flex-col items-center justify-center gap-0.5 font-ui text-xs {isActive(
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
			</a>
		{/each}
	</nav>
</div>
