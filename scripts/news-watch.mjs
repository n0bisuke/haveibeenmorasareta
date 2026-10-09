// ニュースの RSS を巡回し、まだ data/breaches/ に収録されていない情報漏洩ニュースの候補を集める
// GITHUB_TOKEN と GITHUB_REPOSITORY があれば、候補を Issue（1件を毎回更新）にまとめる。無ければ標準出力に出すだけ
//   node scripts/news-watch.mjs            … 候補を表示
//   node scripts/news-watch.mjs --days 14  … 対象期間を変更（既定 7 日）
//   node scripts/news-watch.mjs --out candidates.json … 候補を JSON でも書き出す（scripts/ai-draft.mjs の入力）
//   JINA_API_KEY があれば、Jina の検索で公式発表などの Web ページと X（旧Twitter）の投稿も探す
import { writeFile } from 'node:fs/promises';
import { loadBreaches } from './lib.mjs';
import { jinaReady, jinaSearch, xPostTime } from './jina.mjs';
import { mdText, mdUrl } from './md.mjs';

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const DAYS = Number(arg('--days')) || 7;
const OUT = arg('--out');
const ISSUE_TITLE = '【自動】未収録の情報漏洩ニュース候補';
const ISSUE_LABEL = 'ニュース候補';
const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;

// 調査ソース。NHK・Yahoo!ニュースなどの一般報道は Google ニュースの検索 RSS 経由で拾う
const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${DAYS}d`)}&hl=ja&gl=JP&ceid=JP:ja`;
const FEEDS = [
  { name: 'Googleニュース「個人情報 漏えい」', url: gnews('個人情報 漏えい') },
  { name: 'Googleニュース「個人情報 流出」', url: gnews('個人情報 流出') },
  { name: 'Googleニュース「不正アクセス」', url: gnews('不正アクセス 個人情報') },
  { name: 'Googleニュース「ランサムウェア」', url: gnews('ランサムウェア 被害') },
  { name: 'Googleニュース「NHK 流出」', url: gnews('流出 site:news.web.nhk') },
  { name: 'Googleニュース「Yahoo!ニュース 漏えい」', url: gnews('漏えい site:news.yahoo.co.jp') },
  { name: 'NHKニュース 主要', url: 'https://www.nhk.or.jp/rss/news/cat0.xml' },
  { name: 'NHKニュース 社会', url: 'https://www.nhk.or.jp/rss/news/cat1.xml' },
  { name: 'Yahoo!ニュース IT', url: 'https://news.yahoo.co.jp/rss/topics/it.xml' },
  { name: 'Yahoo!ニュース 国内', url: 'https://news.yahoo.co.jp/rss/topics/domestic.xml' },
  { name: 'ScanNetSecurity', url: 'https://scan.netsecurity.ne.jp/rss/index.rdf' },
  { name: 'Security NEXT', url: 'https://www.security-next.com/feed' },
];

// 情報漏洩に関係しそうな見出しだけを残す
const KEYWORDS = /漏えい|漏洩|流出|不正アクセス|ランサムウェア|不正ログイン|誤送信|誤送付|紛失|サイバー攻撃|閲覧可能|持ち出し/;

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '')
  .trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};

// RSS 2.0 / RSS 1.0（RDF）/ Atom の項目を { title, url, date } にする
function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  return blocks.map((b) => {
    const atomLink = b.match(/<link[^>]*href="([^"]+)"/);
    return {
      title: tag(b, 'title'),
      url: tag(b, 'link') || (atomLink ? decode(atomLink[1]) : ''),
      date: tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'updated') || tag(b, 'published'),
      source: tag(b, 'source'),
    };
  }).filter((i) => i.title && i.url);
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, { headers: { 'User-Agent': 'haveibeenmorasareta-news-watch' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFeed(await res.text()).map((i) => ({ ...i, feed: feed.name }));
  } catch (e) {
    console.warn(`⚠ ${feed.name}: ${e.message}`);
    return [];
  }
}

// 既存データの企業名・サービス名・出典URL。見出しにこれらが含まれていれば収録済みとみなす
// （同じ企業の別事案を取りこぼさないよう、企業名での判定は最近公表された事案に限る）
async function knownIndex() {
  const names = new Set();
  const urls = new Set();
  const short = (s) => s.replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益財団法人|学校法人|医療法人[^ ]*|国立大学法人|地方独立行政法人|独立行政法人|国立研究開発法人|（.*?）|\(.*?\)/g, '').trim();
  const recent = new Date(Date.now() - (DAYS + 60) * 86400000).toISOString().slice(0, 10);
  for (const { data } of await loadBreaches()) {
    if (!data) continue;
    for (const s of data.sources ?? []) urls.add(s.url);
    if (data.date_announced < recent) continue;
    for (const n of [data.organization, ...(data.organization ?? '').split('・'), data.group, ...(data.services ?? [])]) {
      const s = n && short(n);
      if (s && s.length >= 2) names.add(s);
    }
  }
  return { names: [...names], urls };
}

const since = Date.now() - DAYS * 86400000;
const normalize = (t) => t.replace(/\s*[-|｜]\s*[^-|｜]+$/, '').replace(/[\s　「」『』【】（）()、。,.!！?？・:：]/g, '');

const items = (await Promise.all(FEEDS.map(fetchFeed))).flat();
const { names, urls } = await knownIndex();
const seen = new Set();
const candidates = [];
const consider = (i) => {
  const time = Date.parse(i.date);
  if (Number.isFinite(time) && time < since) return;
  if (!KEYWORDS.test(i.title)) return;
  if (urls.has(i.url) || names.some((n) => i.title.includes(n))) return;
  const key = normalize(i.title);
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ ...i, time: Number.isFinite(time) ? time : 0 });
};
items.forEach(consider);

