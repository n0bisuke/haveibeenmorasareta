// Issue（新しく立った Issue と、事案データに紐づく Issue へのコメント）から記事・公式発表の URL を取り出し、
// AI 下書き（scripts/ai-draft.mjs）に渡す候補にする（LLM は使わない。リポジトリにも書き込まない）
//   node scripts/issue-intake.mjs --out issue-in
//   GITHUB_EVENT_PATH … Actions のイベント（issues: opened / issue_comment: created）
// 出力: issue-in/candidates.json（候補）と issue-in/meta.json（Issue の番号）。対象外なら候補は空
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadBreaches } from './lib.mjs';

const arg = (name, def) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : def);
const OUT = arg('--out', 'issue-in');
const MAX_URLS = Number(process.env.ISSUE_MAX_URLS) || 3;
// 出典にできない SNS・GitHub 自体の URL は渡さない
const SKIP_HOSTS = /(^|\.)(github\.com|githubusercontent\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|threads\.net|tiktok\.com|youtube\.com|youtu\.be|bsky\.app)$/;

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const { issue, comment, sender } = event;
await mkdir(OUT, { recursive: true });
const done = async (candidates, reason) => {
  await writeFile(path.join(OUT, 'candidates.json'), `${JSON.stringify(candidates, null, 2)}\n`);
  await writeFile(path.join(OUT, 'meta.json'), `${JSON.stringify({ issue: issue?.number ?? null, count: candidates.length })}\n`);
  console.log(reason ?? `候補 ${candidates.length} 件`);
  process.exit(0);
};

if (!issue || issue.pull_request) await done([], 'Issue ではないため対象外');
if (sender?.type === 'Bot' || /\[bot\]$/.test(sender?.login ?? '')) await done([], 'ボットの投稿のため対象外');

const breaches = (await loadBreaches()).filter((b) => b.data);
// この Issue を「情報募集用の Issue」に指定している事案（続報の更新先の候補）
const related = breaches.filter((b) => b.data.issue === issue.html_url).map((b) => b.id);
// コメントは、事案データに紐づく Issue（調査中・一次情報募集など）へのものだけを対象にする
if (comment && !related.length) await done([], '事案データに紐づかない Issue へのコメントのため対象外');

const text = comment ? comment.body : `${issue.title}\n${issue.body ?? ''}`;
const known = new Set(breaches.flatMap((b) => (b.data.sources ?? []).map((s) => s.url)));
const urls = [];
for (const m of String(text ?? '').matchAll(/https?:\/\/[^\s<>()\[\]"'`、。「」]+/g)) {
  let url;
  try {
    url = new URL(m[0].replace(/[.,;:!?）】』]+$/, ''));
  } catch {
    continue;
  }
  if (!/^https?:$/.test(url.protocol) || SKIP_HOSTS.test(url.hostname)) continue;
  url.hash = '';
  const href = url.href;
  if (known.has(href) || urls.includes(href)) continue;
  urls.push(href);
  if (urls.length >= MAX_URLS) break;
}

const title = String(issue.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 120);
await done(urls.map((url) => ({ title, url, issue: issue.number, related })));
