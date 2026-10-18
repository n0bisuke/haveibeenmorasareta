// 公表日ごとのニュースページ（/news/・/news/YYYY-MM-DD/）と、同じ内容の JSON（/news/index.json・/news/YYYY-MM-DD.json）を生成する
// ページは JavaScript なしで内容がすべて読めるように、ビルド時に HTML へ書き出す（スクレイピングで取得できるようにするため）。
// scripts/pages.mjs から呼ぶ（公開物にだけ含め、コミットはしない）
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CAUSES } from '../public/labels.js';

const TOPIC_DAYS = 30; // 「話題の連鎖」で数える期間（選んだ日までの日数）
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('ja-JP');
const WEEK = '日月火水木金土';
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const jpDate = (d) => `${+d.slice(5, 7)}月${+d.slice(8, 10)}日（${WEEK[dow(d)]}）`;
const jpFull = (d) => `${d.slice(0, 4)}年${jpDate(d)}`;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const countText = (b) => (b.leaked === false ? 'お漏らし無し' : b.affected_count == null ? '件数不明' : `${nf.format(b.affected_count)} 件`);
const total = (list) => list.reduce((s, b) => s + (b.leaked === false ? 0 : b.affected_count ?? 0), 0);
// 件数の多い順（お漏らし無し・件数不明は後ろ）、同数なら組織名順
const byCount = (a, b) => (b.leaked === false ? -1 : b.affected_count ?? -1) - (a.leaked === false ? -1 : a.affected_count ?? -1) || a.organization.localeCompare(b.organization, 'ja');

// 取得する側が使いやすいように、事案ごとの要点だけを JSON にする
const item = (b, siteUrl) => ({
  id: b.id,
  url: `${siteUrl}/breach/${b.id}/`,
  organization: b.organization,
  services: b.services ?? [],
  date_announced: b.date_announced,
  affected_count: b.affected_count ?? null,
  leaked: b.leaked !== false,
  cause: b.cause,
  vendor: b.vendor?.name ?? null,
  severity: b.severity ?? null,
  summary: b.summary,
  sources: b.sources.map((s) => s.url),
});

function topics(breaches, date) {
  const from = addDays(date, -(TOPIC_DAYS - 1));
  const map = new Map();
  for (const b of breaches) {
    if (!b.vendor || b.date_announced < from || b.date_announced > date) continue;
    if (!map.has(b.vendor.name)) map.set(b.vendor.name, []);
    map.get(b.vendor.name).push(b);
  }
  return [...map].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
}

function calendar(month, counts, selected, days) {
  const [y, m] = month.split('-').map(Number);
  const first = dow(`${month}-01`);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prevMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  // 前後の月は、その月で最後に公表があった日へリンクする
  const lastIn = (mm) => days.filter((d) => d.startsWith(mm)).at(-1);
  const prev = lastIn(prevMonth);
  const next = lastIn(nextMonth);
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<span class="news-cal-blank"></span>');
  for (let i = 1; i <= last; i++) {
    const d = `${month}-${String(i).padStart(2, '0')}`;
    const n = counts.get(d) ?? 0;
    const lv = n >= 20 ? 3 : n >= 8 ? 2 : n > 0 ? 1 : 0;
    const label = `${jpDate(d)} ${n}件`;
    cells.push(n
      ? `<a class="news-cal-day lv${lv}${d === selected ? ' is-selected' : ''}" href="../${d}/" title="${esc(label)}" aria-label="${esc(label)}"${d === selected ? ' aria-current="date"' : ''}><span>${i}</span><b>${n}</b></a>`
      : `<span class="news-cal-day"><span>${i}</span></span>`);
  }
  return `<div class="news-cal">
        <div class="news-cal-head">
          ${prev ? `<a href="../${prev}/" aria-label="前の月">‹</a>` : '<span></span>'}
          <h2>${y}年${m}月の公表</h2>
          ${next ? `<a href="../${next}/" aria-label="次の月">›</a>` : '<span></span>'}
        </div>
        <div class="news-cal-grid">${[...WEEK].map((w) => `<span class="news-cal-wk">${w}</span>`).join('')}${cells.join('')}</div>
        <p class="news-cal-legend muted">色が濃いほど公表された事案が多い日です。数字は事案数。</p>
      </div>`;
}

