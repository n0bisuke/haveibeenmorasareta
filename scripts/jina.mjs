// Jina（https://jina.ai/reader）の検索 API（s.jina.ai）と本文取得 API（r.jina.ai）
//   JINA_API_KEY … API キー（GitHub の Secrets に登録）。無ければ Jina は使わない
const { JINA_API_KEY } = process.env;
export const jinaReady = Boolean(JINA_API_KEY);

const headers = (extra = {}) => ({ Authorization: `Bearer ${JINA_API_KEY}`, Accept: 'application/json', ...extra });

// Web 検索。site を指定するとそのドメインだけを検索する（例: x.com）
// 戻り値: [{ title, url, description, date }]（date は検索結果に日付があるときだけ）
export async function jinaSearch(query, { site } = {}) {
  const q = site ? `site:${site} ${query}` : query;
  const res = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(q)}&gl=JP&hl=ja`, {
    // 本文は取らず、タイトル・説明・URL だけにする（速く、使う量も少ない）
    headers: headers({ 'X-Respond-With': 'no-content' }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Jina search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.data ?? [])
    .filter((r) => r?.url && r?.title)
    .map((r) => ({ title: String(r.title), url: String(r.url), description: String(r.description ?? ''), date: r.date ?? r.publishedTime ?? '' }));
}

// ページの本文をテキストで取得する（JavaScript で描画するページも読める）
export async function jinaRead(url) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: headers({ 'X-Return-Format': 'text' }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Jina reader ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { data } = await res.json();
  return { url: data?.url || url, title: String(data?.title ?? ''), published: String(data?.publishedTime ?? ''), text: String(data?.content ?? data?.text ?? '') };
}

// X（旧Twitter）の投稿 URL から投稿日時を求める（投稿 ID に時刻が含まれる）
export function xPostTime(url) {
  const id = String(url).match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d{15,})/)?.[1];
  return id ? Number((BigInt(id) >> 22n) + 1288834974657n) : NaN;
}
