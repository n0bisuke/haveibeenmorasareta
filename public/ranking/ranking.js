// 企業・グループ別、業界別、原因別のランキング
import { CAUSES } from '../labels.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('ja-JP');
const ORG_LIMIT = 10;

const { breaches } = await fetch('../breaches.json').then((r) => r.json());

// 「株式会社」などを除いた短い名前（グループ指定があればグループ名）
const shortName = (s) => s.replace(/株式会社|学校法人/g, '').trim();
const orgKey = (b) => b.group ?? shortName(b.organization);

const METRICS = {
  affected: { label: '漏洩件数の合計', value: (g) => g.affected, format: (g) => (g.affected || !g.unknown ? `${compact(g.affected)}件` : '件数不明') },
  incidents: { label: '事案数', value: (g) => g.items.length, format: (g) => `${g.items.length}件` },
};

const RANKINGS = [
  {
    id: 'org',
    key: orgKey,
    sub: (g) => (g.items[0].group ? [...new Set(g.items.map((b) => shortName(b.organization)))].join('・') : ''),
    href: (g) => `../?q=${encodeURIComponent(g.key)}`,
    limit: ORG_LIMIT,
  },
  {
    id: 'industry',
    key: (b) => b.industry,
    href: (g) => `../?q=${encodeURIComponent(g.key)}`,
  },
  {
    id: 'vendor',
    key: (b) => b.vendor && (b.vendor.group ?? shortName(b.vendor.name)),
    sub: (g) => (g.items[0].vendor.group ? [...new Set(g.items.map((b) => shortName(b.vendor.name)))].join('・') : ''),
    href: (g) => `../?q=${encodeURIComponent(g.key)}`,
  },
  {
    id: 'cause',
    key: (b) => b.cause,
    label: (k) => CAUSES[k] ?? k,
    href: (g) => `../?cause=${encodeURIComponent(g.key)}`,
  },
];

function compact(n) {
  if (n >= 1e8) return `${trim(n / 1e8)}億`;
  if (n >= 1e4) return `${trim(n / 1e4)}万`;
  return nf.format(n);
}
const trim = (x) => (Math.round(x * 10) / 10).toString();

// ---- 状態（URL と同期） ----
const params = new URLSearchParams(location.search);
const state = {
  metric: METRICS[params.get('metric')] ? params.get('metric') : 'affected',
  range: params.get('range') === 'all' ? 'all' : '12',
  expanded: false,
};

function inRange(b) {
  if (state.range === 'all') return true;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 11, 1);
  return b.date_announced >= d.toISOString().slice(0, 7);
}

function group(items, keyFn) {
  const map = new Map();
  for (const b of items) {
    const key = keyFn(b);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, items: [], affected: 0, unknown: 0 });
    const g = map.get(key);
    g.items.push(b);
    if (b.affected_count == null) g.unknown += 1;
    else g.affected += b.affected_count;
  }
  const metric = METRICS[state.metric];
  const other = METRICS[state.metric === 'affected' ? 'incidents' : 'affected'];
  return [...map.values()].sort((a, b) => metric.value(b) - metric.value(a) || other.value(b) - other.value(a) || a.key.localeCompare(b.key, 'ja'));
}

