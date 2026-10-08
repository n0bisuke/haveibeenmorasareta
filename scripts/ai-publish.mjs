// scripts/ai-draft.mjs の下書きを検証し、1件ずつ PR にする（LLM は使わない。API キーも持たない）
//   node scripts/ai-publish.mjs --in ai-out/drafts.json
//   GITHUB_TOKEN / GITHUB_REPOSITORY が無ければ、検証して data/breaches/ に書き出すだけ（ローカル確認用）
//   AI_AUTO_MERGE=true のとき、条件を満たす PR は検証の成功を待って自動でマージする
import { execFileSync } from 'node:child_process';
import { appendFile, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { DATA_DIR, loadBreaches } from './lib.mjs';
import { createChecker } from './check.mjs';
import { isTrustedSource } from './ai/guard.mjs';

const arg = (name, def) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : def);
const IN = arg('--in', 'ai-out/drafts.json');
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_STEP_SUMMARY, AI_AUTO_MERGE } = process.env;
const ONLINE = Boolean(GITHUB_TOKEN && GITHUB_REPOSITORY);
const LABEL = 'ai-draft';
const ORDER = ['organization', 'group', 'services', 'industry', 'country', 'org_type', 'prefecture', 'date_occurred', 'date_announced', 'affected_count', 'count_note', 'cause', 'root_cause', 'vuln_target', 'attack_methods', 'vendor', 'data_types', 'summary', 'sources'];

const drafts = JSON.parse(await readFile(IN, 'utf8'));
const { checkEntry } = await createChecker();
const breaches = await loadBreaches();
const knownUrls = new Set(breaches.flatMap((b) => (b.data?.sources ?? []).map((s) => s.url)));

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function api(p, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`${res.status} ${p}: ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// LLM 由来の文字列を PR 本文に載せるときの無害化（リンク・メンション・HTML を作らせない）
const esc = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}[\]()<>#+!|~]/g, '\\$&').replace(/@/g, '@\u200b').replace(/https?:\/\//g, (m) => m.replace('//', '/\u200b/')).slice(0, 300);

// 既に AI 下書きの PR を作った出典 URL（閉じたものも含む）
async function draftedUrls() {
  if (!ONLINE) return new Set();
  const pulls = await api(`/pulls?state=all&per_page=100&sort=created&direction=desc`);
  return new Set(pulls.filter((p) => p.labels.some((l) => l.name === LABEL))
    .flatMap((p) => [...(p.body ?? '').matchAll(/<!-- ai-source: (\S+) -->/g)].map((m) => m[1])));
}

// 最終的な検証（ai-draft.mjs の結果は信用せず、ここでもう一度確かめる）
function verify(d) {
  const errors = [];
  const e = d.entry;
  if (!e || typeof e !== 'object') return ['データがありません'];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug ?? '') || d.slug.length > 40) errors.push('slug が不正');
  if ('status' in e || 'issue' in e) errors.push('status / issue は AI 下書きに含められません');
  if (!Array.isArray(e.sources) || e.sources.length !== 1 || e.sources[0].url !== d.source?.url) errors.push('出典は取得した記事1件だけにしてください');
  if (/[\n\r<>`]|https?:|www\.|\]\(/.test(e.summary ?? '')) errors.push('summary に改行・URL・HTML などが含まれています');
  for (const { url } of e.sources ?? []) if (knownUrls.has(url)) errors.push('出典URLが既存のデータと重複しています');
  return errors;
}

const toYaml = (entry) => {
  const ordered = Object.fromEntries(ORDER.filter((k) => k in entry).map((k) => [k, entry[k]]));
  return yaml.dump(ordered, { schema: yaml.CORE_SCHEMA, lineWidth: -1, noRefs: true });
};

function autoMergeable(d) {
  const reasons = [];
  if (d.editor?.verdict !== 'ok' || d.editor?.issues?.length || d.editor?.corrected?.length) reasons.push('編集者の指摘・修正あり');
  if (d.dropped?.length) reasons.push('検査で削除・補完した項目あり');
  if (d.injection) reasons.push('記事本文に AI への指示らしき文あり');
  if (!isTrustedSource(d.source?.url)) reasons.push('出典が自動マージ対象のドメインではない');
  return reasons;
}

