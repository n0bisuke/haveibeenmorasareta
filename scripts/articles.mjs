// 読みもの（一覧 /articles/ と個別 /articles/<id>/）を data/articles/*.yml から生成する。
// 漏洩事案（/breach/・/news/）とは別物で、件数・ランキングには含めない。
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadArticles } from './lib.mjs';

const REPO = 'https://github.com/n0bisuke/haveibeenmorasareta';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (s) => String(s).replaceAll('-', '/');

// 本文の簡易 Markdown（## 見出し、- 箇条書き、1. 番号付き、**太字**、[リンク](https://…)）を HTML にする
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\.\.\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u}"${u.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${t}</a>`);
}
function renderBody(md) {
  return md.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    const h = block.match(/^(#{2,3}) (.+)$/);
    if (h && lines.length === 1) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    if (lines.every((l) => /^- /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
    if (lines.every((l) => /^\d+\. /.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

function header(root) {
  return `<header class="site-header mini-header">
    <div class="leak" aria-hidden="true"><span class="faucet"></span><span class="drop"></span><span class="drop"></span><span class="pool"></span></div>
    <div class="wrap">
      <a class="mini-title" href="${root}">Have I Been <span class="accent">Morasareta</span> 日本版</a>
      <nav class="site-nav" aria-label="ページ">
        <a href="${root}">一覧</a>
        <a href="${root}news/">ニュース</a>
        <a href="${root}alerts/">注意喚起</a>
        <a href="${root}articles/" aria-current="page">読みもの</a>
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
      <p class="muted"><a href="${root}terms/">利用規約</a>（データの利用・スクレイピングのルール）・<a href="${root}releases/">リリースノート</a></p>
    </div>
  </footer>`;
}

function head({ title, desc, url, siteUrl, siteName, ga, root, type, jsonLd }) {
  return `<!doctype html>
<html lang="ja">
<head>
  ${ga}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | ${esc(siteName)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="${esc(siteName)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(siteUrl)}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <script src="${root}theme.js"></script>
  <link rel="stylesheet" href="${root}style.css">
  <link rel="stylesheet" href="${root}articles.css">
</head>`;
}

// 一覧の上段：Tips のカード（要点を番号付きで）
function tipCard(a) {
  return `<article class="rd-tip">
        <h3><a href="./${esc(a.id)}/">${esc(a.title)}</a></h3>
        ${a.steps?.length ? `<ol>${a.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : `<p>${esc(a.summary)}</p>`}
        <a class="rd-more" href="./${esc(a.id)}/">くわしく →</a>
      </article>`;
}

// 一覧の下段：解説・まとめ記事の行
function articleRow(a) {
  return `<article class="rd-art">
        <a class="rd-thumb" href="./${esc(a.id)}/" aria-hidden="true" tabindex="-1">${esc(a.kind)}</a>
        <div>
          <time datetime="${esc(a.date)}">${esc(fmtDate(a.date))}</time>
          <h3><a href="./${esc(a.id)}/">${esc(a.title)}</a></h3>
          <p>${esc(a.summary)}</p>
          ${a.tags?.length ? `<div class="rd-tags">${a.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
      </article>`;
}

function listPage(articles, { siteUrl, siteName, ga }) {
  const root = '../';
  const url = `${siteUrl}/articles/`;
  const title = '読みもの';
  const tips = articles.filter((a) => a.kind === 'Tips');
  const others = articles.filter((a) => a.kind !== 'Tips');
  const desc = `情報漏洩の背景や企業の対応、個人でできる対策をまとめた解説・Tips（${articles.length}本）。${articles.slice(0, 3).map((a) => a.title).join('、')}`.slice(0, 150);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    url,
    numberOfItems: articles.length,
    itemListElement: articles.map((a, i) => ({ '@type': 'ListItem', position: i + 1, name: a.title, url: `${url}${a.id}/` })),
  };
  return `${head({ title, desc, url, siteUrl, siteName, ga, root, type: 'website', jsonLd })}
<body class="articles-page">
  ${header(root)}

  <main class="wrap rd-main">
    <h1 class="rd-title">読みもの</h1>
    <p class="rd-lead">漏えい事案の背景や企業の対応、個人でできる対策をまとめています。漏洩事案のデータとは別に、件数・ランキングには含みません。</p>
    ${tips.length ? `<section class="rd-sec">
      <div class="rd-sec-h"><h2>今すぐできる Tips</h2><small>個人の対策を短く</small></div>
      <div class="rd-tip-row">${tips.map(tipCard).join('\n      ')}</div>
    </section>` : ''}
    ${others.length ? `<section class="rd-sec">
      <div class="rd-sec-h"><h2>解説・まとめ記事</h2><small>背景と企業の対応</small></div>
      ${others.map(articleRow).join('\n      ')}
    </section>` : ''}
    ${articles.length ? '' : '<p class="muted">まだ記事はありません。</p>'}
    <p class="disclaimer">※ 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。利用する際は各自で出典を確認してください。</p>
  </main>

  ${footer(root)}
</body>
</html>
`;
}

function detailPage(a, byId, { siteUrl, siteName, ga }) {
  const root = '../../';
  const url = `${siteUrl}/articles/${a.id}/`;
  const desc = a.summary.slice(0, 150);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: desc,
    datePublished: a.date,
    ...(a.updated ? { dateModified: a.updated } : {}),
    url,
    isBasedOn: a.sources.map((s) => s.url),
  };
  const related = (a.related ?? []).map((id) => byId.get(id)).filter(Boolean);
  const shareText = `${a.title}｜漏らされったー`;
  return `${head({ title: a.title, desc, url, siteUrl, siteName, ga, root, type: 'article', jsonLd })}
<body class="articles-page">
  ${header(root)}

  <main class="wrap rd-main">
    <p class="crumb"><a href="${root}articles/">← 読みものの一覧へ</a></p>
    <article class="rd-detail${a.kind === 'Tips' ? ' is-tips' : ''}">
      <div class="rd-meta"><span class="rd-kind">${esc(a.kind)}</span><time datetime="${esc(a.date)}">${esc(fmtDate(a.date))}</time>${a.updated ? `<span>（${esc(fmtDate(a.updated))} 更新）</span>` : ''}</div>
      <h1 class="rd-detail-title">${esc(a.title)}</h1>
      ${a.tags?.length ? `<div class="rd-tags">${a.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
      <p class="rd-summary">${esc(a.summary)}</p>
      ${a.steps?.length ? `<ol class="rd-steps">${a.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      <div class="rd-body">
${renderBody(a.body)}
      </div>
      ${related.length ? `<h2 class="rd-h">関連する事案</h2>
      <ul class="rd-related">${related.map((b) => `<li><a href="${root}breach/${esc(b.id)}/">${esc(b.organization)}</a><span>${b.affected_count == null ? '件数不明' : `${b.affected_count.toLocaleString('ja-JP')} 件`}・${esc(fmtDate(b.date_announced))}</span></li>`).join('')}</ul>` : ''}
      <h2 class="rd-h">出典</h2>
      <ul class="rd-sources">${a.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('')}</ul>
      <div class="rd-share">
        <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&amp;url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">𝕏 でシェア</a>
        <a class="edit" href="${REPO}/edit/main/data/articles/${esc(a.id)}.yml" target="_blank" rel="noopener noreferrer">✎ GitHub で修正</a>
      </div>
    </article>
    <p class="disclaimer">※ 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。利用する際は各自で出典を確認してください。</p>
  </main>

  ${footer(root)}
</body>
</html>
`;
}

export async function writeArticlesPages({ publicDir, siteUrl, siteName, ga, breaches }) {
  const articles = (await loadArticles())
    .filter(({ data }) => data)
    .map(({ id, data }) => ({ id, ...data }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const byId = new Map(breaches.map((b) => [b.id, b]));
  const dir = path.join(publicDir, 'articles');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), listPage(articles, { siteUrl, siteName, ga }));
  for (const a of articles) {
    await mkdir(path.join(dir, a.id), { recursive: true });
    await writeFile(path.join(dir, a.id, 'index.html'), detailPage(a, byId, { siteUrl, siteName, ga }));
  }
  return articles.map((a) => a.id);
}
