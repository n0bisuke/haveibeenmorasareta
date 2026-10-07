import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadBreaches } from './lib.mjs';

const PUBLIC = path.join(ROOT, 'public');

const breaches = (await loadBreaches())
  .map(({ id, data }) => ({ id, ...data }))
  .sort((a, b) => b.date_announced.localeCompare(a.date_announced) || a.id.localeCompare(b.id));

// データ変更がない限り出力が変わらないよう、更新日時は data/ の最終コミット日時を使う
function lastDataUpdate() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'data/breaches'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (out) return new Date(out).toISOString();
  } catch {}
  return new Date().toISOString();
}

// public/ の静的ファイルはそのまま公開し、データだけを生成する
await writeFile(
  path.join(PUBLIC, 'breaches.json'),
  JSON.stringify({ generated_at: lastDataUpdate(), count: breaches.length, breaches }, null, 2) + '\n',
);
console.log(`✔ public/breaches.json に ${breaches.length} 件を出力しました`);
