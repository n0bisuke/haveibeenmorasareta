import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadBreaches } from './lib.mjs';

const PUBLIC = path.join(ROOT, 'public');

const breaches = (await loadBreaches())
  .map(({ id, data }) => ({ id, ...data }))
  .sort((a, b) => b.date_announced.localeCompare(a.date_announced) || a.id.localeCompare(b.id));

// public/ の静的ファイルはそのまま公開し、データだけを生成する
await writeFile(
  path.join(PUBLIC, 'breaches.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), count: breaches.length, breaches }, null, 2),
);
console.log(`✔ public/breaches.json に ${breaches.length} 件を出力しました`);
