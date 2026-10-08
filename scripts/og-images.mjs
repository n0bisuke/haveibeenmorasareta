// 事案ごとの OGP 画像（public/breach/<id>/og.png、1200×630）を生成する
// scripts/pages.mjs の後に実行し、公開物にだけ含める（リポジトリにはコミットしない）
//   node scripts/og-images.mjs [--only <事案ID>,...] [--style a|b|c]
//   CHROME_PATH … 使う Chrome / Chromium（省略時はインストール済みの Google Chrome）
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from './lib.mjs';
import { CAUSES } from '../public/labels.js';

const PUBLIC = path.join(ROOT, 'public');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const only = arg('--only')?.split(',');
const STYLE = arg('--style') ?? process.env.OG_STYLE ?? 'a';

const data = JSON.parse(await readFile(path.join(PUBLIC, 'breaches.json'), 'utf8'));
const LEVEL = Object.fromEntries(data.severity_levels.map((l) => [l.id, l]));
const breaches = data.breaches.filter((b) => !only || only.includes(b.id));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('ja-JP');
const fmtDate = (s) => s.replaceAll('-', '/');
const SEV_COLOR = { critical: '#d92d20', high: '#f79009', medium: '#e0a800', low: '#98a2b3' };

// 組織名の長さに合わせて文字サイズを下げる
const orgSize = (s, base) => (s.length > 26 ? base * 0.62 : s.length > 18 ? base * 0.78 : base);

function view(b) {
  const count = b.affected_count == null ? null : nf.format(b.affected_count);
  const sev = b.severity && LEVEL[b.severity];
  const svc = (b.services ?? []).join(' / ');
  const meta = `${fmtDate(b.date_announced)} 公表 ・ ${CAUSES[b.cause]}`;
  return { count, sev, svc, meta, investigating: b.status === 'investigating' };
}

const FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@500;700;900&family=DotGothic16&display=block" rel="stylesheet">';
const BASE = `*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden}body{font-family:"Noto Sans JP","Hiragino Sans",sans-serif}`;

