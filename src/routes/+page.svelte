<script lang="ts">
	import { modules } from '$lib/modules';
</script>

<svelte:head>
	<title>Satellite Data Lab — 衛星データ利用 入門</title>
</svelte:head>

<h1>衛星データ利用を、手を動かして理解する</h1>
<p class="muted">
	衛星データを実務で扱うエンジニア向けのインタラクティブ教材です。数式やパラメータを直接いじりながら、
	「なぜそうなっているのか」を軌道・センサー・データ形式・取得 API の順に追っていきます。
</p>

<div class="note">
	全モジュールはブラウザ内で完結します。<strong>STAC モジュール</strong>のみ、AWS 上の公開 STAC API（Earth Search）に
	実リクエストを送ります（認証不要）。
</div>

<h2>モジュール</h2>
<div class="grid cols-2">
	{#each modules as m, i (m.path)}
		<a class="card" href={m.path}>
			<div class="head">
				<span class="idx">{String(i + 1).padStart(2, '0')}</span>
				<h3>{m.title}</h3>
			</div>
			<p>{m.summary}</p>
			<div>
				{#each m.keywords as k (k)}
					<span class="tag">{k}</span>
				{/each}
			</div>
		</a>
	{/each}
</div>

<h2>衛星データ利用の全体像</h2>
<div class="panel">
	<pre class="flow">{`  [軌道・センサー]        [処理・配布]                [利用者]
   衛星が観測 ──▶ L0 → L1 → L2 (ARD) ──▶ COG / Zarr ──▶ STAC で検索 ──▶ 解析・可視化
   ↑ 01 軌道          ↑ 05 処理レベル      ↑ 05 形式       ↑ 04 STAC       ↑ 02 指標 / 03 分解能 / 06 実画像
   ↑ 02 バンド`}</pre>
	<p class="muted">
		左から右へがデータの流れ。実務では右端（STAC で探して COG を読む）から入ることが多いですが、
		左側を知らないと「なぜこの日付にシーンがないのか」「なぜこの指標が効くのか」が説明できません。
	</p>
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