// ---- Jina の検索（JINA_API_KEY があるときだけ） ----
// 公式発表などの Web ページ: 日付が分かる直近のものだけをニュースと同じ候補に加える（AI 下書きの対象にもなる）
const WEB_QUERIES = ['不正アクセス 個人情報 漏えい お詫び', '個人情報 流出 お知らせ 不正アクセス', 'ランサムウェア 被害 お知らせ 個人情報', '個人情報 漏洩 お詫び 誤送信'];
// X の投稿: SNS は出典にできないため、Issue の別欄に載せるだけ（AI 下書きには渡さない）
const X_QUERIES = ['個人情報 流出 お詫び', '不正アクセス 個人情報 漏えい', '情報漏洩 お知らせ', 'ランサムウェア 被害 個人情報', '漏洩 メール 届いた'];
const isX = (u) => /^https?:\/\/(?:[\w-]+\.)?(?:x|twitter)\.com\//.test(u);
const xPosts = [];
const jinaErrors = [];
if (jinaReady) {
  const search = async (q, opt) => {
    try {
      return await jinaSearch(q, opt);
    } catch (e) {
      jinaErrors.push(`「${q}」${e.message}`);
      return [];
    }
  };
  // 検索には期間の指定が無いため、今月（月初は先月も）を検索語に入れて直近の発表に寄せる
  const ym = (d) => d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long' });
  const months = [...new Set([ym(new Date()), ym(new Date(since))])];
  for (const q of WEB_QUERIES.flatMap((w) => months.map((m) => `${w} ${m}`))) {
    for (const r of await search(q)) {
      if (isX(r.url)) continue;
      // 日付が無い結果は、見出し・説明に今月（先月）の年月が書かれているものだけを残す
      const dated = Number.isFinite(Date.parse(r.date));
      if (!dated && !months.some((m) => `${r.title} ${r.description}`.includes(m))) continue;
      consider({ title: r.title, url: r.url, date: dated ? r.date : '', source: 'Jina 検索' });
    }
  }
  const seenX = new Set();
  for (const q of X_QUERIES) {
    for (const r of await search(q, { site: 'x.com' })) {
      const time = xPostTime(r.url);
      const text = `${r.title} ${r.description}`;
      if (!(time >= since) || seenX.has(r.url) || !KEYWORDS.test(text) || names.some((n) => text.includes(n))) continue;
      seenX.add(r.url);
      xPosts.push({ title: r.title, text: r.description, url: r.url, time });
    }
  }
  xPosts.sort((a, b) => b.time - a.time);
  for (const e of jinaErrors) console.warn(`⚠ Jina: ${e}`);
}
candidates.sort((a, b) => b.time - a.time);
if (OUT) await writeFile(OUT, `${JSON.stringify(candidates, null, 2)}\n`);

const fmt = (t) => (t ? new Date(t).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '日付不明');
const body = [
  `直近 ${DAYS} 日のニュースから、まだ収録されていない可能性がある情報漏洩の記事を自動で集めました（${candidates.length} 件）。`,
  '見出しに既存データの企業名・サービス名が含まれるものは除外しています。対象外の記事（漏洩でない障害・海外事案など）も混ざるため、確認のうえで `data/breaches/` に追加してください。',
  '',
  ...candidates.map((c) => `- [ ] ${fmt(c.time)} ${mdUrl(c.url) ? `[${mdText(c.title)}](${mdUrl(c.url)})` : mdText(c.title)}${c.source ? `（${mdText(c.source)}）` : ''}`),
  '',
  ...(xPosts.length ? [
    `## X（旧Twitter）で話題の投稿（${xPosts.length} 件）`,
    '',
    'SNS の投稿は出典にできません。公式発表や報道を確認できたものだけを追加してください（会社からのお詫びメールが届いたという投稿などは、情報募集の Issue にするのも手です）。',
    '',
    ...xPosts.map((p) => `- [ ] ${fmt(p.time)} ${mdUrl(p.url) ? `[${mdText(p.title)}](${mdUrl(p.url)})` : mdText(p.title)}${p.text ? `<br>${mdText(p.text).slice(0, 140)}` : ''}`),
    '',
  ] : []),
  `<sub>巡回したソース: ${[...FEEDS.map((f) => f.name), ...(jinaReady ? ['Jina 検索（公式発表などの Web ページ・X の投稿）'] : [])].join(' / ')}。更新: ${new Date().toISOString()}（\`scripts/news-watch.mjs\`）</sub>`,
].join('\n');

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.log(body);
  process.exit(0);
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

// 第三者が同じタイトルの Issue を先に作っても乗っ取られないよう、ボット（Actions）が作った Issue だけを更新する
const open = (await api('/issues?state=open&per_page=100')).find((i) => i.title === ISSUE_TITLE && !i.pull_request && i.user?.login === 'github-actions[bot]');
if (open) {
  await api(`/issues/${open.number}`, { method: 'PATCH', body: JSON.stringify({ body, labels: [ISSUE_LABEL] }) });
  console.log(`✔ Issue #${open.number} を更新しました（候補 ${candidates.length} 件）`);
} else if (candidates.length || xPosts.length) {
  const created = await api('/issues', { method: 'POST', body: JSON.stringify({ title: ISSUE_TITLE, body, labels: [ISSUE_LABEL] }) });
  console.log(`✔ Issue #${created.number} を作成しました（候補 ${candidates.length} 件）`);
} else {
  console.log('候補はありませんでした');
}
