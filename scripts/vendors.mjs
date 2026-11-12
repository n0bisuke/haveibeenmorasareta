// 委託先ごとの「影響先まとめ」ページ（一覧 /vendor/ と個別 /vendor/<slug>/）を生成する。
// どの委託先をまとめるかと URL の slug は data/vendor-pages.yml で決める。
// 検索で「〇〇 情報漏洩 影響 企業 一覧」と調べる人に、委託先単位でまとまった静的なページを返すのが目的。
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { ROOT } from './lib.mjs';

const REPO = 'https://github.com/n0bisuke/haveibeenmorasareta';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('ja-JP');
const fmtDate = (s) => String(s).replaceAll('-', '/');
const countText = (b) => (b.leaked === false ? 'お漏らし無し' : b.affected_count == null ? '件数不明' : `${nf.format(b.affected_count)} 件`);

// data/vendor-pages.yml を読み、委託先ごとに影響先（vendor.name が一致する事案）と本体の事案をまとめる
export async function loadVendorPages(breaches) {
  const defs = yaml.load(await readFile(path.join(ROOT, 'data', 'vendor-pages.yml'), 'utf8'), { schema: yaml.CORE_SCHEMA }) ?? [];
  const byDate = (a, b) => b.date_announced.localeCompare(a.date_announced) || a.id.localeCompare(b.id);
  return defs.map((d) => {
    const names = new Set(d.names);
    const clients = breaches.filter((b) => b.vendor && names.has(b.vendor.name)).sort(byDate);
    const own = breaches.filter((b) => names.has(b.organization)).sort(byDate);
    return { ...d, clients, own };
  }).filter((v) => v.clients.length >= 3)
    .sort((a, b) => b.clients.length - a.clients.length || a.slug.localeCompare(b.slug));
}

// 委託先名 → 委託先ページの slug（事案ページから委託先ページへリンクするため）
export const vendorSlugMap = (vendors) => new Map(vendors.flatMap((v) => v.names.map((n) => [n, v.slug])));

function header(root) {
  return `<header class="site-header mini-header">
    <div class="leak" aria-hidden="true"><span class="faucet"></span><span class="drop"></span><span class="drop"></span><span class="pool"></span></div>
    <div class="wrap">
      <a class="mini-title" href="${root}">Have I Been <span class="accent">Morasareta</span> 日本版</a>
      <nav class="site-nav" aria-label="ページ">
        <a href="${root}">一覧</a>
        <a href="${root}news/">ニュース</a>
        <a href="${root}alerts/">注意喚起</a>
        <a href="${root}articles/">読みもの</a>
        <a href="${root}visualization/">ビジュアライズ</a>
        <a href="${root}ranking/">ランキング</a>
      </nav>
    </div>
  </header>`;
}

function footer(root) {
  return `<footer class="site-footer">
    <div class="wrap">
      <p>掲載内容は各社の公式発表・報道に基づきます。追加・修正は <a href="${REPO}">GitHub</a> へのプルリクエストでお願いします（<a href="${REPO}/blob/main/CONTRIBUTING.md">書き方</a>）。</p>
      <p class="muted"><a href="${root}vendor/">委託先ごとの影響先まとめ</a>・<a href="${root}terms/">利用規約</a>（データの利用・スクレイピングのルール）・<a href="${root}releases/">リリースノート</a></p>
    </div>
  </footer>`;
}

function head({ title, desc, url, siteUrl, siteName, ga, root, jsonLd }) {
  return `<!doctype html>
<html lang="ja">
<head>
  ${ga}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | ${esc(siteName)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(siteName)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(siteUrl)}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  ${jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n  ')}
  <script src="${root}theme.js"></script>
  <link rel="stylesheet" href="${root}style.css">
  <link rel="stylesheet" href="${root}vendor.css">
</head>`;
}

