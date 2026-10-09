// 「企業側が調査中」「一次情報募集」の Issue について、Jina の検索で続報・一次情報の候補を探し、Issue にコメントする
// 人や AI エージェント（Web を見られない環境を含む）が、コメントの候補をもとにデータを更新できるようにする
//   JINA_API_KEY            … 無ければ何もしない
//   GITHUB_TOKEN / GITHUB_REPOSITORY … Issue の取得とコメントに使う
//   node scripts/follow-up.mjs --dry-run … コメントせず、内容を表示するだけ
import { loadBreaches } from './lib.mjs';
import { jinaReady, jinaSearch } from './jina.mjs';
import { mdLink, mdText } from './md.mjs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY = 'n0bisuke/haveibeenmorasareta' } = process.env;
const DRY = process.argv.includes('--dry-run') || !GITHUB_TOKEN;
const LABELS = ['企業側が調査中', '一次情報募集'];
const MARK = (url) => `<!-- follow-up: ${encodeURI(url).replace(/-->/g, '')} -->`;
const KEYWORDS = /漏えい|漏洩|流出|不正アクセス|ランサムウェア|不正ログイン|サイバー攻撃|お詫び|お知らせ|続報|第\d報|調査結果/;

if (!jinaReady) {
  console.log('JINA_API_KEY が未設定のため、続報の検索はしません');
  process.exit(0);
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Issue の URL → 事案データ（issue を指定している事案だけ）
const byIssue = new Map();
for (const { id, data } of await loadBreaches()) if (data.issue) byIssue.set(data.issue, { id, ...data });

const issues = new Map();
for (const label of LABELS) {
  for (const i of await api(`/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`)) if (!i.pull_request) issues.set(i.number, i);
}

const short = (s) => s.replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益財団法人|学校法人|国立大学法人|\s/g, '');
let commented = 0;
for (const issue of issues.values()) {
  const b = byIssue.get(issue.html_url);
  if (!b) continue; // 事案データと結び付いていない Issue は対象外
  const name = short(b.organization);
  const names = [name, ...(b.services ?? []).map(short)].filter((n) => n.length >= 2);
  const known = new Set(b.sources.map((s) => s.url));
  // ボットが前に載せた URL は載せ直さない
  const comments = issue.comments ? await api(`/issues/${issue.number}/comments?per_page=100`) : [];
  const posted = new Set(comments.filter((c) => c.user?.login === 'github-actions[bot]').flatMap((c) => [...c.body.matchAll(/<!-- follow-up: (\S+) -->/g)].map((m) => decodeURI(m[1]))));

  let results = [];
  for (const q of [`${name} 個人情報 漏えい`, `${name} 不正アクセス 続報`]) {
    try {
      results.push(...await jinaSearch(q));
    } catch (e) {
      console.warn(`⚠ #${issue.number}「${q}」: ${e.message}`);
    }
  }
  const seen = new Set();
  results = results.filter((r) => {
    if (seen.has(r.url) || known.has(r.url) || posted.has(r.url)) return false;
    seen.add(r.url);
    const text = `${r.title} ${r.description}`;
    if (!names.some((n) => text.includes(n)) || !KEYWORDS.test(text)) return false;
    // 日付が分かるものは、最初の公表日より前の記事を除く
    const t = Date.parse(r.date);
    return !Number.isFinite(t) || t >= Date.parse(b.date_announced);
  }).slice(0, 5);
  if (!results.length) continue;

  const body = [
    `Jina の検索で、この事案の続報・一次情報の候補が見つかりました（${results.length} 件）。内容を確認し、公式発表や報道で確かめられたら \`data/breaches/${b.id}.yml\` を更新してください。`,
    '',
    ...results.map((r) => `- ${r.date ? `${mdText(String(r.date).slice(0, 10))} ` : ''}${mdLink(r.title, r.url)}${r.description ? `<br>${mdText(r.description, 140)}` : ''}`),
    '',
    '<sub>`Follow-up search` ワークフロー（`scripts/follow-up.mjs`）が自動で投稿しました。検索結果には無関係な記事も含まれます。</sub>',
    ...results.map((r) => MARK(r.url)),
  ].join('\n');

  if (DRY) {
    console.log(`== #${issue.number} ${b.id}\n${body}\n`);
  } else {
    await api(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    console.log(`✔ #${issue.number} に候補 ${results.length} 件をコメントしました`);
  }
  commented++;
}
console.log(`対象の Issue ${issues.size} 件・候補があった Issue ${commented} 件${DRY ? '（--dry-run: コメントはしていません）' : ''}`);
