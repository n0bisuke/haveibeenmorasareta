// セキュリティ注意喚起ページ（一覧 /alerts/ と個別 /alerts/<id>/）を public/alerts.json から生成する。
// 漏洩事案（/breach/・/news/）とは別物で、件数・ランキングには含めない。
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REPO = 'https://github.com/n0bisuke/haveibeenmorasareta';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SEV = {
  critical: { label: '緊急', text: 'Critical' },
  high: { label: '高', text: 'High' },
  medium: { label: '中', text: 'Medium' },
  low: { label: '低', text: 'Low' },
  info: { label: '情報', text: 'Info' },
};

function header(root, { current } = {}) {
  const nav = (href, label) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="site-header">
    <div class="leak" aria-hidden="true"><span class="faucet"></span><span class="drop"></span><span class="drop"></span><span class="pool"></span></div>
    <div class="wrap">
      <p class="eyebrow">漏らされったー</p>
      <h1><a class="home" href="${root}">Have I Been <span class="accent">Morasareta</span></a> <span class="edition">日本版</span></h1>
      <p class="lead">日本国内で情報漏洩を公表した企業・サービスの一覧</p>
      <nav class="site-nav" aria-label="ページ">
        ${nav(`${root}`, '一覧')}
        ${nav(`${root}news/`, 'ニュース')}
        ${nav(`${root}alerts/`, '注意喚起')}
        ${nav(`${root}visualization/`, 'ビジュアライズ')}
        ${nav(`${root}ranking/`, 'ランキング')}
      </nav>
    </div>
  </header>`;
}

function footer(root) {
  return `<footer class="site-footer">
    <div class="wrap">
      <p>
        掲載内容は各社の公式発表・報道に基づきます。追加・修正は
        <a href="${REPO}">GitHub</a>
        へのプルリクエストでお願いします（<a href="${REPO}/blob/main/CONTRIBUTING.md">書き方</a>）。
      </p>
      <p class="muted"><a href="${root}terms/">利用規約</a>（データの利用・スクレイピングのルール）・<a href="${root}releases/">リリースノート</a></p>
    </div>
  </footer>`;
}

function tagsHtml(a) {
  const soft = (a.affected ?? []).map((t) => `<span class="al-soft">${esc(t)}</span>`).join('');
  const aud = (a.audience ?? []).map((t) => `<span class="al-aud">${esc(t)}</span>`).join('');
  const cve = (a.cve ?? []).map((c) => `<span class="al-cve">${esc(c)}</span>`).join('');
  return soft + aud + cve;
}

function actsHtml(a) {
  const acts = [
    a.action_admin && ['サーバー管理者', a.action_admin],
    a.action_user && ['個人・アプリ利用者', a.action_user],
  ].filter(Boolean);
  return acts.length ? `<div class="al-act">${acts.map(([k, v]) => `<span><b>${esc(k)}：</b>${esc(v)}</span>`).join('')}</div>` : '';
}

// 一覧のカード（見出しは個別ページへリンク）
function card(a) {
  const sev = SEV[a.severity] ?? SEV.info;
  return `<article class="al-row sev-${esc(a.severity)}">
      <div class="al-r1"><span class="al-sev sev-${esc(a.severity)}">${esc(sev.label)}</span><h2><a href="./${esc(a.id)}/">${esc(a.title)}</a></h2><span class="al-date">${esc(a.date)}</span></div>
      <div class="al-tags">${tagsHtml(a)}</div>
      <p class="al-sum">${esc(a.summary)}</p>
      ${a.risk ? `<p class="al-risk"><b>放置すると：</b>${esc(a.risk)}</p>` : ''}
      ${actsHtml(a)}
      <div class="al-foot">${a.fixed ? `<span class="al-fixed">修正版：<b>${esc(a.fixed)}</b></span>` : '<span></span>'}<a href="./${esc(a.id)}/">詳細・出典 →</a></div>
    </article>`;
}

// 個別ページ
function detailPage(a, { siteUrl, siteName, ga }) {
  const root = '../../';
  const sev = SEV[a.severity] ?? SEV.info;
  const url = `${siteUrl}/alerts/${a.id}/`;
  const desc = `${a.date}・${a.category}・深刻度${sev.label}。${a.summary}`.slice(0, 150);
  const shareText = `【注意喚起】${a.title}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: desc,
    datePublished: a.date,
    url,
    isBasedOn: (a.sources ?? []).map((s) => s.url),
  };
  return `<!doctype html>
<html lang="ja">
<head>
  ${ga}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(a.title)} | セキュリティ注意喚起 | ${esc(siteName)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(siteName)}">
  <meta property="og:title" content="${esc(a.title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(siteUrl)}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <script src="${root}theme.js"></script>
  <link rel="stylesheet" href="${root}style.css">
  <link rel="stylesheet" href="${root}alerts.css">
</head>
<body class="alerts-page">
  ${header(root)}

  <main class="wrap alerts-main">
    <p class="crumb"><a href="${root}alerts/">← 注意喚起の一覧へ</a></p>
    <article class="al-detail sev-${esc(a.severity)}">
      <div class="al-r1"><span class="al-sev sev-${esc(a.severity)}">${esc(sev.label)}（${esc(sev.text)}）</span><span class="al-cat">${esc(a.category)}</span><span class="al-date">${esc(a.date)}</span></div>
      <h1 class="al-detail-title">${esc(a.title)}</h1>
      <div class="al-tags">${tagsHtml(a)}</div>
      <p class="al-sum">${esc(a.summary)}</p>
      ${a.risk ? `<p class="al-risk"><b>放置すると：</b>${esc(a.risk)}</p>` : ''}
      ${actsHtml(a)}
      ${a.fixed ? `<p class="al-fixed-line">修正版：<b>${esc(a.fixed)}</b></p>` : ''}
      <h2 class="al-h">出典</h2>
      <ul class="al-sources">${(a.sources ?? []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('')}</ul>
      <div class="al-share">
        <button type="button" class="native-share" data-url="${esc(url)}" data-text="${esc(shareText)}" hidden>共有…</button>
        <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&amp;url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">𝕏 でシェア</a>
        <button type="button" class="copy-link" data-url="${esc(url)}">リンクをコピー</button>
        <a class="edit" href="${REPO}/edit/main/data/alerts/${esc(a.id)}.yml" target="_blank" rel="noopener noreferrer">✎ GitHub で修正</a>
      </div>
    </article>
    <p class="al-note"><b>これは漏洩事案ではありません。</b>情報漏洩の背景になりやすいソフトの脆弱性などの注意喚起です。件数・ランキングには含みません。</p>
    <p class="disclaimer">※ 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。利用する際は各自で出典を確認してください。</p>
  </main>

  ${footer(root)}
  <script>
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

export async function writeAlertsPage({ publicDir, siteUrl, siteName, ga }) {
  let data;
  try {
    data = JSON.parse(await readFile(path.join(publicDir, 'alerts.json'), 'utf8'));
  } catch {
    return [];
  }
  const alerts = data.alerts ?? [];
  const root = '../';
  const url = `${siteUrl}/alerts/`;
  const title = 'セキュリティ注意喚起';
  const desc = alerts.length
    ? `情報漏洩の背景になりやすい、広く使われるソフトの重大な脆弱性などの注意喚起（${alerts.length}件）。${alerts.slice(0, 3).map((a) => a.title).join('、')}`.slice(0, 150)
    : '情報漏洩の背景になりやすい、広く使われるソフトの重大な脆弱性などの注意喚起。';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    url,
    numberOfItems: alerts.length,
    itemListElement: alerts.map((a, i) => ({ '@type': 'ListItem', position: i + 1, name: a.title, url: `${url}${a.id}/` })),
  };

  const html = `<!doctype html>
