// ランキング・ビジュアライズの各セクションを1つだけ表示する個別ページ（/ranking/<key>/・/visualization/<key>/）
// 親ページ（public/ranking/index.html など）を元に、<base> で参照先をそろえ、タイトル・OGP を差し替え、
// 対象以外のセクションを隠す。scripts/pages.mjs から呼ぶ（公開物にだけ含め、コミットはしない）
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SECTIONS = {
  ranking: {
    label: 'ランキング',
    items: [
      { key: 'org', id: 'org-title', title: '企業・グループ別の情報漏洩ランキング', description: '日本国内で公表された情報漏洩を、企業・グループ別にランキングで表示します。' },
      { key: 'industry', id: 'industry-title', title: '業界別の情報漏洩ランキング', description: '日本国内で公表された情報漏洩を、業界別にランキングで表示します。' },
      { key: 'cause', id: 'cause-title', title: '原因別の情報漏洩ランキング', description: '日本国内で公表された情報漏洩を、不正アクセス・誤送信などの原因別にランキングで表示します。' },
      { key: 'attack', id: 'attack-title', title: '攻撃手法別の情報漏洩ランキング', description: '日本国内で公表された情報漏洩を、攻撃手法別にランキングで表示します。' },
      { key: 'vuln', id: 'vuln-title', title: '脆弱性を悪用された箇所のランキング', description: '脆弱性を悪用された情報漏洩を、悪用された箇所（VPN機器・Webアプリなど）別にランキングで表示します。' },
      { key: 'vendor', id: 'vendor-title', title: '委託先別の情報漏洩ランキング', description: '委託先・取引先を経由した情報漏洩を、委託先別にランキングで表示します。' },
      { key: 'noleak', id: 'noleak-title', title: 'お漏らししなかったランキング', description: '不正アクセスなどを受けたものの、情報が漏れた形跡は確認されなかった事案のランキングです。' },
    ],
  },
  visualization: {
    label: 'ビジュアライズ',
    items: [
      { key: 'monthly', id: 'monthly-title', title: '月ごとの情報漏洩の推移', description: '日本国内で公表された情報漏洩の事案数・漏洩件数を、月ごとのグラフで表示します。' },
      { key: 'map', id: 'map-title', title: '地域別の情報漏洩マップ', description: '自治体・大学・地方銀行などの情報漏洩を、都道府県別の地図で表示します。' },
      { key: 'lineage', id: 'lineage-title', title: '漏洩の系譜（委託先から広がった事案）', description: '委託先・提携先から複数の企業に広がった情報漏洩を、家系図で表示します。' },
    ],
  },
};

export const sectionUrls = () => Object.entries(SECTIONS).flatMap(([parent, s]) => s.items.map((i) => `/${parent}/${i.key}/`));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 親ページの HTML から、1つのセクションだけを表示するページを作る
export function sectionPage(html, { parent, label, item, siteUrl, siteName, ogImage }) {
  const url = `${siteUrl}/${parent}/${item.key}/`;
  const title = `${item.title} | ${siteName}`;
  const set = (re, value) => {
    if (!re.test(html)) throw new Error(`${parent}/index.html に ${re} が見つかりません`);
    html = html.replace(re, value);
  };
  // 相対パス（../style.css・ranking.js・fetch('../breaches.json') など）は親ページと同じ場所を基準にする
  set(/<head>/, `<head>\n  <base href="../">`);
  set(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  set(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(item.description)}">`);
  set(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
  set(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
  set(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(item.description)}">`);
  set(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
  if (ogImage) set(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${ogImage}">`);
  // 対象以外のセクションと、個別ページへのリンクを隠す
  set(/<\/head>/, `  <style>main > section.viz-card:not([aria-labelledby="${item.id}"]), .viz-permalink { display: none; }</style>\n</head>`);
  set(/<body>/, `<body data-section="${item.key}">`);
  set(/<main class="wrap">/, `<main class="wrap">\n    <p class="section-back"><a href="./">← ${esc(label)}のすべてを見る</a></p>`);
  return html;
}

export async function writeSectionPages({ publicDir, siteUrl, siteName, og }) {
  let n = 0;
  for (const [parent, s] of Object.entries(SECTIONS)) {
    const html = await readFile(path.join(publicDir, parent, 'index.html'), 'utf8');
    for (const item of s.items) {
      const dir = path.join(publicDir, parent, item.key);
      await mkdir(dir, { recursive: true });
      const ogImage = og ? `${siteUrl}/${parent}/${item.key}/og.png` : null;
      await writeFile(path.join(dir, 'index.html'), sectionPage(html, { parent, label: s.label, item, siteUrl, siteName, ogImage }));
      n++;
    }
  }
  return n;
}
