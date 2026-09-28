<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Reading List</title>
</svelte:head>

<!-- Deliberately unstyled until the design checkpoint (see PLAN.md). -->
<h1>Reading List</h1>
<p>Signed in as {data.email}</p>
<p>{data.savedLinks} saved {data.savedLinks === 1 ? 'link' : 'links'}</p>