function page({ date, list, breaches, counts, days, siteUrl, siteName, ga, index = false }) {
  const isIndex = index;
  const url = isIndex ? `${siteUrl}/news/` : `${siteUrl}/news/${date}/`;
  const base = isIndex ? './' : '../'; // /news/ からの相対パス
  const root = isIndex ? '../' : '../../';
  const i = days.indexOf(date);
  const prevDay = days[i - 1];
  const nextDay = days[i + 1];
  const sum = total(list);
  const vendorCount = list.filter((b) => b.vendor || b.cause === 'third_party').length;
  const title = `${jpFull(date)}の情報漏洩ニュース`;
  const description = `${jpFull(date)}に公表された情報漏洩は${list.length}件${sum ? `（漏洩件数の合計 ${nf.format(sum)} 件）` : ''}。${list.slice(0, 3).map((b) => b.organization).join('、')}${list.length > 3 ? 'など' : ''}。`;
  const tp = topics(breaches, date);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    url,
    datePublished: date,
    numberOfItems: list.length,
    itemListElement: list.map((b, n) => ({ '@type': 'ListItem', position: n + 1, url: `${siteUrl}/breach/${b.id}/`, name: b.organization })),
  };
  // カレンダーのリンクは /news/<日付>/ からの相対パスなので、/news/ 自体では1階層浅くする
  const cal = calendar(date.slice(0, 7), counts, date, days).replaceAll('href="../', `href="${base}`);
  const recent = days.slice(-10).reverse();

  return `<!doctype html>
<html lang="ja">
<head>
  ${ga}
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(isIndex ? `ニュース（最新：${title}）` : title)} | ${esc(siteName)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <link rel="alternate" type="application/json" href="${esc(`${siteUrl}/news/${date}.json`)}" title="${esc(title)}（JSON）">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(siteName)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(siteUrl)}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <script src="${root}theme.js"></script>
  <link rel="stylesheet" href="${root}style.css">
  <link rel="stylesheet" href="${root}news.css">
</head>
<body class="news-page">
  <header class="site-header">
    <div class="leak" aria-hidden="true"><span class="faucet"></span><span class="drop"></span><span class="drop"></span><span class="pool"></span></div>
    <div class="wrap">
      <p class="eyebrow">漏らされったー</p>
      <h1><a class="home" href="${root}">Have I Been <span class="accent">Morasareta</span></a> <span class="edition">日本版</span></h1>
      <p class="lead">日本国内で情報漏洩を公表した企業・サービスの一覧</p>
      <p class="disclaimer">※ 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。利用する際は各自で出典を確認してください。</p>
      <nav class="site-nav" aria-label="ページ">
        <a href="${root}">一覧</a>
        <a href="${root}news/" aria-current="page">ニュース</a>
        <a href="${root}visualization/">ビジュアライズ</a>
        <a href="${root}ranking/">ランキング</a>
      </nav>
    </div>
  </header>

  <main class="wrap news-layout">
    <aside class="news-side">
      ${cal}
      ${tp.length ? `<section class="news-topics" aria-labelledby="topics-title">
        <h2 id="topics-title">いま話題の連鎖 <small>直近${TOPIC_DAYS}日・委託先別</small></h2>
        ${tp.map(([v, l]) => `<div class="news-topic" data-vendor="${esc(v)}" data-count="${l.length}">
          <p><b>${esc(v)}</b><span class="news-topic-n">${l.length}件</span></p>
          <p class="muted">${l.sort(byCount).slice(0, 4).map((b) => `<a href="${root}breach/${esc(b.id)}/">${esc(b.organization)}</a>`).join('、')}${l.length > 4 ? ' ほか' : ''}</p>
        </div>`).join('\n        ')}
        <p class="news-more"><a href="${root}visualization/lineage/">漏洩の系譜（家系図）で見る →</a></p>
      </section>` : ''}
      <section class="news-recent" aria-labelledby="recent-title">
        <h2 id="recent-title">最近の公表日</h2>
        <ul>${recent.map((d) => `<li><a href="${base}${d}/"${d === date ? ' aria-current="date"' : ''}><time datetime="${d}">${esc(jpDate(d))}</time><span>${counts.get(d)}件</span></a></li>`).join('')}</ul>
      </section>
    </aside>

    <section class="news-day" aria-labelledby="day-title" data-date="${date}">
      <p class="news-eyebrow">${isIndex ? '最新の公表日' : '公表日'}</p>
      <h2 id="day-title" class="news-day-title"><time datetime="${date}">${esc(jpFull(date))}</time>に公表された情報漏洩</h2>
      <dl class="news-stats">
        <div><dt>公表された事案</dt><dd data-value="${list.length}">${nf.format(list.length)}件</dd></div>
        <div><dt>漏洩件数の合計</dt><dd data-value="${sum}">${nf.format(sum)}件</dd></div>
        <div><dt>委託先経由</dt><dd data-value="${vendorCount}">${nf.format(vendorCount)}件</dd></div>
      </dl>
      <ol class="news-list">
        ${list.map((b) => `<li>
          <article class="news-item sev-${esc(b.leaked === false ? 'safe' : b.severity ?? 'none')}" id="${esc(b.id)}" data-id="${esc(b.id)}" data-affected="${b.affected_count ?? ''}" data-leaked="${b.leaked !== false}">
            <div class="news-item-head">
              <h3><a href="${root}breach/${esc(b.id)}/">${esc(b.organization)}</a></h3>
              <span class="news-count">${esc(countText(b))}</span>
            </div>
            ${b.services?.length ? `<p class="news-services">${esc(b.services.join(' / '))}</p>` : ''}
            <p class="news-meta">${b.vendor ? `<span class="news-chip">委託先：${esc(b.vendor.name)}</span>` : `<span class="news-chip">${esc(CAUSES[b.cause] ?? b.cause)}</span>`}${b.status === 'investigating' ? '<span class="news-chip">企業側が調査中</span>' : ''}<time datetime="${b.date_announced}" hidden>${b.date_announced}</time></p>
            <p class="news-summary">${esc(b.summary)}</p>
          </article>
        </li>`).join('\n        ')}
      </ol>
      <nav class="news-pager" aria-label="前後の公表日">
        ${prevDay ? `<a rel="prev" href="${base}${prevDay}/">← ${esc(jpDate(prevDay))}</a>` : '<span></span>'}
        ${nextDay ? `<a rel="next" href="${base}${nextDay}/">${esc(jpDate(nextDay))} →</a>` : '<span></span>'}
      </nav>
      <p class="muted news-data">この日の内容は <a href="${base}${date}.json">JSON</a> でも取得できます（公表日の一覧は <a href="${base}index.json">index.json</a>）。</p>
    </section>
  </main>

  <footer class="site-footer">
    <div class="wrap">
      <p>
        掲載内容は各社の公式発表・報道に基づきます。追加・修正は
        <a href="https://github.com/n0bisuke/haveibeenmorasareta">GitHub</a>
        へのプルリクエストでお願いします（<a href="https://github.com/n0bisuke/haveibeenmorasareta/blob/main/CONTRIBUTING.md">書き方</a>）。
      </p>
      <p class="muted"><a href="${root}terms/">利用規約</a>（データの利用・スクレイピングのルール）</p>
    </div>
  </footer>
</body>
</html>
`;
}

