import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadBreaches } from './lib.mjs';

const DIST = path.join(ROOT, 'dist');

const breaches = (await loadBreaches())
  .map(({ id, data }) => ({ id, ...data }))
  .sort((a, b) => b.date_announced.localeCompare(a.date_announced) || a.id.localeCompare(b.id));

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(path.join(ROOT, 'src'), DIST, { recursive: true });
await writeFile(
  path.join(DIST, 'breaches.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), count: breaches.length, breaches }, null, 2),
);
console.log(`✔ dist/ に ${breaches.length} 件を出力しました`);