<html lang="ja">
<head>
  ${ga}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | ${esc(siteName)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <link rel="alternate" type="application/json" href="${esc(siteUrl)}/alerts.json" title="セキュリティ注意喚起（JSON）">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(siteName)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(siteUrl)}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <script src="${root}theme.js"></script>
  <link rel="stylesheet" href="${root}style.css">
  <link rel="stylesheet" href="${root}alerts.css">
</head>
<body class="alerts-page">
  ${header(root, { current: `${root}alerts/` })}

  <main class="wrap alerts-main">
    <h1 class="al-title">セキュリティ注意喚起</h1>
    <p class="al-note"><b>これは漏洩事案の一覧ではありません。</b>情報漏洩の背景になりやすい、広く使われるソフトの重大な脆弱性などを、関連情報として注意喚起するページです。件数・ランキングには含みません。</p>
    ${alerts.length ? `<div class="al-list">${alerts.map(card).join('\n    ')}</div>` : '<p class="muted">現在、掲載中の注意喚起はありません。</p>'}
    <p class="muted al-data">この一覧は <a href="${root}alerts.json">JSON</a> でも取得できます。</p>
    <p class="disclaimer">※ 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。利用する際は各自で出典を確認してください。</p>
  </main>

  ${footer(root)}
</body>
</html>
`;
  const dir = path.join(publicDir, 'alerts');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), html);
  for (const a of alerts) {
    const adir = path.join(dir, a.id);
    await mkdir(adir, { recursive: true });
    await writeFile(path.join(adir, 'index.html'), detailPage(a, { siteUrl, siteName, ga }));
  }
  return alerts.map((a) => a.id);
}