export async function writeNewsPages({ publicDir, breaches, siteUrl, siteName, ga }) {
  const out = path.join(publicDir, 'news');
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const groups = new Map();
  for (const b of breaches) {
    if (!groups.has(b.date_announced)) groups.set(b.date_announced, []);
    groups.get(b.date_announced).push(b);
  }
  const days = [...groups.keys()].sort();
  const counts = new Map(days.map((d) => [d, groups.get(d).length]));
  const latest = days.at(-1);
  for (const date of days) {
    const list = groups.get(date).sort(byCount);
    const args = { date, list, breaches, counts, days, siteUrl, siteName, ga, latest };
    await mkdir(path.join(out, date), { recursive: true });
    await writeFile(path.join(out, date, 'index.html'), page(args));
    await writeFile(path.join(out, `${date}.json`), `${JSON.stringify({ date, count: list.length, affected_total: total(list), url: `${siteUrl}/news/${date}/`, breaches: list.map((b) => item(b, siteUrl)) }, null, 2)}\n`);
    if (date === latest) await writeFile(path.join(out, 'index.html'), page({ ...args, index: true }));
  }
  await writeFile(path.join(out, 'index.json'), `${JSON.stringify({
    latest,
    days: [...days].reverse().map((d) => ({ date: d, count: counts.get(d), affected_total: total(groups.get(d)), url: `${siteUrl}/news/${d}/`, json: `${siteUrl}/news/${d}.json` })),
  }, null, 2)}\n`);
  return days;
}
