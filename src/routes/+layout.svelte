<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { languageUrl, localeParam, type Lang } from '$lib/i18n/locale';
	import { modules } from '$lib/modules';
	import { i18n, setLang, L, LANGS } from '$lib/i18n/lang.svelte';

	let { children } = $props();
	$effect(() => { if (browser) document.documentElement.lang = i18n.lang; });
	$effect(() => {
		const explicit = localeParam(page.url.searchParams.get('lang'));
		// Shared demo links intentionally persist the requested language for later visits.
		if (browser && explicit) untrack(() => setLang(explicit));
	});
	function chooseLanguage(lang: Lang) {
		setLang(lang);
		replaceState(languageUrl(location.href, lang), page.state);
	}
</script>

<div class="shell">
	<aside>
		<a class="brand" href={languageUrl('/', i18n.lang)}>
			<span class="logo">🛰</span>
			<span>Satellite Data Lab</span>
		</a>
		<div class="lang" role="group" aria-label="言語 / Language">
			{#each LANGS as l (l)}
				<button class:active={i18n.lang === l} onclick={() => chooseLanguage(l)} aria-pressed={i18n.lang === l} lang={l}>{l === 'ja' ? '日本語' : 'English'}</button>
			{/each}
		</div>
		<nav>
			{#each modules as m, i (m.path)}
				<a href={languageUrl(m.path, i18n.lang)} class:active={page.url.pathname === m.path}>
					<span class="idx">{String(i + 1).padStart(2, '0')}</span>
					<span>{L(m.title)}</span>
				</a>
			{/each}
		</nav>
		<p class="foot muted">{i18n.lang === 'ja' ? 'エンジニア向け 衛星データ利用 入門' : 'Satellite data for engineers'}</p>
	</aside>
	<main>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr);
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
		margin-bottom: 0.7rem;
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
	.lang {
		margin: 0 0 1rem;
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		align-self: flex-start;
	}
	.lang button {
		background: transparent;
		color: var(--muted);
		border: none;
		border-radius: 0;
		padding: 0.55rem 0.8rem;
		min-height: 44px;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.lang button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -3px;
	}
	.lang button + button {
		border-left: 1px solid var(--border);
	}
	.lang button.active {
		background: var(--panel-2);
		color: var(--text);
	}
	.foot {
		margin-top: 0.6rem;
		font-size: 0.75rem;
	}
	main {
		min-width: 0;
		padding: 2rem 2.5rem 4rem;
		max-width: 1100px;
		width: 100%;
	}
	@media (max-width: 800px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
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
		.lang {
			margin: 0 0 0.7rem;
		}
		main {
			padding: 1.2rem 1rem 3rem;
		}
	}
</style>
