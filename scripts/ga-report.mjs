// Google アナリティクス（GA4）の前日のアクセスを集計し、月ごとの Issue（ラベル「GAレポート」）にコメントで追記する
//   GA_CREDENTIALS  … サービスアカウントの鍵（JSON の中身をそのまま。GitHub の Secrets に登録）
//   GA_PROPERTY_ID  … GA4 のプロパティ ID（数字のみ。測定 ID の G-XXXX とは別）
//   GITHUB_TOKEN / GITHUB_REPOSITORY が無ければ、レポートを標準出力に出すだけ
import { createSign } from 'node:crypto';

const { GA_CREDENTIALS, GA_PROPERTY_ID, GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
const LABEL = 'GAレポート';
const TOKEN_URL = process.env.GA_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';
const API_BASE = process.env.GA_API_BASE ?? 'https://analyticsdata.googleapis.com/v1beta';

if (!GA_CREDENTIALS || !GA_PROPERTY_ID) {
  console.log('GA_CREDENTIALS / GA_PROPERTY_ID が未設定のため、GA レポートは作りません');
  process.exit(0);
}

// サービスアカウントの鍵で署名した JWT をアクセストークンに交換する
async function accessToken() {
  const key = JSON.parse(GA_CREDENTIALS);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`アクセストークンの取得に失敗しました（${res.status}）: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

const token = await accessToken();
async function report(body) {
  const res = await fetch(`${API_BASE}/properties/${GA_PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GA Data API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).rows ?? [];
}

// 日付はプロパティのタイムゾーン基準（"yesterday" など）
const YESTERDAY = { startDate: 'yesterday', endDate: 'yesterday' };
const LAST_WEEK = { startDate: '8daysAgo', endDate: '8daysAgo' };
const LAST_7 = { startDate: '7daysAgo', endDate: 'yesterday' };
const METRICS = [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'sessions' }];

const [summary, week, pages, channels, sources] = await Promise.all([
  report({ dateRanges: [YESTERDAY, LAST_WEEK], metrics: METRICS }),
  report({ dateRanges: [LAST_7], metrics: METRICS }),
  report({ dateRanges: [YESTERDAY], dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 10 }),
  report({ dateRanges: [YESTERDAY], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 }),
  report({ dateRanges: [YESTERDAY], dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }),
]);

const nf = new Intl.NumberFormat('ja-JP');
const num = (row, i) => Number(row?.metricValues?.[i]?.value ?? 0);
// 2つの期間を指定すると、行の末尾の dateRange で期間が区別される
const byRange = (rows, idx) => rows.find((r) => (r.dimensionValues?.at(-1)?.value ?? 'date_range_0') === `date_range_${idx}`) ?? rows[idx];
const today = byRange(summary, 0);
const prev = byRange(summary, 1);
const diff = (a, b) => {
  if (!b) return '';
  const pct = Math.round(((a - b) / b) * 100);
  return `（先週同曜日比 ${pct >= 0 ? '+' : ''}${pct}%）`;
};
// Issue に載せる文字列のうち、外部由来（ページタイトル・参照元）を無害化する
const esc = (s) => String(s ?? '').replace(/[\r\n|]/g, ' ').replace(/[\\`*_[\]<>]/g, '\\$&').replace(/@/g, '@\u200b').slice(0, 80);

const date = new Date(Date.now() - 86400000).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const labels = ['訪問者数', '閲覧数（PV）', 'セッション数'];
const lines = [
  `## ${date} のアクセス`,
  '',
  '| | 前日 | 直近7日間 |',
  '|---|---:|---:|',
  ...labels.map((l, i) => `| ${l} | ${nf.format(num(today, i))}${diff(num(today, i), num(prev, i))} | ${nf.format(num(week[0], i))} |`),
  '',
  '### よく見られたページ',
  '',
  '| ページ | PV |',
  '|---|---:|',
  ...(pages.length ? pages.map((r) => `| ${esc(r.dimensionValues[1].value)}<br><sub>${esc(r.dimensionValues[0].value)}</sub> | ${nf.format(num(r, 0))} |`) : ['| （データなし） | |']),
  '',
  '### 流入元',
  '',
  '| チャネル | セッション |',
  '|---|---:|',
  ...(channels.length ? channels.map((r) => `| ${esc(r.dimensionValues[0].value)} | ${nf.format(num(r, 0))} |`) : ['| （データなし） | |']),
  '',
  `<details><summary>参照元の内訳</summary>\n\n| 参照元 | セッション |\n|---|---:|\n${sources.map((r) => `| ${esc(r.dimensionValues[0].value)} | ${nf.format(num(r, 0))} |`).join('\n')}\n\n</details>`,
  '',
  '<sub>`GA report` ワークフロー（`scripts/ga-report.mjs`）が自動で投稿しました。</sub>',
];
const text = lines.join('\n');

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.log(text);
  process.exit(0);
}

async function api(p, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${p}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// 1か月ごとに1件の Issue にまとめ、毎日コメントで追記する（前の月の Issue は閉じる）
const ym = new Date(Date.now() - 86400000).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long' });
const title = `【GAレポート】${ym}のアクセス`;
const open = await api(`/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100`);
let issue = open.find((i) => i.title === title);
for (const old of open.filter((i) => i.title !== title)) {
  await api(`/issues/${old.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
}
if (!issue) {
  issue = await api('/issues', {
    method: 'POST',
    body: JSON.stringify({
      title,
      labels: [LABEL],
      body: `${ym}の Google アナリティクスのアクセスを、毎日コメントで追記します。\n\n<sub>自動で作成された Issue です。月が変わると閉じて、次の月の Issue を作ります。</sub>`,
    }),
  });
}
await api(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) });
console.log(`✔ Issue #${issue.number} にレポートを追記しました`);
