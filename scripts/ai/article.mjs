// ニュース記事の取得と本文の抽出
import { jinaReady, jinaRead } from '../jina.mjs';
const UA = 'Mozilla/5.0 (compatible; haveibeenmorasareta-bot; +https://github.com/n0bisuke/haveibeenmorasareta)';
const MAX_TEXT = Number(process.env.ARTICLE_MAX_CHARS) || 8000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

// レスポンスを文字コードに合わせて文字列にする（Shift_JIS・EUC-JP のサイトもある）
async function readText(res) {
  const buf = new Uint8Array(await res.arrayBuffer());
  const fromHeader = res.headers.get('content-type')?.match(/charset=["']?([\w-]+)/i)?.[1];
  const head = new TextDecoder('latin1').decode(buf.slice(0, 4096));
  const fromMeta = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  const charset = (fromHeader || fromMeta || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

export async function fetchPage(url, init = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    ...init,
    headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.5', ...init.headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { url: res.url || url, html: await readText(res) };
}

// Google ニュースの RSS のリンク（news.google.com/rss/articles/...）を元記事の URL に変換する
export async function resolveGoogleNews(url) {
  const u = new URL(url);
  if (u.hostname !== 'news.google.com') return url;
  const id = u.pathname.split('/').pop();
  // 古い形式は ID（base64）の中に URL がそのまま入っている
  try {
    const raw = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    const m = raw.match(/https?:\/\/[\x21-\x7e]+/);
    if (m && !raw.startsWith('\x08\x13\x22\x02AU_yqL')) return m[0];
  } catch { /* 新しい形式として扱う */ }
  // 新しい形式は記事ページの署名を使って batchexecute API に問い合わせる
  const { html } = await fetchPage(`https://news.google.com/articles/${id}`);
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) throw new Error('Google ニュースの元記事 URL を取得できませんでした');
  const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `f.req=${encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]))}`,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  const m = text.match(/\\"garturlres\\",\\"(https?:[^"\\]+)/);
  if (!m) throw new Error('Google ニュースの元記事 URL を取得できませんでした');
  return m[1];
}

const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '').trim() : '';
};

// HTML から本文らしい部分のテキストを取り出す
export function extractArticle(html) {
  const title = meta(html, 'og:title') || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const published = meta(html, 'article:published_time') || meta(html, 'datePublished') || meta(html, 'pubdate') || meta(html, 'date');
  let body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|header|footer|aside|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
  const pick = (tag) => {
    const parts = body.match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi')) ?? [];
    return parts.sort((a, b) => b.length - a.length)[0];
  };
  const main = [pick('article'), pick('main')].find((p) => p && toText(p).length >= 200);
  if (main) body = main;
  return { title, published, text: toText(body).slice(0, MAX_TEXT) };
}

function toText(html) {
  return decodeEntities(html
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// 候補（RSS の項目）から元記事を取得して本文を返す
// 直接取得できない・本文が短いページ（JavaScript で描画するページなど）は、JINA_API_KEY があれば Jina Reader で読み直す
export async function loadArticle(candidate) {
  const url = await resolveGoogleNews(candidate.url);
  let direct;
  try {
    const page = await fetchPage(url);
    const article = extractArticle(page.html);
    if (article.text.length >= 150) return { url: page.url, ...article, title: article.title || candidate.title };
    direct = new Error('本文を取得できませんでした（有料記事・JavaScript 必須のページの可能性）');
  } catch (e) {
    direct = e;
  }
  if (!jinaReady) throw direct;
  const page = await jinaRead(url);
  const text = page.text.replace(/[ \t\u3000]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, MAX_TEXT);
  if (text.length < 150) throw new Error(`本文を取得できませんでした（直接: ${direct.message} / Jina でも本文なし）`);
  return { url: page.url, title: page.title || candidate.title, published: page.published, text };
}
