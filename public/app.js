import { CAUSES } from './labels.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('ja-JP');
const fmtDate = (s) => s.replaceAll('-', '/');

const { breaches, generated_at, severity_levels: LEVELS, data_types: TYPES } = await fetch('breaches.json').then((r) => r.json());
const RANK = Object.fromEntries(LEVELS.map((l, i) => [l.id, i]));
const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

// 検索用テキストを事前に作っておく
for (const b of breaches) {
  b._text = [b.organization, b.group, ...(b.services ?? []), ...(b.data_types ?? []), b.industry, b.summary, CAUSES[b.cause]]
    .filter(Boolean).join(' ').toLowerCase();
}

function fillSelect(select, values, label = (v) => v) {
  for (const v of values) select.append(new Option(label(v), v));
}
fillSelect($('year'), [...new Set(breaches.map((b) => b.date_announced.slice(0, 4)))].sort().reverse(), (y) => `${y}年`);
fillSelect($('cause'), Object.keys(CAUSES).filter((c) => breaches.some((b) => b.cause === c)), (c) => CAUSES[c]);
// 「高以上」のように、選んだレベル以上の情報が漏れた事案に絞る
fillSelect($('sev'), LEVELS.map((l) => l.id), (id) => (RANK[id] === 0 ? `重要度：${LEVEL[id].label}` : `重要度：${LEVEL[id].label}以上`));

$('legend').replaceChildren(...LEVELS.map((l) => {
  const li = document.createElement('li');
  const chip = Object.assign(document.createElement('span'), { className: `chip t-${l.id}`, textContent: l.label });
  li.append(chip, l.description);
  return li;
}));

// URL のクエリと状態を同期（共有用）
const params = new URLSearchParams(location.search);
for (const key of ['q', 'year', 'cause', 'sev', 'sort']) if (params.has(key)) $(key).value = params.get(key);

function renderStats() {
  const total = breaches.reduce((n, b) => n + (b.affected_count ?? 0), 0);
  const stats = [['掲載件数', `${nf.format(breaches.length)} 件`], ['漏洩件数の合計', `${nf.format(total)}`]];
  $('stats').replaceChildren(...stats.map(([k, v]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    div.append(dt, dd);
    return div;
  }));
  $('generated').textContent = `最終更新: ${new Date(generated_at).toLocaleString('ja-JP')}`;
}

function renderItem(b) {
  const el = $('item-tpl').content.firstElementChild.cloneNode(true);
  el.id = b.id;
  if (b.severity) el.classList.add(`sev-${b.severity}`);
  el.querySelector('.org').textContent = b.organization;
  el.querySelector('.count').textContent = b.affected_count == null ? '件数不明' : `${nf.format(b.affected_count)} 件`;
  el.querySelector('.services').textContent = (b.services ?? []).join(' / ');
  const meta = [
    `公表 ${fmtDate(b.date_announced)}`,
    b.date_occurred && `発生 ${fmtDate(b.date_occurred)}`,
    CAUSES[b.cause],
    b.industry,
  ].filter(Boolean);
  el.querySelector('.meta').replaceChildren(...meta.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
  el.querySelector('.summary').textContent = b.summary;
  // 重要度の高い順に並べ、レベルごとに色分けする
  const tags = (b.data_types ?? []).map((t, i) => ({ t, i, level: TYPES[t] }))
    .sort((x, y) => (RANK[x.level] ?? 99) - (RANK[y.level] ?? 99) || x.i - y.i);
  el.querySelector('.tags').replaceChildren(...tags.map(({ t, level }) => Object.assign(document.createElement('li'), {
    textContent: t,
    className: level ? `t-${level}` : '',
    title: level ? `重要度：${LEVEL[level].label}` : '',
  })));
  el.querySelector('.count-note').textContent = b.count_note ?? '';
  el.querySelector('.sources').replaceChildren(...b.sources.map((s) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url;
    a.rel = 'noopener noreferrer';
    a.target = '_blank';
    a.textContent = s.title || s.url;
    li.append(a);
    return li;
  }));
  return el;
}

function render() {
  const q = $('q').value.trim().toLowerCase();
  const year = $('year').value;
  const cause = $('cause').value;
  const sev = $('sev').value;
  const sort = $('sort').value;

  const words = q.split(/\s+/).filter(Boolean);
  const items = breaches
    .filter((b) => (!year || b.date_announced.startsWith(year))
      && (!cause || b.cause === cause)
      && (!sev || (b.severity && RANK[b.severity] <= RANK[sev]))
      && words.every((w) => b._text.includes(w)))
    .sort(sort === 'count'
      ? (a, b) => (b.affected_count ?? -1) - (a.affected_count ?? -1)
      : (a, b) => b.date_announced.localeCompare(a.date_announced));

  $('result-count').textContent = `${nf.format(items.length)} 件を表示`;
  $('list').replaceChildren(...(items.length
    ? items.map(renderItem)
    : [Object.assign(document.createElement('li'), { className: 'empty', textContent: '該当するデータがありません' })]));

  const next = new URLSearchParams();
  if (q) next.set('q', $('q').value.trim());
  if (year) next.set('year', year);
  if (cause) next.set('cause', cause);
  if (sev) next.set('sev', sev);
  if (sort !== 'date') next.set('sort', sort);
  const qs = next.toString();
  history.replaceState(null, '', qs ? `?${qs}${location.hash}` : location.pathname + location.hash);
}

for (const id of ['q', 'year', 'cause', 'sev', 'sort']) $(id).addEventListener('input', render);
renderStats();
render();