const STYLES = {
  // A: ライト（サイトの一覧カードと同じトーン。水じみの装飾）
  a(b) {
    const v = view(b);
    return `<style>${BASE}
      body{background:#f7f7f8;color:#1c1c1f;padding:56px 64px;position:relative}
      .stain{position:absolute;border-radius:50%;border:3px solid rgba(214,51,108,.18);background:radial-gradient(closest-side,rgba(214,51,108,.04) 60%,rgba(214,51,108,.1))}
      .card{position:relative;height:100%;background:#fff;border:2px solid #e2e2e7;border-left:14px solid ${v.sev ? SEV_COLOR[b.severity] : '#e2e2e7'};border-radius:24px;padding:44px 52px;display:flex;flex-direction:column}
      .site{font-size:26px;font-weight:700;color:#6b6b75}.site b{color:#d6336c}
      .org{font-size:${orgSize(b.organization, 60)}px;font-weight:900;line-height:1.25;margin-top:22px}
      .svc{font-size:26px;color:#6b6b75;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .bottom{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
      .count{font-size:${v.count && v.count.length > 9 ? 84 : 100}px;font-weight:900;color:#d6336c;line-height:1;font-variant-numeric:tabular-nums}
      .count small{font-size:36px;margin-left:8px}
      .meta{font-size:24px;color:#6b6b75;margin-top:14px}
      .badge{font-size:24px;font-weight:700;padding:6px 18px;border-radius:999px;border:2px dashed #d6336c;color:#d6336c;white-space:nowrap}
      .sev{font-size:24px;font-weight:700;padding:6px 18px;border-radius:999px;background:${v.sev ? `${SEV_COLOR[b.severity]}22` : '#eee'};color:${v.sev ? SEV_COLOR[b.severity] : '#555'};white-space:nowrap}
    </style>
    <div class="stain" style="width:340px;height:340px;right:-90px;top:-120px"></div>
    <div class="stain" style="width:200px;height:200px;left:-70px;bottom:-80px"></div>
    <div class="card">
      <div class="site">Have I Been <b>Morasareta</b> 日本版</div>
      <div class="org">${esc(b.organization)}</div>
      ${v.svc ? `<div class="svc">${esc(v.svc)}</div>` : ''}
      <div class="bottom">
        <div><div class="count">${v.count ? `${esc(v.count)}<small>件</small>` : '件数調査中'}</div><div class="meta">${esc(v.meta)}</div></div>
        <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-end">${v.investigating ? '<span class="badge">調査中</span>' : ''}${v.sev ? `<span class="sev">重要度：${esc(v.sev.label)}</span>` : ''}</div>
      </div>
    </div>`;
  },

  // B: ダーク（やばたにえん風の8ビット。蛇口から水が漏れる）
  b(b) {
    const v = view(b);
    return `<style>${BASE}
      body{background:#111114;color:#ececf1;padding:56px 72px;font-family:"DotGothic16","Noto Sans JP",monospace;
        background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:24px 24px;position:relative}
      .site{font-size:28px;color:#9a9aa6}.site b{color:#ff6b9a;font-weight:400}
      .org{font-size:${orgSize(b.organization, 64)}px;line-height:1.25;margin-top:30px}
      .svc{font-size:28px;color:#9a9aa6;margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:900px}
      .count{position:absolute;left:72px;bottom:110px;font-size:${v.count && v.count.length > 9 ? 96 : 116}px;color:#ff6b9a;line-height:1}
      .count small{font-size:40px;margin-left:10px}
      .meta{position:absolute;left:72px;bottom:56px;font-size:28px;color:#9a9aa6}
      .badge{position:absolute;right:72px;bottom:56px;font-size:28px;padding:4px 16px;border:3px dashed #ff6b9a;color:#ff6b9a}
      .pipe{position:absolute;right:120px;top:0;width:24px;height:120px;background:#9a9aa6;box-shadow:inset -6px 0 #6b6b75}
      .tap{position:absolute;right:96px;top:120px;width:72px;height:24px;background:#9a9aa6;box-shadow:inset 0 -6px #6b6b75}
      .drop{position:absolute;right:120px;width:24px;height:24px;background:#ff6b9a}
      .pool{position:absolute;right:40px;bottom:0;width:240px;height:24px;background:#ff6b9a88}
    </style>
    <div class="pipe"></div><div class="tap"></div><div class="drop" style="top:168px"></div><div class="drop" style="top:240px;opacity:.7"></div><div class="drop" style="top:312px;opacity:.45"></div><div class="pool"></div>
    <div class="site">Have I Been <b>Morasareta</b> 日本版</div>
    <div class="org">${esc(b.organization)}</div>
    ${v.svc ? `<div class="svc">${esc(v.svc)}</div>` : ''}
    <div class="count">${v.count ? `${esc(v.count)}<small>件</small>` : '件数調査中'}</div>
    <div class="meta">${esc(v.meta)}</div>
    ${v.investigating ? '<div class="badge">調査中</div>' : ''}`;
  },

  // C: 速報風（上部に帯。件数を主役に）
  c(b) {
    const v = view(b);
    return `<style>${BASE}
      body{background:#fff;color:#1c1c1f;display:flex;flex-direction:column}
      .band{background:#d6336c;color:#fff;padding:22px 64px;display:flex;justify-content:space-between;align-items:center;font-size:30px;font-weight:900;letter-spacing:.08em}
      .band span{font-size:24px;font-weight:700;letter-spacing:0;opacity:.9}
      .main{flex:1;padding:44px 64px 40px;display:flex;flex-direction:column}
      .org{font-size:${orgSize(b.organization, 56)}px;font-weight:900;line-height:1.25}
      .svc{font-size:26px;color:#6b6b75;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .row{margin-top:auto;display:flex;align-items:baseline;gap:20px;flex-wrap:wrap}
      .count{font-size:${v.count && v.count.length > 9 ? 110 : 132}px;font-weight:900;line-height:1;color:#d6336c;font-variant-numeric:tabular-nums}
      .unit{font-size:40px;font-weight:900}
      .meta{font-size:26px;color:#6b6b75;margin-top:16px;display:flex;gap:16px;align-items:center}
      .chip{font-size:22px;font-weight:700;padding:4px 14px;border-radius:999px;background:${v.sev ? `${SEV_COLOR[b.severity]}22` : '#eee'};color:${v.sev ? SEV_COLOR[b.severity] : '#555'}}
    </style>
    <div class="band">情報漏洩${v.investigating ? '（調査中）' : ''}<span>Have I Been Morasareta 日本版</span></div>
    <div class="main">
      <div class="org">${esc(b.organization)}</div>
      ${v.svc ? `<div class="svc">${esc(v.svc)}</div>` : ''}
      <div class="row">${v.count ? `<span class="count">${esc(v.count)}</span><span class="unit">件</span>` : '<span class="count" style="font-size:96px">件数調査中</span>'}</div>
      <div class="meta">${esc(v.meta)}${v.sev ? `<span class="chip">重要度：${esc(v.sev.label)}</span>` : ''}</div>
    </div>`;
  },
};

const template = STYLES[STYLE];
if (!template) throw new Error(`--style は a / b / c のいずれかです（${STYLE}）`);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
// フォントの読み込みを1回で済ませるため、同じページで中身だけ差し替える
await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8">${FONT}</head><body></body></html>`, { waitUntil: 'networkidle' }).catch(() => {});
let n = 0;
for (const b of breaches) {
  await page.evaluate((html) => { document.body.outerHTML = `<body>${html}</body>`; }, template(b));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(PUBLIC, 'breach', b.id, 'og.png') });
  n++;
}
await browser.close();
console.log(`✔ OGP 画像を ${n} 件出力しました（スタイル ${STYLE}）`);
