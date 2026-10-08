// トップページなどのシェア用画像（public/og.png、1200×630）を生成する
// 掲載事案数・漏洩件数の合計・業界別 TOP5・地域別の地図は public/breaches.json から作るので、デプロイのたびに最新になる
// scripts/build.mjs の後に実行し、公開物にだけ含める（リポジトリにはコミットしない）
//   CHROME_PATH … 使う Chrome / Chromium（省略時はインストール済みの Google Chrome）
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from './lib.mjs';

const PUBLIC = path.join(ROOT, 'public');
const data = JSON.parse(await readFile(path.join(PUBLIC, 'breaches.json'), 'utf8'));
const css = await readFile(path.join(PUBLIC, 'style.css'), 'utf8');

// 「お漏らし無し」の事案は集計から外す（サイトの統計・ランキングと同じ）
const items = data.breaches.filter((b) => b.leaked !== false);
const total = items.reduce((n, b) => n + (b.affected_count ?? 0), 0);
const nf = new Intl.NumberFormat('ja-JP');
const totalText = total >= 1e8 ? `約${(Math.floor(total / 1e7) / 10).toFixed(1)}億件` : total >= 1e4 ? `約${nf.format(Math.floor(total / 1e4))}万件` : `${nf.format(total)}件`;

// 業界別 TOP5（事案数）
const byIndustry = new Map();
for (const b of items) for (const k of [b.industry ?? []].flat()) byIndustry.set(k, (byIndustry.get(k) ?? 0) + 1);
const top = [...byIndustry].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).slice(0, 5);

// 都道府県別の事案数（地域別マップと同じく、都道府県が登録されている事案のみ）
const byPref = new Map(data.prefectures.map((p) => [p.name, 0]));
for (const b of items) if (b.prefecture && byPref.has(b.prefecture)) byPref.set(b.prefecture, byPref.get(b.prefecture) + 1);
const SHADES = ['#2a2a31', '#5c2a3f', '#8f3456', '#c2416f', '#ff6b9a'];
const shade = (c) => SHADES[c === 0 ? 0 : c === 1 ? 1 : c <= 3 ? 2 : c <= 6 ? 3 : 4];

// サイトのダークモードの統計見出しと同じ、ドット絵のしずく（style.css から取り出す）
const dropIcon = css.match(/\.dark \.stats dt::before \{ background: (url\("data:image\/svg\+xml,[^"]+"\))/)?.[1] ?? 'none';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const px = (x, y, w, h, cls = 'px') => `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`;

const CELL = 15;
const map = `<div class="map">${data.prefectures.map((p) => `<i style="left:${p.x * CELL}px;top:${p.y * CELL}px;width:${CELL - 3}px;height:${CELL - 3}px;background:${shade(byPref.get(p.name))}"></i>`).join('')}</div>`;
const rank = top.map(([k, c], i) => `<div class="r"><span class="k">${i + 1}. ${esc(k)}</span><span class="bar" style="width:${Math.round((c / top[0][1]) * 230)}px"></span><span class="c">${c}</span></div>`).join('');

// 天井から下りる配管と蛇口。吐水口の真下に水が落ち、地図のカードの上にたまって右端から垂れ落ちる
const F = 1010;
const faucet = [
  px(F + 96, 0, 28, 110), px(F + 96, 110, 28, 28), px(F, 110, 124, 28),
  px(F - 12, 76, 52, 14, 'px hd'), px(F + 7, 90, 14, 20), px(F - 4, 104, 36, 52), px(F, 156, 28, 14),
].join('');
const drip = [
  px(F + 4, 186, 20, 20, 'drop'), px(F + 4, 234, 20, 20, 'drop d2'),
  // カードの上の水たまり（右へ流れる）
  px(940, 318, 210, 12, 'pool'), px(1000, 312, 120, 6, 'pool'),
  // 右端からあふれて垂れる
  px(1136, 330, 14, 70, 'pool'), px(1132, 396, 22, 22, 'pool'),
  px(1136, 444, 14, 14, 'drop'), px(1136, 486, 14, 14, 'drop d2'), px(1136, 530, 14, 14, 'drop d3'),
  // 床の水たまり
  px(1092, 612, 108, 18, 'pool'),
].join('');

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DotGothic16&display=block" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden}
  body{background:#111114;color:#ececf1;font-family:"DotGothic16",monospace;position:relative;
    background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:24px 24px}
  .px,.drop,.pool{position:absolute}
  .px{background:#9a9aa6;box-shadow:inset -6px -6px #6b6b75}.hd{background:#c8c8d0}
  .drop{background:#ff6b9a}.d2{opacity:.7}.d3{opacity:.45}
  .pool{background:#ff6b9a99}
  .head{position:absolute;left:64px;top:48px}
  .eye{font-size:26px;color:#ff6b9a}
  h1{font-size:56px;font-weight:400;line-height:1.12;margin-top:10px;white-space:nowrap}h1 b{color:#ff6b9a;font-weight:400}
  .stats{display:flex;gap:44px;margin-top:16px}
  .stats div{font-size:22px;color:#9a9aa6}
  .stats div::before{content:"";display:inline-block;width:15px;height:20px;margin-right:8px;vertical-align:-2px;background:${dropIcon} no-repeat center/contain;image-rendering:pixelated}
  .stats strong{display:block;font-size:48px;color:#ff6b9a;font-weight:400;line-height:1.1}
  .card{position:absolute;top:330px;height:250px;border:3px solid #2e2e36;background:#16161b;padding:18px 22px}
  .cap{font-size:18px;color:#9a9aa6;margin-bottom:8px}
  .r{display:flex;align-items:center;gap:10px;font-size:20px;color:#c8c8d0;height:30px}
  .k{width:220px;white-space:nowrap}.bar{height:16px;background:#ff6b9a}.c{color:#9a9aa6}
  .map{position:relative;margin-left:120px}.map i{position:absolute}
</style></head><body>
  <div class="head">
    <div class="eye">漏らされったー</div>
    <h1>Have I Been <b>Morasareta</b> 日本版</h1>
    <div class="stats"><div>掲載事案<strong>${nf.format(data.breaches.length)}件</strong></div><div>漏洩件数の合計<strong>${totalText}</strong></div></div>
  </div>
  <div class="card" style="left:64px;width:560px"><div class="cap">業界別 TOP5（事案数）</div>${rank}</div>
  <div class="card" style="left:650px;width:486px"><div class="cap">地域別</div>${map}</div>
  ${faucet}${drip}
</body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' }).catch(() => {});
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(PUBLIC, 'og.png') });
await browser.close();
console.log(`✔ public/og.png を出力しました（掲載 ${data.breaches.length} 件・漏洩件数 ${totalText}）`);
