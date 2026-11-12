// 事案ごとの個別ページ（public/breach/<id>/index.html）、ランキング・ビジュアライズのセクションごとの個別ページ、
// 公表日ごとのニュースページ（public/news/）、sitemap.xml を生成する
// デプロイ時に実行し、公開物にだけ含める（リポジトリにはコミットしない）
//   SITE_URL … 公開 URL（canonical・OGP・sitemap に使う。既定 https://morasaretter.suke.dev）
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { writeSectionPages, sectionUrls } from './sections.mjs';
import { writeNewsPages } from './news.mjs';
import { writeAlertsPage } from './alerts.mjs';
import { writeArticlesPages } from './articles.mjs';
import { loadVendorPages, vendorSlugMap, writeVendorPages } from './vendors.mjs';
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
// 委託先ごとの影響先まとめページ（data/vendor-pages.yml）。事案ページの「委託先」からリンクする
const vendors = await loadVendorPages(breaches);
const VENDOR_SLUG = vendorSlugMap(vendors);
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
const countText = (b) => (b.leaked === false ? 'お漏らし無し' : b.affected_count == null ? '件数不明' : `${nf.format(b.affected_count)} 件`);
const title = (b) => `${b.organization}${b.services?.length ? `（${b.services[0]}）` : ''}の${b.leaked === false ? 'セキュリティ事案（お漏らし無し）' : '情報漏洩'}`;
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

// 個人の対応チェックリスト。チェックの状態は localStorage に保存する（この端末だけ）
function checklistHtml(b) {
  if (!b.checklist?.length) return '';
  const items = b.checklist.map((c, i) => `<li><label><input type="checkbox" data-bc="${esc(b.id)}:${i}"><span>${esc(c.text)}</span></label>${c.url ? `<a class="b-check-link" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.link_title || '公式ページ')} ↗</a>` : ''}</li>`).join('');
  return `<section class="b-check">
          <h2 class="detail-h">個人の対応チェックリスト <span class="b-check-count" aria-live="polite"></span></h2>
          <ul class="b-check-list">${items}</ul>
          <p class="b-check-note muted">リンク先は各社の公式ページです。メールや SMS のリンクではなく、ここや公式アプリ・ブックマークから開いてください。チェックの状態はこの端末のブラウザにのみ保存されます。</p>
        </section>`;
}

// 事案ページの「よくある質問」。画面に出す内容と FAQPage の構造化データを同じデータから作る
function faq(b) {
  const org = b.organization;
  const items = [];
  items.push({ q: `${org}の情報漏洩はいつ公表されましたか？`, a: `${fmtDate(b.date_announced)}に公表されました。${b.date_occurred ? `発生（判明）は${fmtDate(b.date_occurred)}です。` : ''}` });
  if (b.leaked === false) {
    items.push({ q: '情報は漏れたのですか？', a: '不正アクセスなどを受けたものの、調査の結果、情報が閲覧・持ち出された形跡は確認されなかったと公表されています。' });
  } else {
    items.push({ q: '何件の情報が漏れましたか？', a: `${b.affected_count == null ? '件数は公表されていません。' : `${nf.format(b.affected_count)}件です。`}${b.count_note ? `（${b.count_note}）` : ''}` });
    items.push({ q: 'どんな情報が漏れましたか？', a: b.data_types?.length ? `${b.data_types.join('、')}が対象と公表されています。` : '漏れた情報の種類は公表されていないか、調査中です。' });
  }
  const cause = VULN[b.vuln_target] ? `${CAUSES[b.cause]}（${VULN[b.vuln_target]}）` : CAUSES[b.cause];
  const detail = b.root_cause ? `${b.root_cause.replace(/。$/, '')}。` : '';
  items.push({ q: '原因は何ですか？', a: `${cause}です。${detail}${b.vendor ? `委託先は${b.vendor.name}です。` : ''}` });
  // 出典の先頭が公式発表のとき（信頼度「高」）だけ、その題名を案内に使う
  const official = b.reliability === 'high' ? b.sources[0] : null;
  items.push({ q: '自分の情報が含まれているか確かめるには？', a: `${official?.title ? `「${official.title}」など、` : ''}${org}の公式発表で対象の範囲を確認してください。対象者には個別に連絡が届くことがあります。${b.checklist?.length ? 'このページの「個人の対応チェックリスト」も参考にしてください。' : ''}${org}を名乗るメールや SMS のリンクは開かず、公式サイトやアプリから確かめてください。` });
  return items;
}

