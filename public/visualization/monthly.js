// 月ごとの情報漏洩の推移（公表件数 / 漏洩件数の合計）を折れ線で描く
import { showUpdated } from '../labels.js';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const nf = new Intl.NumberFormat('ja-JP');

const METRICS = {
  incidents: { label: '公表件数', unit: '件', value: (m) => m.items.length },
  affected: { label: '漏洩件数の合計', unit: '件', value: (m) => m.affected },
};

const { breaches, generated_at } = await fetch('../breaches.json').then((r) => r.json());
showUpdated(generated_at);

// ---- 月ごとに集計（データの無い月も 0 で埋める） ----
const monthKey = (d) => d.slice(0, 7);
const byMonth = new Map();
for (const b of breaches) {
  const key = monthKey(b.date_announced);
  if (!byMonth.has(key)) byMonth.set(key, []);
  byMonth.get(key).push(b);
}

function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const currentMonth = new Date().toISOString().slice(0, 7);
const firstMonth = [...byMonth.keys()].sort()[0] ?? currentMonth;

function buildMonths(range) {
  const start = range === 'all' ? firstMonth : addMonths(currentMonth, -11);
  const months = [];
  for (let k = start; k <= currentMonth; k = addMonths(k, 1)) {
    const items = (byMonth.get(k) ?? []).slice().sort((a, b) => (b.affected_count ?? -1) - (a.affected_count ?? -1));
    months.push({ key: k, items, affected: items.reduce((n, b) => n + (b.affected_count ?? 0), 0) });
  }
  return months;
}

// ---- 数値の表記 ----
function compact(n) {
  if (n >= 1e8) return `${trim(n / 1e8)}億`;
  if (n >= 1e4) return `${trim(n / 1e4)}万`;
  return nf.format(n);
}
const trim = (x) => (Math.round(x * 10) / 10).toString();
const monthLabel = (key) => `${key.slice(0, 4)}年${Number(key.slice(5))}月`;

function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks.at(-1) < max) ticks.push(ticks.at(-1) + step);
  return ticks;
}

// ---- 状態（URL と同期） ----
const params = new URLSearchParams(location.search);
const state = {
  metric: METRICS[params.get('metric')] ? params.get('metric') : 'incidents',
  range: params.get('range') === 'all' ? 'all' : '12',
};

function syncControls() {
  for (const btn of document.querySelectorAll('[data-metric]')) btn.setAttribute('aria-checked', String(btn.dataset.metric === state.metric));
  for (const btn of document.querySelectorAll('[data-range]')) btn.setAttribute('aria-checked', String(btn.dataset.range === state.range));
  // 地図など同じページの他のグラフのパラメータは残す
  const next = new URLSearchParams(location.search);
  if (state.metric !== 'incidents') next.set('metric', state.metric); else next.delete('metric');
  if (state.range !== '12') next.set('range', state.range); else next.delete('range');
  const qs = next.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

for (const btn of document.querySelectorAll('[data-metric]')) {
  btn.addEventListener('click', () => { state.metric = btn.dataset.metric; render(); });
}
for (const btn of document.querySelectorAll('[data-range]')) {
  btn.addEventListener('click', () => { state.range = btn.dataset.range; render(); });
}

// ---- 描画 ----
function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
}

