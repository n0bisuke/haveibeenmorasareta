// 各事案ファイルを追加した PR の作成者を調べ、public/contributors.json に出力する
// GitHub API を使うため、GITHUB_TOKEN と GITHUB_REPOSITORY（owner/repo）が必要（Actions では自動で設定される）
import { execFileSync } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, DATA_DIR, FILENAME_RE } from './lib.mjs';

const OUT = path.join(ROOT, 'public', 'contributors.json');
const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.log('GITHUB_TOKEN / GITHUB_REPOSITORY が無いため contributors.json の生成をスキップしました');
  process.exit(0);
}

async function api(pathname) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${pathname}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${pathname}`);
  return res.json();
}

const user = (u, extra = {}) => (u && u.type !== 'Bot' ? { login: u.login, avatar_url: u.avatar_url, ...extra } : null);

// コミットを含む PR の作成者。PR を経由していなければコミットの作者
const bySha = new Map();
async function contributorOf(sha) {
  if (!bySha.has(sha)) {
    bySha.set(sha, (async () => {
      const pulls = await api(`/commits/${sha}/pulls`);
      const pr = pulls.find((p) => p.merged_at) ?? pulls[0];
      if (pr) return user(pr.user, { pr: pr.number, url: pr.html_url });
      const commit = await api(`/commits/${sha}`);
      return user(commit.author, { url: commit.html_url });
    })());
  }
  return bySha.get(sha);
}

const files = (await readdir(DATA_DIR)).filter((f) => FILENAME_RE.test(f)).sort();
const result = {};
for (const file of files) {
  // ファイルを最初に追加したコミット（リネームは追加扱いにして現在のファイル名で数える）
  const sha = execFileSync('git', ['log', '--diff-filter=A', '--no-renames', '--format=%H', '--', path.join(DATA_DIR, file)], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').at(-1);
  if (!sha) continue;
  try {
    const c = await contributorOf(sha);
    if (c) result[file.replace(/\.ya?ml$/, '')] = c;
  } catch (e) {
    console.warn(`⚠ ${file}: ${e.message}`);
  }
}

await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(`✔ public/contributors.json に ${Object.keys(result).length} 件を出力しました`);