// AI・LLM 向けの Markdown 版（/breach/<id>/index.md）。HTML の装飾を除いた事実だけを書く
function markdown(b, url) {
  const cause = VULN[b.vuln_target] ? `${CAUSES[b.cause]}（${VULN[b.vuln_target]}）` : CAUSES[b.cause];
  const rows = [
    ['組織', b.organization],
    b.group && ['グループ', b.group],
    b.services?.length && ['サービス', b.services.join(' / ')],
    ['公表日', b.date_announced],
    b.date_occurred && ['発生日', b.date_occurred],
    ['件数', b.leaked === false ? 'お漏らし無し（漏洩の形跡なしと公表）' : b.affected_count == null ? '不明' : String(b.affected_count)],
    b.count_note && ['件数の補足', b.count_note],
    b.data_types?.length && ['漏れた情報', b.data_types.join('、')],
    ['原因', cause],
    b.root_cause && ['原因の詳細', b.root_cause],
    b.vendor && ['委託先', `${b.vendor.name}${VENDOR_SLUG.has(b.vendor.name) ? `（ほかの影響先: ${SITE_URL}/vendor/${VENDOR_SLUG.get(b.vendor.name)}/）` : ''}`],
    industries(b).length && ['業種', industries(b).join('・')],
    b.prefecture && ['都道府県', b.prefecture],
    RELIABILITY[b.reliability] && ['情報の信頼度', `${RELIABILITY[b.reliability].label}（${RELIABILITY[b.reliability].text}）`],
    b.status === 'investigating' && ['状態', '企業側が調査中'],
  ].filter(Boolean);
  return `# ${title(b)}

> ${b.summary}

${rows.map(([k, v]) => `- ${k}: ${String(v).replace(/\n/g, ' ')}`).join('\n')}

## よくある質問

${faq(b).map(({ q, a }) => `### ${q}\n\n${a}`).join('\n\n')}
${b.checklist?.length ? `\n## 個人の対応チェックリスト\n\n${b.checklist.map((c) => `- [ ] ${c.text}${c.url ? `（[${c.link_title || '公式ページ'}](${c.url})）` : ''}`).join('\n')}\n` : ''}
## 出典

${b.sources.map((s) => `- [${s.title || s.url}](${s.url})`).join('\n')}

---

- このページ: ${url}
- データ: ${SITE_URL}/breaches.json （ライセンス: CC BY 4.0。利用時は「${SITE_NAME}」と URL を出典として表示）
- 掲載内容は公式発表や報道をもとに、AI も活用して収集・作成しています。誤りや古い情報を含む場合があります。
`;
}

// シェア用ページ（/breach/<id>/light/・/dark/）。シェアした人の表示テーマに合わせた OGP 画像を出すためのもの。
// SNS のクローラーは JavaScript を実行しないので、ここに書いた og:image を読む。人が開いたときは JavaScript で
// 本来の事案ページへ移る（Facebook などは meta refresh をたどって元の画像を読むため、meta refresh は使わない）
function sharePage(b, theme) {
  const url = `${SITE_URL}/breach/${b.id}/`;
  const shareUrl = `${url}${theme}/`;
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title(b))} | ${esc(SITE_NAME)}</title>
  <meta name="description" content="${esc(description(b))}">
  <meta name="robots" content="noindex">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(SITE_NAME)}">
  <meta property="og:title" content="${esc(title(b))}">
  <meta property="og:description" content="${esc(description(b))}">
  <meta property="og:url" content="${esc(shareUrl)}">
  <meta property="og:image" content="${esc(`${url}og-${theme}.png`)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <script>location.replace('../' + location.search + location.hash);</script>
</head>
<body>
  <p><a href="../">${esc(title(b))}</a></p>
</body>
</html>
`;
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
    b.vendor && ['委託先', b.vendor.name, VENDOR_SLUG.has(b.vendor.name) ? `<a href="../../vendor/${VENDOR_SLUG.get(b.vendor.name)}/">${esc(b.vendor.name)}</a><br><small class="muted"><a href="../../vendor/${VENDOR_SLUG.get(b.vendor.name)}/">ほかの影響先も見る →</a></small>` : null],
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
  const qa = faq(b);
  const vendorSlug = b.vendor && VENDOR_SLUG.get(b.vendor.name);
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title(b),
      description: description(b),
      datePublished: b.date_announced,
      url,
      inLanguage: 'ja',
      isBasedOn: b.sources.map((s) => s.url),
      publisher: { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/` },
      license: 'https://creativecommons.org/licenses/by/4.0/',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'トップ', item: `${SITE_URL}/` },
        vendorSlug
          ? { '@type': 'ListItem', position: 2, name: `${b.vendor.name}経由の影響先`, item: `${SITE_URL}/vendor/${vendorSlug}/` }
          : { '@type': 'ListItem', position: 2, name: `${fmtDate(b.date_announced)}公表の事案`, item: `${SITE_URL}/news/${b.date_announced}/` },
        { '@type': 'ListItem', position: 3, name: title(b), item: url },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: qa.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ];

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
  ${jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n  ')}
  <link rel="alternate" type="text/markdown" href="index.md" title="Markdown 版（AI・プログラム向け）">
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
        <a href="../../news/">ニュース</a>
        <a href="../../alerts/">注意喚起</a>
        <a href="../../articles/">読みもの</a>
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
          ${b.leaked === false ? '<span class="noleak-badge">お漏らし無し</span>' : ''}
        </div>
        ${b.services?.length ? `<p class="services">${esc(b.services.join(' / '))}</p>` : ''}
        ${b.severity ? `<div class="sev-meter sev-${b.severity}" aria-hidden="true">${bars}</div>
        <p class="sev-label">${b.leaked === false ? '対象になった情報' : '漏洩した情報'}の重要度：${esc(LEVEL[b.severity].label)}（${esc(LEVEL[b.severity].description)}）</p>` : ''}
        <p class="detail-summary">${esc(b.summary)}</p>
        ${tags ? `<ul class="tags">${tags}</ul>` : ''}
        ${b.root_cause ? `<p class="root-cause"><span class="root-cause-label">原因の詳細</span><span>${esc(b.root_cause)}</span></p>` : ''}
        ${b.status === 'investigating' ? `<p class="investigating">企業が件数・漏えいの有無などを調査中と公表しています。続報の情報を${b.issue ? ` <a href="${esc(b.issue)}" target="_blank" rel="noopener noreferrer">Issue #${esc(b.issue.split('/').pop())}</a> ` : ' Issue '}で募集しています。</p>` : ''}
        ${b.leaked === false ? '<p class="noleak">※ 不正アクセスなどを受けたものの、調査の結果、情報が閲覧・持ち出された形跡は確認されなかったと公表されています。漏洩件数の合計やランキングには含めていません。</p>' : ''}
        ${b.reliability === 'low' ? `<p class="low-reliability">※ 公式発表や信頼できる報道（一次情報）をまだ確認できていない情報です。一次情報をご存じの方は${b.issue ? ` <a href="${esc(b.issue)}" target="_blank" rel="noopener noreferrer">Issue #${esc(b.issue.split('/').pop())}</a> ` : ' Issue '}で教えてください。</p>` : ''}
        ${checklistHtml(b)}
        <ol class="timeline">${timeline.map(([d, t]) => `<li><time datetime="${esc(d)}">${esc(fmtDate(d))}</time>${esc(t)}</li>`).join('')}</ol>
        <h2 class="detail-h">出典</h2>
        <ul class="sources">${b.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('')}</ul>
        ${b.related?.length ? `<h2 class="detail-h">関連ページ</h2>
        <ul class="sources related-list">${b.related.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>${r.removed ? ' <span class="removed-chip">削除済み・アーカイブ</span>' : ''}${r.note ? `<small class="related-note">${esc(r.note)}</small>` : ''}</li>`).join('')}</ul>` : ''}
        <section class="b-faq">
          <h2 class="detail-h">よくある質問</h2>
          <dl>${qa.map(({ q, a }) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl>
        </section>
      </article>
      <aside class="detail-panel detail-side">
        <dl>
          <div><dt>漏洩件数</dt><dd class="kpi${b.leaked === false ? ' kpi-noleak' : ''}">${b.leaked === false ? 'お漏らし無し' : b.affected_count == null ? '不明' : esc(nf.format(b.affected_count))}</dd>${b.count_note ? `<dd class="kpi-note">${esc(b.count_note)}</dd>` : ''}</div>
          ${facts.map(([k, v, html]) => `<div><dt>${esc(k)}</dt><dd>${html ?? esc(v)}</dd></div>`).join('\n          ')}
          ${RELIABILITY[b.reliability] ? `<div><dt>情報の信頼度</dt><dd><span class="reliability r-${b.reliability}" title="情報の信頼度：${RELIABILITY[b.reliability].label}">${[1, 2, 3].map((i) => `<i class="${i <= RELIABILITY[b.reliability].dots ? 'on' : ''}"></i>`).join('')}${esc(RELIABILITY[b.reliability].label)}</span><br><small class="muted">${esc(RELIABILITY[b.reliability].text)}</small></dd></div>` : ''}
        </dl>
      </aside>
    </div>

    <div class="share"${hasOg ? ' data-theme-share' : ''}>
      <button type="button" class="native-share" data-url="${esc(url)}" data-text="${esc(shareText)}" hidden>共有…</button>
      <a class="x-share" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&amp;url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer">𝕏 でシェア</a>
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
      <p class="muted">海外のサービスの漏洩は <a href="https://haveibeenpwned.com/" target="_blank" rel="noopener noreferrer">Have I Been Pwned</a> で調べられます（メールアドレスで、自分の情報が含まれていたかを確認できます）。</p>
      <p class="muted"><a href="../../terms/">利用規約</a>（データの利用・スクレイピングのルール）・<a href="../../releases/">リリースノート</a></p>
    </div>
  </footer>
  <script>
    // シェアする URL。見ている人の表示テーマ（ライト／ダーク）に合わせた画像が出るシェア用ページを使う
    // （クリックした時点のテーマで決める。シェア用ページが無いときは事案ページの URL のまま）
    const themed = (u) => (document.querySelector('[data-theme-share]') ? u + (document.documentElement.classList.contains('dark') ? 'dark/' : 'light/') : u);
    // スマホでは OS の共有シート（X・LINE などのアプリ）を使えるようにする
    const share = document.querySelector('.native-share');
    if (share && navigator.share) {
      share.hidden = false;
      share.addEventListener('click', () => navigator.share({ title: share.dataset.text, text: share.dataset.text, url: themed(share.dataset.url) }).catch(() => {}));
    }
    document.querySelector('.x-share')?.addEventListener('click', (e) => {
      const u = new URL(e.currentTarget.href);
      u.searchParams.set('url', themed(share.dataset.url));
      e.currentTarget.href = u.toString();
    });
    document.querySelectorAll('.b-check').forEach((sec) => {
      const boxes = sec.querySelectorAll('input[data-bc]');
      const count = sec.querySelector('.b-check-count');
      const update = () => { count.textContent = \`\${[...boxes].filter((x) => x.checked).length} / \${boxes.length}\`; };
      boxes.forEach((box) => {
        const key = 'breach-check:' + box.dataset.bc;
        try { box.checked = localStorage.getItem(key) === '1'; } catch {}
        box.addEventListener('change', () => {
          try { box.checked ? localStorage.setItem(key, '1') : localStorage.removeItem(key); } catch {}
          update();
        });
      });
      update();
    });
    document.querySelector('.copy-link')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const u = themed(btn.dataset.url);
      try { await navigator.clipboard.writeText(u); btn.textContent = 'コピーしました'; }
      catch { prompt('このリンクをコピーしてください', u); }
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
  await writeFile(path.join(dir, 'index.md'), markdown(b, `${SITE_URL}/breach/${b.id}/`));
  if (hasOg) {
    for (const theme of ['light', 'dark']) {
      await mkdir(path.join(dir, theme), { recursive: true });
      await writeFile(path.join(dir, theme, 'index.html'), sharePage(b, theme));
    }
  }
}

// ランキング・ビジュアライズのセクションごとの個別ページ
const sections = await writeSectionPages({ publicDir: PUBLIC, siteUrl: SITE_URL, siteName: SITE_NAME, og: hasOg });

// 公表日ごとのニュースページ
const newsDays = await writeNewsPages({ publicDir: PUBLIC, breaches, siteUrl: SITE_URL, siteName: SITE_NAME, ga: GA });

// セキュリティ注意喚起ページ（一覧と個別）
const alertIds = await writeAlertsPage({ publicDir: PUBLIC, siteUrl: SITE_URL, siteName: SITE_NAME, ga: GA });

// 読みもの（解説・まとめ・Tips の一覧と個別）
const articleIds = await writeArticlesPages({ publicDir: PUBLIC, siteUrl: SITE_URL, siteName: SITE_NAME, ga: GA, breaches });

// 委託先ごとの影響先まとめ（一覧と個別）
const vendorSlugs = await writeVendorPages({ publicDir: PUBLIC, siteUrl: SITE_URL, siteName: SITE_NAME, ga: GA, vendors });

// AI・LLM 向けのサイト案内（/llms.txt）
await writeFile(path.join(PUBLIC, 'llms.txt'), llmsTxt());

const urls = ['/', '/terms/', '/vendor/', ...vendorSlugs.map((s) => `/vendor/${s}/`), '/releases/', '/news/', ...newsDays.map((d) => `/news/${d}/`), ...(alertIds.length ? ['/alerts/', ...alertIds.map((id) => `/alerts/${id}/`)] : []), '/articles/', ...articleIds.map((id) => `/articles/${id}/`), '/ranking/', ...sectionUrls().filter((u) => u.startsWith('/ranking/')), '/visualization/', ...sectionUrls().filter((u) => u.startsWith('/visualization/')), ...breaches.map((b) => `/breach/${b.id}/`)];
// 事案ページの最終更新の目安（公表日）。委託先ページは最新の影響先の公表日
const LASTMOD = new Map([
  ...breaches.map((b) => [`/breach/${b.id}/`, b.date_announced]),
  ...vendors.map((v) => [`/vendor/${v.slug}/`, v.clients[0].date_announced]),
]);
await writeFile(
  path.join(PUBLIC, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(SITE_URL + u)}</loc>${LASTMOD.has(u) ? `<lastmod>${LASTMOD.get(u)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`,
);
console.log(`✔ 個別ページ ${breaches.length} 件、ランキング・ビジュアライズの個別ページ ${sections} 件、ニュース ${newsDays.length} 日分、注意喚起 ${alertIds.length} 件・読みもの ${articleIds.length} 件・委託先 ${vendorSlugs.length} 社（一覧＋個別）、Markdown 版、llms.txt と sitemap.xml を出力しました`);

// /llms.txt … AI・LLM がサイトの内容とデータの使い方を把握するための案内（https://llmstxt.org/ の形式）
function llmsTxt() {
  const latest = [...breaches].sort((a, b) => b.date_announced.localeCompare(a.date_announced) || a.id.localeCompare(b.id)).slice(0, 30);
  const total = breaches.reduce((n, b) => n + (b.leaked === false ? 0 : b.affected_count ?? 0), 0);
  return `# ${SITE_NAME}

> 日本国内で情報漏洩を公表した企業・団体・自治体の一覧です。各事案は公式発表や報道を出典として、公表日・件数・漏れた情報の種類・原因・委託先・個人の対応を構造化データで掲載しています。掲載 ${breaches.length} 件、件数が分かる事案の合計 ${total.toLocaleString('ja-JP')} 件（${String(data.generated_at ?? '').slice(0, 10)} 時点）。

- 事案データは CC BY 4.0 で自由に使えます。引用・回答に使うときは「漏らされったー（${SITE_URL}/）」と各事案ページの URL を出典として示してください。
- 件数は各社の公表値です（最大値・延べ件数を含む）。「お漏らし無し」は不正アクセスなどを受けたが情報が閲覧・持ち出された形跡はないと公表された事案で、件数の合計には含めません。
- 情報の信頼度：高＝公式発表で確認、中＝報道で確認、低＝一次情報が未確認。「企業側が調査中」は件数などが未確定です。
- 掲載内容は AI も活用して収集・作成しています。誤りや古い情報を含む場合があるため、重要な判断には各事案の出典（公式発表）を確認してください。
- HTML をスクレイピングせず、下の JSON または各事案の Markdown 版を使ってください（利用規約：${SITE_URL}/terms/）。

## データ

- [全事案の JSON](${SITE_URL}/breaches.json): 全事案の構造化データ（組織・公表日・件数・漏れた情報・原因・委託先・出典など）
- [セキュリティ注意喚起の JSON](${SITE_URL}/alerts.json): 脆弱性などの注意喚起
- [GitHub リポジトリ](${REPO}): 1事案1ファイルの YAML（data/breaches/）と変更履歴
- 各事案の Markdown 版: ${SITE_URL}/breach/<id>/index.md

## 主なページ

- [事案の一覧（トップ）](${SITE_URL}/)
- [委託先ごとの影響先まとめ](${SITE_URL}/vendor/): メール配信・クラウド・物流などの委託先から広がった情報漏洩の影響先一覧
- [公表日ごとのニュース](${SITE_URL}/news/)
- [セキュリティ注意喚起](${SITE_URL}/alerts/)
- [読みもの（解説・Tips）](${SITE_URL}/articles/)
- [ランキング](${SITE_URL}/ranking/)
- [利用規約](${SITE_URL}/terms/)

## 委託先ごとの影響先まとめ

${vendors.map((v) => `- [${v.label}経由の情報漏洩（影響先 ${v.clients.length} 件）](${SITE_URL}/vendor/${v.slug}/)`).join('\n')}

## 最近公表された事案（新しい順・30件）

${latest.map((b) => `- [${title(b)}](${SITE_URL}/breach/${b.id}/index.md): ${b.date_announced}公表・${countText(b)}`).join('\n')}
`;
}