// ---- 描画 ----
function renderRanking(def, items) {
  const metric = METRICS[state.metric];
  let groups = group(items, def.key);
  const total = groups.length;
  if (def.limit && !state.expanded) groups = groups.slice(0, def.limit);
  const max = Math.max(1, ...groups.map(metric.value));

  const list = $(`rank-${def.id}`);
  list.replaceChildren(...groups.map((g, i) => {
    const li = document.createElement('li');
    const a = Object.assign(document.createElement('a'), { className: 'rank-row', href: def.href(g) });
    const no = Object.assign(document.createElement('span'), { className: 'rank-no', textContent: i + 1 });
    const label = Object.assign(document.createElement('span'), { className: 'rank-label', textContent: def.label ? def.label(g.key) : g.key });
    const sub = def.sub?.(g);
    if (sub) label.append(Object.assign(document.createElement('small'), { textContent: sub }));
    const barWrap = Object.assign(document.createElement('span'), { className: 'rank-bar' });
    const bar = Object.assign(document.createElement('span'), { className: 'bar' });
    bar.style.width = `calc((100% - 6.5em) * ${metric.value(g) / max})`;
    const val = Object.assign(document.createElement('span'), { className: 'val', textContent: metric.format(g) });
    barWrap.append(bar, val);
    a.append(no, label, barWrap);
    a.setAttribute('aria-label', `${i + 1}位 ${label.textContent} ${metric.label} ${metric.format(g)}`);
    a.addEventListener('pointerenter', () => showTooltip(a, g));
    a.addEventListener('focus', () => showTooltip(a, g));
    a.addEventListener('pointerleave', hideTooltip);
    a.addEventListener('blur', hideTooltip);
    li.append(a);
    return li;
  }));

  if (def.limit) {
    const more = $(`more-${def.id}`);
    more.hidden = total <= def.limit;
    more.textContent = state.expanded ? `上位${def.limit}件だけ表示` : `すべて表示（${total}件）`;
  }
}

function showTooltip(row, g) {
  const tip = $('tooltip');
  tip.replaceChildren();
  const head = Object.assign(document.createElement('div'), { className: 'tt-month', textContent: `事案 ${g.items.length}件` });
  const value = Object.assign(document.createElement('div'), {
    className: 'tt-value',
    textContent: `${nf.format(g.affected)}件${g.unknown ? `＋件数不明 ${g.unknown}件` : ''}`,
  });
  const ul = document.createElement('ul');
  const sorted = g.items.slice().sort((a, b) => (b.affected_count ?? -1) - (a.affected_count ?? -1));
  for (const b of sorted.slice(0, 5)) {
    const count = b.affected_count == null ? '件数不明' : `${compact(b.affected_count)}件`;
    ul.append(Object.assign(document.createElement('li'), { textContent: `${shortName(b.organization)}（${count}・${b.date_announced.slice(0, 7).replace('-', '/')}）` }));
  }
  if (sorted.length > 5) ul.append(Object.assign(document.createElement('li'), { textContent: `ほか ${sorted.length - 5} 件` }));
  tip.append(head, value, ul);
  tip.hidden = false;

  const main = document.querySelector('main').getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const left = Math.min(r.left - main.left + r.width * 0.45, main.width - tip.offsetWidth);
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${r.bottom - main.top + 4}px`;
}

function hideTooltip() {
  $('tooltip').hidden = true;
}

function render() {
  for (const btn of document.querySelectorAll('[data-metric]')) btn.setAttribute('aria-checked', String(btn.dataset.metric === state.metric));
  for (const btn of document.querySelectorAll('[data-range]')) btn.setAttribute('aria-checked', String(btn.dataset.range === state.range));
  const next = new URLSearchParams();
  if (state.metric !== 'affected') next.set('metric', state.metric);
  if (state.range !== '12') next.set('range', state.range);
  const qs = next.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);

  const items = breaches.filter(inRange);
  const total = items.reduce((n, b) => n + (b.affected_count ?? 0), 0);
  $('scope').textContent = `対象 ${items.length}件の事案・漏洩件数 計${compact(total)}件`;
  hideTooltip();
  for (const def of RANKINGS) renderRanking(def, items);
}

for (const btn of document.querySelectorAll('[data-metric]')) btn.addEventListener('click', () => { state.metric = btn.dataset.metric; render(); });
for (const btn of document.querySelectorAll('[data-range]')) btn.addEventListener('click', () => { state.range = btn.dataset.range; render(); });
$('more-org').addEventListener('click', () => { state.expanded = !state.expanded; render(); });

render();
