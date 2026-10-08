// 事案ごとの個別ページ（public/breach/<id>/index.html）と sitemap.xml を生成する
// デプロイ時に実行し、公開物にだけ含める（リポジトリにはコミットしない）
//   SITE_URL … 公開 URL（canonical・OGP・sitemap に使う。既定 https://morasaretter.suke.dev）
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib.mjs';
import { CAUSES } from '../public/labels.js';

const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(PUBLIC, 'breach');
const SITE_URL = (process.env.SITE_URL ?? 'https://morasaretter.suke.dev').replace(/\/+$/, '');
const REPO = 'https://github.com/n0bisuke/haveibeenmorasareta';
const SITE_NAME = 'Have I Been Morasareta 日本版（漏らされったー）';

const data = JSON.parse(await readFile(path.join(PUBLIC, 'breaches.json'), 'utf8'));
const { breaches, severity_levels: LEVELS, data_types: TYPES } = data;
const VULN = Object.fromEntries((data.vuln_targets ?? []).map((t) => [t.id, t.label]));
const ATTACK = Object.fromEntries((data.attack_methods ?? []).map((t) => [t.id, t.label]));
const ORG_TYPE = Object.fromEntries((data.org_types ?? []).map((t) => [t.id, t.label]));
const RANK = Object.fromEntries(LEVELS.map((l, i) => [l.id, i]));
const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
const RELIABILITY = {
  high: { label: '高', dots: 3, text: '公式発表で確認' },
  mid: { label: '中', dots: 2, text: '報道で確認（公式発表は出典に未掲載）' },
  low: { label: '低', dots: 1, text: '一次情報が未確認（まとめサイトなど）' },
};
// 画像（OGP）があれば使う。scripts/og-images.mjs が生成する
const ogImage = (id) => `${SITE_URL}/breach/${id}/og.png`;
const hasOg = process.argv.includes('--og');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('ja-JP');
const fmtDate = (s) => s.replaceAll('-', '/');
const industries = (b) => [b.industry ?? []].flat();
const countText = (b) => (b.affected_count == null ? '件数不明' : `${nf.format(b.affected_count)} 件`);
const title = (b) => `${b.organization}${b.services?.length ? `（${b.services[0]}）` : ''}の情報漏洩`;
const description = (b) => `${b.date_announced.replaceAll('-', '/')}公表・${countText(b)}。${b.summary}`.slice(0, 150);

const GA = `<!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-R4B2YZ2JN1"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', 'G-R4B2YZ2JN1');
  </script>`;

function related(b) {
  // 同じグループ・委託先・業種の事案を、新しい順に最大3件
  const ind = industries(b)[0];
  const score = (o) => (b.group && o.group === b.group ? 3 : 0) + (b.vendor && o.vendor?.name === b.vendor.name ? 3 : 0) + (ind && industries(o).includes(ind) ? 1 : 0);
  return breaches
    .filter((o) => o.id !== b.id && score(o) > 0)
    .sort((x, y) => score(y) - score(x) || y.date_announced.localeCompare(x.date_announced))
    .slice(0, 3);
}

