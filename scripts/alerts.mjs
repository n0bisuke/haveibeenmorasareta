// セキュリティ注意喚起ページ（/alerts/）を public/alerts.json から生成する。
// 漏洩事案（/breach/・/news/）とは別物で、件数・ランキングには含めない。
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SEV = {
  critical: { label: '緊急', text: 'Critical' },
  high: { label: '高', text: 'High' },
  medium: { label: '中', text: 'Medium' },
  low: { label: '低', text: 'Low' },
  info: { label: '情報', text: 'Info' },
};

function card(a) {
  const sev = SEV[a.severity] ?? SEV.info;
  const soft = (a.affected ?? []).map((t) => `<span class="al-soft">${esc(t)}</span>`).join('');
  const aud = (a.audience ?? []).map((t) => `<span class="al-aud">${esc(t)}</span>`).join('');
  const cve = (a.cve ?? []).map((c) => `<span class="al-cve">${esc(c)}</span>`).join('');
  const acts = [
    a.action_admin && ['サーバー管理者', a.action_admin],
    a.action_user && ['個人・アプリ利用者', a.action_user],
  ].filter(Boolean);
  return `<article class="al-row sev-${esc(a.severity)}">
      <div class="al-r1"><span class="al-sev sev-${esc(a.severity)}">${esc(sev.label)}</span><h2>${esc(a.title)}</h2><span class="al-date">${esc(a.date)}</span></div>
      <div class="al-tags">${soft}${aud}${cve}</div>
      <p class="al-sum">${esc(a.summary)}</p>
      ${a.risk ? `<p class="al-risk"><b>放置すると：</b>${esc(a.risk)}</p>` : ''}
      ${acts.length ? `<div class="al-act">${acts.map(([k, v]) => `<span><b>${esc(k)}：</b>${esc(v)}</span>`).join('')}</div>` : ''}
      <div class="al-foot">${a.fixed ? `<span class="al-fixed">修正版：<b>${esc(a.fixed)}</b></span>` : '<span></span>'}${a.sources?.length ? `<a href="${esc(a.sources[0].url)}" target="_blank" rel="noopener noreferrer">公式情報を見る →</a>` : ''}</div>
      ${a.sources?.length > 1 ? `<ul class="al-sources">${a.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('')}</ul>` : ''}
    </article>`;
}

export async function writeAlertsPage({ publicDir, siteUrl, siteName, ga }) {
  let data;
  try {
    data = JSON.parse(await readFile(path.join(publicDir, 'alerts.json'), 'utf8'));
  } catch {
    return 0;
  }
  const alerts = data.alerts ?? [];
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
    itemListElement: alerts.map((a, i) => ({ '@type': 'ListItem', position: i + 1, name: a.title })),
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
  <script src="../theme.js"></script>
  <link rel="stylesheet" href="../style.css">
  <link rel="stylesheet" href="../alerts.css">
</head>
<body class="alerts-page">
  <header class="site-header">
    <div class="leak" aria-hidden="true"><span class="faucet"></span><span class="drop"></span><span class="drop"></span><span class="pool"></span></div>
    <div class="wrap">
      <p class="eyebrow">漏らされったー</p>
      <h1><a class="home" href="../">Have I Been <span class="accent">Morasareta</span></a> <span class="edition">日本版</span></h1>
      <p class="lead">日本国内で情報漏洩を公表した企業・サービスの一覧</p>
      <nav class="site-nav" aria-label="ページ">
        <a href="../">一覧</a>
        <a href="../news/">ニュース</a>
        <a href="../alerts/" aria-current="page">注意喚起</a>
        <a href="../visualization/">ビジュアライズ</a>
        <a href="../ranking/">ランキング</a>
      </nav>
    </div>
  </header>

  <main class="wrap alerts-main">
    <h1 class="al-title">セキュリティ注意喚起</h1>
    <p class="al-note"><b>これは漏洩事案の一覧ではありません。</b>情報漏洩の背景になりやすい、広く使われるソフトの重大な脆弱性などを、関連情報として注意喚起するページです。件数・ランキングには含みません。</p>
    ${alerts.length ? `<div class="al-list">${alerts.map(card).join('\n    ')}</div>` : '<p class="muted">現在、掲載中の注意喚起はありません。</p>'}
    <p class="muted al-data">この一覧は <a href="../alerts.json">JSON</a> でも取得できます。</p>
    <p class="disclaimer">※ 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。利用する際は各自で出典を確認してください。</p>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p>
        掲載内容は各社の公式発表・報道に基づきます。追加・修正は
        <a href="https://github.com/n0bisuke/haveibeenmorasareta">GitHub</a>
        へのプルリクエストでお願いします（<a href="https://github.com/n0bisuke/haveibeenmorasareta/blob/main/CONTRIBUTING.md">書き方</a>）。
      </p>
      <p class="muted"><a href="../terms/">利用規約</a>（データの利用・スクレイピングのルール）・<a href="../releases/">リリースノート</a></p>
    </div>
  </footer>
</body>
</html>
`;
  await mkdir(path.join(publicDir, 'alerts'), { recursive: true });
  await writeFile(path.join(publicDir, 'alerts', 'index.html'), html);
  return alerts.length;
}