// 影響先の漏れた情報を、多い順に上位いくつか
function topDataTypes(list, n = 6) {
  const c = new Map();
  for (const b of list) for (const t of b.data_types ?? []) c.set(t, (c.get(t) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

function vendorTitle(v) {
  return `${v.label}経由の情報漏洩 影響先一覧（${v.clients.length}件）`;
}

function detailPage(v, { siteUrl, siteName, ga }) {
  const root = '../../';
  const url = `${siteUrl}/vendor/${v.slug}/`;
  const title = vendorTitle(v);
  const dates = v.clients.map((b) => b.date_announced).sort();
  const first = dates[0];
  const last = dates.at(-1);
  const types = topDataTypes(v.clients);
  const known = v.clients.filter((b) => b.leaked !== false && b.affected_count != null);
  const sum = known.reduce((n, b) => n + b.affected_count, 0);
  const desc = `${v.label}を経由した情報漏洩で、影響を公表した企業・団体${v.clients.length}件の一覧。${fmtDate(first)}〜${fmtDate(last)}公表。主な漏れた情報：${types.join('・') || '不明'}。`.slice(0, 150);
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description: desc,
      url,
      dateModified: last,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: v.clients.length,
        itemListElement: v.clients.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.organization, url: `${siteUrl}/breach/${b.id}/` })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'トップ', item: `${siteUrl}/` },
        { '@type': 'ListItem', position: 2, name: '委託先ごとの影響先まとめ', item: `${siteUrl}/vendor/` },
        { '@type': 'ListItem', position: 3, name: v.label, item: url },
      ],
    },
  ];
  const row = (b) => `<tr>
          <th scope="row"><a href="${root}breach/${esc(b.id)}/">${esc(b.organization)}</a>${b.services?.length ? `<small>${esc(b.services[0])}</small>` : ''}</th>
          <td><time datetime="${esc(b.date_announced)}">${esc(fmtDate(b.date_announced))}</time></td>
          <td class="num">${esc(countText(b))}</td>
          <td>${esc((b.data_types ?? []).slice(0, 4).join('・') || '—')}</td>
        </tr>`;
  return `${head({ title, desc, url, siteUrl, siteName, ga, root, jsonLd })}
<body class="vendor-page">
  ${header(root)}

  <main class="wrap vd-main">
    <nav class="crumb" aria-label="パンくずリスト"><a href="${root}">トップ</a> › <a href="${root}vendor/">委託先ごとの影響先まとめ</a> › ${esc(v.label)}</nav>
    <h1 class="vd-title">${esc(title)}</h1>
    ${v.note ? `<p class="vd-lead">${esc(v.note)}</p>` : ''}
    <dl class="vd-stats">
      <div><dt>影響を公表した企業・団体</dt><dd>${nf.format(v.clients.length)}</dd></div>
      <div><dt>公表期間</dt><dd>${esc(fmtDate(first))}〜${esc(fmtDate(last))}</dd></div>
      <div><dt>件数が分かる影響先の合計</dt><dd>${nf.format(sum)}<small>件（${known.length}件の合計）</small></dd></div>
    </dl>
    <p class="vd-note muted">※ 件数は各社が公表した値です。同じ人が複数の企業・団体に重複して含まれる場合や、委託先が公表した全体の件数と重なる場合があるため、合計は目安です。</p>
    ${types.length ? `<p class="vd-types">主な漏れた情報：${types.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
    ${v.own.length ? `<section class="vd-sec">
      <h2>${esc(v.label)}自身の公表</h2>
      <ul class="vd-own">${v.own.map((b) => `<li><a href="${root}breach/${esc(b.id)}/">${esc(b.organization)}${b.services?.length ? `（${esc(b.services[0])}）` : ''}</a><span>${esc(countText(b))}・${esc(fmtDate(b.date_announced))}公表</span></li>`).join('')}</ul>
    </section>` : ''}
    <section class="vd-sec">
      <h2>影響を公表した企業・団体（公表日が新しい順）</h2>
      <div class="vd-table-wrap">
        <table class="vd-table">
          <thead><tr><th scope="col">企業・団体</th><th scope="col">公表日</th><th scope="col">件数</th><th scope="col">漏れた情報</th></tr></thead>
          <tbody>
        ${v.clients.map(row).join('\n        ')}
          </tbody>
        </table>
      </div>
    </section>
    <section class="vd-sec vd-faq">
      <h2>自分が対象か確かめるには</h2>
      <p>上の一覧で、利用しているサービスや会員登録している企業・団体を探し、各社の公式発表（事案ページの出典の先頭）を確認してください。対象者には各社からメールや郵送で個別に連絡が届くことが多いです。</p>
      <p>${esc(v.label)}や各社を名乗るメール・SMS のリンクは開かず、公式サイトやアプリから確かめてください。</p>
    </section>
    <p class="disclaimer">※ 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。抜けている影響先があれば <a href="${REPO}/issues/new/choose">Issue</a> で教えてください。</p>
  </main>

  ${footer(root)}
</body>
</html>
`;
}

function listPage(vendors, { siteUrl, siteName, ga }) {
  const root = '../';
  const url = `${siteUrl}/vendor/`;
  const title = '委託先ごとの影響先まとめ';
  const desc = `メール配信・クラウド・物流などの委託先が不正アクセスを受け、複数の企業・自治体に広がった情報漏洩を、委託先ごとに一覧にしています（${vendors.length}社）。`;
  const jsonLd = [{
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description: desc,
    url,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: vendors.length,
      itemListElement: vendors.map((v, i) => ({ '@type': 'ListItem', position: i + 1, name: vendorTitle(v), url: `${url}${v.slug}/` })),
    },
  }];
  return `${head({ title, desc, url, siteUrl, siteName, ga, root, jsonLd })}
<body class="vendor-page">
  ${header(root)}

  <main class="wrap vd-main">
    <nav class="crumb" aria-label="パンくずリスト"><a href="${root}">トップ</a> › 委託先ごとの影響先まとめ</nav>
    <h1 class="vd-title">${esc(title)}</h1>
    <p class="vd-lead">${esc(desc)}</p>
    <ul class="vd-list">
      ${vendors.map((v) => {
        const dates = v.clients.map((b) => b.date_announced).sort();
        return `<li><a href="./${esc(v.slug)}/"><strong>${esc(v.label)}</strong><span>影響先 ${nf.format(v.clients.length)}件・${esc(fmtDate(dates[0]))}〜${esc(fmtDate(dates.at(-1)))}公表</span></a></li>`;
      }).join('\n      ')}
    </ul>
    <p class="disclaimer">※ 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。</p>
  </main>

  ${footer(root)}
</body>
</html>
`;
}

export async function writeVendorPages({ publicDir, siteUrl, siteName, ga, vendors }) {
  const dir = path.join(publicDir, 'vendor');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), listPage(vendors, { siteUrl, siteName, ga }));
  for (const v of vendors) {
    await mkdir(path.join(dir, v.slug), { recursive: true });
    await writeFile(path.join(dir, v.slug, 'index.html'), detailPage(v, { siteUrl, siteName, ga }));
  }
  return vendors.map((v) => v.slug);
}