function page(b) {
  const url = `${SITE_URL}/breach/${b.id}/`;
  const sev = b.severity ? RANK[b.severity] : null;
  // 重要度が高いほど多くのマスを塗る（危険=4マス、低=1マス）
  const bars = LEVELS.map((_, i) => `<i class="${sev != null && i < LEVELS.length - sev ? 'on' : ''}"></i>`).join('');
  const tags = (b.data_types ?? []).map((t, i) => ({ t, i, level: TYPES[t] }))
    .sort((x, y) => (RANK[x.level] ?? 99) - (RANK[y.level] ?? 99) || x.i - y.i)
    .map(({ t, level }) => `<li class="${level ? `t-${level}` : ''}"${level ? ` title="重要度：${esc(LEVEL[level].label)}"` : ''}>${esc(t)}</li>`).join('');
  const cause = VULN[b.vuln_target] ? `${CAUSES[b.cause]}（${VULN[b.vuln_target]}）` : CAUSES[b.cause];
  const facts = [
    b.disclosure_days != null && ['発生から公表まで', `${nf.format(b.disclosure_days)}日`],
    ['原因', cause],
    b.attack_methods && ['手法', b.attack_methods.map((m) => ATTACK[m] ?? m).join('・')],
    b.vendor && ['委託先', b.vendor.name],
    industries(b).length && ['業種', industries(b).join('・')],
    b.org_type && ['組織の種類', `${ORG_TYPE[b.org_type] ?? b.org_type}${b.prefecture ? `（${b.prefecture}）` : ''}`],
    b.group && ['グループ', b.group],
  ].filter(Boolean);
  const timeline = [
    b.date_occurred && [b.date_occurred, '発生'],
    [b.date_announced, '公表'],
  ].filter(Boolean);
  const rel = related(b);
  const shareText = `${title(b)}（${countText(b)}）`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title(b),
    description: description(b),
    datePublished: b.date_announced,
    url,
    isBasedOn: b.sources.map((s) => s.url),
  };

  return `<!doctype html>
<html lang="ja">
<head>
  ${GA}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title(b))} | ${esc(SITE_NAME)}</title>
  <meta name="description" content="${esc(description(b))}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(SITE_NAME)}">
  <meta property="og:title" content="${esc(title(b))}">
  <meta property="og:description" content="${esc(description(b))}">
  <meta property="og:url" content="${esc(url)}">
  ${hasOg ? `<meta property="og:image" content="${esc(ogImage(b.id))}">
  <meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <script src="../../theme.js"></script>
  <link rel="stylesheet" href="../../style.css">
