// デプロイ時に public/ 内の JS・CSS・JSON の参照へバージョン（?v=コミットSHA）を付け、
// 更新直後に古いファイルがブラウザのキャッシュから読まれて動かなくなるのを防ぐ
// （公開物にだけ適用し、リポジトリの public/ はコミットしない）
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const PUBLIC = path.join(ROOT, 'public');
const version = (process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 7);
const local = (u) => !/^(?:[a-z]+:)?\/\//i.test(u) && !u.includes('?');

const files = (await readdir(PUBLIC, { recursive: true })).filter((f) => /\.(?:html|js)$/.test(f));
for (const file of files) {
  const p = path.join(PUBLIC, file);
  const before = await readFile(p, 'utf8');
  const after = before
    // <script src="..."> / <link href="...css">
    .replace(/\b(src|href)="([^"]+\.(?:js|css))"/g, (m, attr, u) => (local(u) ? `${attr}="${u}?v=${version}"` : m))
    // import ... from '...js' / fetch('...json')
    .replace(/\b(from\s+|fetch\()(['"])([^'"]+\.(?:js|json))\2/g, (m, pre, q, u) => (local(u) ? `${pre}${q}${u}?v=${version}${q}` : m));
  if (after !== before) await writeFile(p, after);
}
console.log(`✔ public/ の参照に ?v=${version} を付けました`);
