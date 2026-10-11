// ランキング・ビジュアライズの個別ページ（scripts/sections.mjs）のシェア用画像（1200×630）を生成する
// 実際の個別ページをブラウザで開き、そのセクションの表示をそのまま画像にして、タイトル付きの枠に入れる。
// デプロイのたびに最新のデータで作り直す。scripts/pages.mjs の後に実行し、公開物にだけ含める（コミットはしない）
//   CHROME_PATH … 使う Chrome / Chromium（省略時はインストール済みの Google Chrome）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from './lib.mjs';
import { SECTIONS } from './sections.mjs';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// 個別ページは breaches.json を fetch するので、file:// ではなくローカルの HTTP サーバーで開く
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\/$/, '/index.html');
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;700;900&display=block" rel="stylesheet">';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const frame = (title, img) => `<!doctype html><html lang="ja"><head><meta charset="utf-8">${FONT}<style>
*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden}
body{font-family:"Noto Sans JP","Hiragino Sans",sans-serif;background:#d6336c;color:#fff;padding:28px 40px 0}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;height:78px}
h1{font-size:40px;font-weight:900;line-height:1.2;letter-spacing:.01em}
.site{font-size:20px;font-weight:700;opacity:.9;white-space:nowrap}
.shot{margin-top:16px;height:508px;border-radius:18px 18px 0 0;overflow:hidden;background:#f7f7f8 url("${img}") top center/1120px auto no-repeat;position:relative}
.shot::after{content:"";position:absolute;inset:auto 0 0 0;height:90px;background:linear-gradient(rgba(247,247,248,0),#f7f7f8)}
</style></head><body><div class="head"><h1>${esc(title)}</h1><div class="site">漏らされったー<br>morasaretter.suke.dev</div></div><div class="shot"></div></body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
// 画像の中でも読める大きさになるよう、PC 幅で開いて要素だけを撮る
const page = await browser.newPage({ viewport: { width: 1160, height: 900 }, colorScheme: 'light' });
const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
let n = 0;
for (const [parent, s] of Object.entries(SECTIONS)) {
  for (const item of s.items) {
    await page.goto(`${origin}/${parent}/${item.key}/`, { waitUntil: 'networkidle' }).catch(() => {});
    const el = page.locator(`section[aria-labelledby="${item.id}"]`);
    await el.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500);
    const shot = await el.screenshot({ animations: 'disabled' });
    await card.setContent(frame(item.title, `data:image/png;base64,${shot.toString('base64')}`), { waitUntil: 'networkidle' }).catch(() => {});
    await card.evaluate(() => document.fonts.ready);
    await card.screenshot({ path: path.join(PUBLIC, parent, item.key, 'og.png') });
    n++;
  }
}
await browser.close();
server.close();
console.log(`✔ ランキング・ビジュアライズの個別ページのシェア画像 ${n} 件を出力しました`);