</head>
<body class="detail-page">
  <header class="site-header mini-header">
    <div class="leak" aria-hidden="true"><span class="faucet"></span><span class="drop"></span><span class="drop"></span><span class="pool"></span></div>
    <div class="wrap">
      <a class="mini-title" href="../../">Have I Been <span class="accent">Morasareta</span> 日本版</a>
      <nav class="site-nav" aria-label="ページ">
        <a href="../../">一覧</a>
        <a href="../../visualization/">ビジュアライズ</a>
        <a href="../../ranking/">ランキング</a>
      </nav>
    </div>
  </header>

  <main class="wrap">
    <p class="crumb"><a href="../../#${esc(b.id)}">← 一覧に戻る</a></p>
    <div class="detail-layout">
      <article class="detail-panel${b.status === 'investigating' ? ' is-investigating' : ''}">
        <div class="detail-title">
          <h1>${esc(b.organization)}</h1>
          ${b.status === 'investigating' ? '<span class="status-badge">企業側が調査中</span>' : ''}
        </div>
        ${b.services?.length ? `<p class="services">${esc(b.services.join(' / '))}</p>` : ''}
        ${b.severity ? `<div class="sev-meter sev-${b.severity}" aria-hidden="true">${bars}</div>
        <p class="sev-label">漏洩した情報の重要度：${esc(LEVEL[b.severity].label)}（${esc(LEVEL[b.severity].description)}）</p>` : ''}
        <p class="detail-summary">${esc(b.summary)}</p>
        ${tags ? `<ul class="tags">${tags}</ul>` : ''}
        ${b.root_cause ? `<p class="root-cause"><span class="root-cause-label">原因の詳細</span><span>${esc(b.root_cause)}</span></p>` : ''}
        ${b.status === 'investigating' ? `<p class="investigating">企業が件数・漏えいの有無などを調査中と公表しています。続報の情報を${b.issue ? ` <a href="${esc(b.issue)}" target="_blank" rel="noopener noreferrer">Issue #${esc(b.issue.split('/').pop())}</a> ` : ' Issue '}で募集しています。</p>` : ''}
        ${b.reliability === 'low' ? `<p class="low-reliability">※ 公式発表や信頼できる報道（一次情報）をまだ確認できていない情報です。一次情報をご存じの方は${b.issue ? ` <a href="${esc(b.issue)}" target="_blank" rel="noopener noreferrer">Issue #${esc(b.issue.split('/').pop())}</a> ` : ' Issue '}で教えてください。</p>` : ''}
        <ol class="timeline">${timeline.map(([d, t]) => `<li><time datetime="${esc(d)}">${esc(fmtDate(d))}</time>${esc(t)}</li>`).join('')}</ol>
        <h2 class="detail-h">出典</h2>
        <ul class="sources">${b.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('')}</ul>
      </article>
      <aside class="detail-panel detail-side">
        <dl>
          <div><dt>漏洩件数</dt><dd class="kpi">${b.affected_count == null ? '不明' : esc(nf.format(b.affected_count))}</dd>${b.count_note ? `<dd class="kpi-note">${esc(b.count_note)}</dd>` : ''}</div>
          ${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n          ')}
          ${RELIABILITY[b.reliability] ? `<div><dt>情報の信頼度</dt><dd><span class="reliability r-${b.reliability}" title="情報の信頼度：${RELIABILITY[b.reliability].label}">${[1, 2, 3].map((i) => `<i class="${i <= RELIABILITY[b.reliability].dots ? 'on' : ''}"></i>`).join('')}${esc(RELIABILITY[b.reliability].label)}</span><br><small class="muted">${esc(RELIABILITY[b.reliability].text)}</small></dd></div>` : ''}
        </dl>
      </aside>
    </div>

    <div class="share">
      <button type="button" class="native-share" data-url="${esc(url)}" data-text="${esc(shareText)}" hidden>共有…</button>
      <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&amp;url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">𝕏 でシェア</a>
      <a href="https://b.hatena.ne.jp/entry/s/${esc(url.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener noreferrer">はてブ</a>
      <button type="button" class="copy-link" data-url="${esc(url)}">リンクをコピー</button>
      <a class="edit" href="${REPO}/edit/main/data/breaches/${esc(b.file)}" target="_blank" rel="noopener noreferrer">✎ この事案を GitHub で修正</a>
    </div>

    ${rel.length ? `<section class="related">
      <h2>関連する事案</h2>
      <ul>${rel.map((o) => `<li><a href="../${esc(o.id)}/">${esc(o.organization)}</a><span>${esc(countText(o))}・${esc(fmtDate(o.date_announced))}</span></li>`).join('')}</ul>
    </section>` : ''}
    <p class="disclaimer detail-disclaimer">※ 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。利用する際は各自で出典を確認してください。</p>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p>
        掲載内容は各社の公式発表・報道に基づきます。追加・修正は
        <a href="${REPO}">GitHub</a>
        へのプルリクエストでお願いします（<a href="${REPO}/blob/main/CONTRIBUTING.md">書き方</a>）。
      </p>
    </div>
  </footer>
  <script>
    // スマホでは OS の共有シート（X・LINE などのアプリ）を使えるようにする
    const share = document.querySelector('.native-share');
    if (share && navigator.share) {
      share.hidden = false;
      share.addEventListener('click', () => navigator.share({ title: share.dataset.text, text: share.dataset.text, url: share.dataset.url }).catch(() => {}));
    }
    document.querySelector('.copy-link')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try { await navigator.clipboard.writeText(btn.dataset.url); btn.textContent = 'コピーしました'; }
      catch { prompt('このリンクをコピーしてください', btn.dataset.url); }
    });
  </script>
</body>
</html>
`;
}

// 事案データのファイル名（拡張子付き）を補う
const files = new Map((await import('./lib.mjs').then((m) => m.loadBreaches())).map((e) => [e.id, e.file]));
await rm(OUT, { recursive: true, force: true });
for (const b of breaches) {
  b.file = files.get(b.id) ?? `${b.id}.yml`;
  const dir = path.join(OUT, b.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), page(b));
}

const urls = ['/', '/ranking/', '/visualization/', ...breaches.map((b) => `/breach/${b.id}/`)];
await writeFile(
  path.join(PUBLIC, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(SITE_URL + u)}</loc></url>`).join('\n')}\n</urlset>\n`,
);
console.log(`✔ 個別ページ ${breaches.length} 件と sitemap.xml を出力しました`);
