<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { modules } from '$lib/modules';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="shell">
	<aside>
		<a class="brand" href="/">
			<span class="logo">🛰</span>
			<span>Satellite Data Lab</span>
		</a>
		<nav>
			{#each modules as m, i (m.path)}
				<a href={m.path} class:active={page.url.pathname === m.path}>
					<span class="idx">{String(i + 1).padStart(2, '0')}</span>
					<span>{m.title}</span>
				</a>
			{/each}
		</nav>
		<p class="foot muted">エンジニア向け 衛星データ利用 入門</p>
	</aside>
	<main>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 240px 1fr;
		min-height: 100vh;
	}
	aside {
		border-right: 1px solid var(--border);
		background: var(--bg-2);
		padding: 1.2rem 1rem;
		position: sticky;
		top: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 700;
		color: var(--text);
		margin-bottom: 1.5rem;
		font-size: 1.05rem;
	}
	.logo {
		font-size: 1.4rem;
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	nav a {
		display: flex;
		gap: 0.6rem;
		padding: 0.5rem 0.7rem;
		border-radius: 8px;
		color: var(--muted);
		font-size: 0.92rem;
	}
	nav a:hover {
		background: var(--panel);
		text-decoration: none;
		color: var(--text);
	}
	nav a.active {
		background: var(--panel-2);
		color: var(--text);
	}
	.idx {
		font-family: var(--mono);
		font-size: 0.75rem;
		color: var(--accent);
		padding-top: 0.15rem;
	}
	.foot {
		margin-top: auto;
		font-size: 0.75rem;
	}
	main {
		padding: 2rem 2.5rem 4rem;
		max-width: 1100px;
		width: 100%;
	}
	@media (max-width: 800px) {
		.shell {
			grid-template-columns: 1fr;
		}
		aside {
			position: static;
			height: auto;
			border-right: none;
			border-bottom: 1px solid var(--border);
		}
		nav {
			flex-direction: row;
			flex-wrap: wrap;
		}
		.foot {
			display: none;
		}
		main {
			padding: 1.2rem 1rem 3rem;
		}
	}
</style>
