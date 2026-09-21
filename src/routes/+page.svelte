<script lang="ts">
	import { modules } from '$lib/modules';
	import { makeT, L } from '$lib/i18n/lang.svelte';
	import { home } from '$lib/i18n/home';

	const t = makeT(home);
</script>

<svelte:head>
	<title>{t('title')}</title>
</svelte:head>

<h1>{t('h1')}</h1>
<p class="muted">{t('lead')}</p>

<div class="note">
	{t('note')}<strong>{t('noteStrong')}</strong>{t('noteRest')}
</div>

<h2>{t('modules')}</h2>
<div class="grid cols-2">
	{#each modules as m, i (m.path)}
		<a class="card" href={m.path}>
			<div class="head">
				<span class="idx">{String(i + 1).padStart(2, '0')}</span>
				<h3>{L(m.title)}</h3>
			</div>
			<p>{L(m.summary)}</p>
			<div>
				{#each m.keywords as k (k)}
					<span class="tag">{k}</span>
				{/each}
			</div>
		</a>
	{/each}
</div>

<h2>{t('overview')}</h2>
<div class="panel">
	<pre class="flow">{t('flow')}</pre>
	<p class="muted">{t('flowNote')}</p>
</div>

<style>
	.card {
		display: block;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.1rem 1.3rem;
		color: var(--text);
		transition:
			border-color 0.15s,
			transform 0.15s;
	}
	.card:hover {
		border-color: var(--accent);
		text-decoration: none;
		transform: translateY(-2px);
	}
	.card .head {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.card .idx {
		font-family: var(--mono);
		color: var(--accent);
		font-size: 0.85rem;
	}
	.card p {
		font-size: 0.9rem;
		color: var(--muted);
	}
	.flow {
		white-space: pre;
		font-size: 0.8rem;
	}
</style>