function render() {
  syncControls();
  const metric = METRICS[state.metric];
  const months = buildMonths(state.range);
  const values = months.map(metric.value);
  const total = values.reduce((a, b) => a + b, 0);

  $('monthly-sub').textContent = `${monthLabel(months[0].key)}〜${monthLabel(months.at(-1).key)}・${metric.label}（計 ${nf.format(total)} ${metric.unit}）`;

  const chart = $('chart');
  chart.querySelector('svg')?.remove();
  const width = Math.max(chart.clientWidth, 300);
  const narrow = width < 560;
  const height = narrow ? 240 : 320;
  const m = { top: 12, right: 12, bottom: 28, left: narrow ? 44 : 56 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;

  const ticks = niceTicks(Math.max(...values));
  const yMax = ticks.at(-1);
  const x = (i) => m.left + (months.length === 1 ? iw / 2 : (i / (months.length - 1)) * iw);
  const y = (v) => m.top + ih - (v / yMax) * ih;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${metric.label}の月別推移` });
  chart.prepend(svg);

  // グリッドと Y 軸
  const grid = el('g', { class: 'grid' }, svg);
  const axis = el('g', { class: 'axis' }, svg);
  for (const t of ticks) {
    el('line', { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t) }, grid);
    const label = el('text', { x: m.left - 8, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, axis);
    label.textContent = compact(t);
  }

  // X 軸（月）。実際の文字幅を測り、隣と重なるラベルは出さない（最後の月は必ず出す）
  const last = months.length - 1;
  const gap = 12;
  const placed = [];
  const order = [last, ...months.keys()].filter((i, n) => n === 0 || i !== last);
  for (const i of order) {
    const mo = months[i];
    const mm = Number(mo.key.slice(5));
    // 12か月を超える期間では、どの年の月か分かるよう常に年を付ける
    const withYear = mm === 1 || i === 0 || months.length > 12;
    const anchor = i === 0 ? 'start' : i === last ? 'end' : 'middle';
    const label = el('text', { x: x(i), y: height - 8, 'text-anchor': anchor }, axis);
    label.textContent = withYear ? `${mo.key.slice(2, 4)}年${mm}月` : `${mm}月`;
    const w = label.getComputedTextLength();
    const left = anchor === 'start' ? x(i) : anchor === 'end' ? x(i) - w : x(i) - w / 2;
    const right = left + w;
    if (placed.some((p) => left < p.right + gap && right > p.left - gap)) label.remove();
    else placed.push({ left, right });
  }

  // 面と線
  const pts = values.map((v, i) => `${x(i)},${y(v)}`);
  el('path', { class: 'area', d: `M${x(0)},${y(0)} L${pts.join(' L')} L${x(values.length - 1)},${y(0)} Z` }, svg);
  el('path', { class: 'line', d: `M${pts.join(' L')}` }, svg);

  // ホバー用の縦線と点
  const crosshair = el('line', { class: 'crosshair', y1: m.top, y2: m.top + ih, opacity: 0 }, svg);
  // 月数が多いと点が重なるので小さくする
  const r = iw / months.length < 18 ? 2.5 : 4;
  const dots = values.map((v, i) => el('circle', { class: `dot${v === 0 ? ' zero' : ''}`, cx: x(i), cy: y(v), r }, svg));

  // 月ごとの当たり判定（点より広い帯）
  const band = months.length === 1 ? iw : iw / (months.length - 1);
  months.forEach((mo, i) => {
    const hit = el('rect', {
      class: 'hit', x: x(i) - band / 2, y: m.top, width: band, height: ih, tabindex: 0,
      'aria-label': `${monthLabel(mo.key)} ${metric.label} ${nf.format(values[i])}${metric.unit}`,
    }, svg);
    const show = () => {
      crosshair.setAttribute('x1', x(i));
      crosshair.setAttribute('x2', x(i));
      crosshair.setAttribute('opacity', 1);
      dots.forEach((d, j) => d.setAttribute('r', j === i ? r + 2 : r));
      dots[i].classList.remove('zero');
      showTooltip(mo, values[i], metric, x(i), y(values[i]), width);
    };
    const hide = () => {
      crosshair.setAttribute('opacity', 0);
      dots.forEach((d, j) => { d.setAttribute('r', r); d.classList.toggle('zero', values[j] === 0); });
      $('tooltip').hidden = true;
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
  });

  renderTable(months);
}

function showTooltip(mo, value, metric, px, py, width) {
  const tip = $('tooltip');
  tip.replaceChildren();
  const month = Object.assign(document.createElement('div'), { className: 'tt-month', textContent: monthLabel(mo.key) });
  const val = Object.assign(document.createElement('div'), { className: 'tt-value', textContent: `${nf.format(value)} ${metric.unit}` });
  tip.append(month, val);
  if (mo.items.length) {
    const ul = document.createElement('ul');
    for (const b of mo.items.slice(0, 5)) {
      const count = b.affected_count == null ? '件数不明' : `${compact(b.affected_count)}件`;
      ul.append(Object.assign(document.createElement('li'), { textContent: `${b.organization}（${count}）` }));
    }
    if (mo.items.length > 5) ul.append(Object.assign(document.createElement('li'), { textContent: `ほか ${mo.items.length - 5} 件` }));
    tip.append(ul);
  }
  tip.hidden = false;
  // グラフの右端ではツールチップを左側に出す
  const left = px + 12 + tip.offsetWidth > width ? px - 12 - tip.offsetWidth : px + 12;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, py - 24)}px`;
}

function renderTable(months) {
  $('table-body').replaceChildren(...months.slice().reverse().map((mo) => {
    const tr = document.createElement('tr');
    const cells = [
      [monthLabel(mo.key), ''],
      [nf.format(mo.items.length), 'num'],
      [nf.format(mo.affected), 'num'],
      [mo.items.map((b) => b.organization).join('、') || '—', ''],
    ];
    for (const [text, cls] of cells) tr.append(Object.assign(document.createElement('td'), { textContent: text, className: cls }));
    return tr;
  }));
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

render();