function prBody(d, file, reasons) {
  const lines = [
    '> [!IMPORTANT]',
    '> AI（ライター役・編集者役の LLM）が作った下書きです。マージする前に、出典の記事と内容を照合してください。',
    '',
    `- 出典: [${esc(d.source.title)}](${encodeURI(d.source.url).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)})`,
    `- 追加するファイル: \`data/breaches/${file}\``,
    `- ライターの判断: ${esc(d.writer?.reason)}`,
    `- 編集者の判定: **${esc(d.editor?.verdict)}**`,
  ];
  if (d.editor?.issues?.length) {
    lines.push('', '### 編集者の指摘', ...d.editor.issues.map((i) => `- \`${esc(i.field).replace(/`/g, '')}\` ${esc(i.problem)}`));
  }
  if (d.editor?.corrected?.length) lines.push('', `編集者が修正した項目: ${d.editor.corrected.map(esc).join(', ')}`);
  if (d.dropped?.length) {
    lines.push('', '### プログラムの検査で削除・補完した項目', ...d.dropped.map((x) => `- ${esc(x.field)}: ${esc(x.reason)}`));
  }
  if (d.injection) lines.push('', `> [!WARNING]\n> 記事本文に AI への指示らしき文が含まれていました（「${esc(d.injection)}」）。内容を特に注意して確認してください。`);
  lines.push('', reasons.length ? `自動マージ: 対象外（${reasons.join('、')}）` : `自動マージ: ${AI_AUTO_MERGE === 'true' ? '対象（検証が成功したら自動でマージします）' : '条件は満たしています（AI_AUTO_MERGE が無効のため手動でマージしてください）'}`);
  lines.push('', '<sub>このPRは `News watch` ワークフローの `scripts/ai-draft.mjs` → `scripts/ai-publish.mjs` が作成しました。</sub>');
  lines.push(`<!-- ai-source: ${d.source.url} -->`, `<!-- ai-source: ${d.candidate.url} -->`);
  return lines.join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForValidate(branch) {
  for (let i = 0; i < 40; i++) {
    await sleep(15000);
    const { workflow_runs: runs } = await api(`/actions/workflows/validate.yml/runs?branch=${encodeURIComponent(branch)}&per_page=5`);
    const run = runs.find((r) => r.event === 'workflow_dispatch');
    if (run?.status === 'completed') return run.conclusion === 'success';
  }
  return false;
}

const summary = ['## AI 下書き', ''];
const done = await draftedUrls();
const base = ONLINE ? git('rev-parse', '--abbrev-ref', 'HEAD') : null;
const toMerge = [];
if (ONLINE) {
  await api('/labels', { method: 'POST', body: JSON.stringify({ name: LABEL, color: 'c5def5', description: 'AI が作った事案データの下書き' }) }).catch((e) => { if (e.status !== 422) throw e; });
}

for (const d of drafts) {
  const title = esc(d.source?.title ?? d.candidate?.title);
  if (d.status !== 'draft') {
    summary.push(`- ${d.status}: ${title}${d.notes?.length ? `（${d.notes.map(esc).join(' / ')}）` : ''}`);
    continue;
  }
  if (done.has(d.source.url) || done.has(d.candidate.url)) {
    summary.push(`- skipped: ${title}（AI 下書きの PR を作成済み）`);
    continue;
  }
  const errors = verify(d);
  let file = `${d.entry.date_announced?.slice(0, 7)}-${d.slug}.yml`;
  for (let n = 2; existsSync(path.join(DATA_DIR, file)); n++) file = `${d.entry.date_announced.slice(0, 7)}-${d.slug}-${n}.yml`;
  if (!errors.length) errors.push(...checkEntry(file, d.entry));
  if (errors.length) {
    summary.push(`- invalid: ${title}（${errors.map(esc).join(' / ')}）`);
    continue;
  }

  const branch = `ai-draft/${file.replace(/\.yml$/, '')}`;
  if (ONLINE) git('checkout', '-B', branch, base);
  const dest = path.join(DATA_DIR, file);
  await writeFile(dest, toYaml(d.entry));
  try {
    execFileSync('node', ['scripts/validate.mjs'], { stdio: 'pipe' });
  } catch (e) {
    await rm(dest);
    summary.push(`- invalid: ${title}（データ全体の検証に失敗: ${esc(e.stderr?.toString())}）`);
    if (ONLINE) git('checkout', base);
    continue;
  }
  if (!ONLINE) {
    summary.push(`- draft: ${title} → data/breaches/${file}`);
    continue;
  }

  git('add', dest);
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', `AI 下書き: ${d.entry.organization}（${d.entry.date_announced}公表）`);
  git('push', '--force', 'origin', branch);
  git('checkout', base);
  const reasons = autoMergeable(d);
  const pr = await api('/pulls', {
    method: 'POST',
    body: JSON.stringify({ title: `[AI下書き] ${d.entry.organization}（${d.entry.date_announced}公表）`, head: branch, base, body: prBody(d, file, reasons) }),
  });
  await api(`/issues/${pr.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [LABEL] }) });
  // Actions のトークンで作った PR では Validate が自動で動かないので、ブランチを指定して起動する
  await api('/actions/workflows/validate.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: branch }) });
  summary.push(`- draft: ${title} → #${pr.number}`);
  if (!reasons.length && AI_AUTO_MERGE === 'true') toMerge.push({ pr, branch });
}

let merged = 0;
for (const { pr, branch } of toMerge) {
  if (!(await waitForValidate(branch))) {
    summary.push(`- #${pr.number}: 検証が成功しなかったため自動マージしませんでした`);
    continue;
  }
  try {
    await api(`/pulls/${pr.number}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: 'merge' }) });
    merged++;
    summary.push(`- #${pr.number}: 自動マージしました`);
  } catch (e) {
    summary.push(`- #${pr.number}: 自動マージに失敗しました（${esc(e.message)}）`);
  }
}
// Actions のトークンでのマージでは Deploy が自動で動かないので起動する
if (merged) await api('/actions/workflows/deploy.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: base }) });

const text = summary.length > 2 ? summary.join('\n') : `${summary.join('\n')}\n候補はありませんでした`;
console.log(text);
if (GITHUB_STEP_SUMMARY) await appendFile(GITHUB_STEP_SUMMARY, `${text}\n`);
