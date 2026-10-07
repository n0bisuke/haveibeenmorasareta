// 都道府県別の地図（タイルグリッド）。民間企業以外（自治体・大学・病院など）と地域の金融機関の事案を所在地で集計する
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('ja-JP');

const { breaches, org_types: ORG_TYPES = [], prefectures: PREFS = [] } = await fetch('../breaches.json').then((r) => r.json());
const ORG_LABEL = Object.fromEntries(ORG_TYPES.map((t) => [t.id, t.label]));
const items = breaches.filter((b) => b.org_type && b.prefecture);

// 色の段階（件数）。0件は塗らない
const BINS = [
  { min: 1, max: 1, label: '1件' },
  { min: 2, max: 3, label: '2〜3件' },
  { min: 4, max: 6, label: '4〜6件' },
  { min: 7, max: Infinity, label: '7件以上' },
];
const binOf = (n) => BINS.findIndex((b) => n >= b.min && n <= b.max);
const shortPref = (name) => (name === '北海道' ? name : name.replace(/[都府県]$/, ''));
const shortName = (s) => s.replace(/株式会社|学校法人|国立大学法人|国立研究開発法人|独立行政法人|地方独立行政法人|公益財団法人|一般財団法人|社会福祉法人|特定非営利活動法人/g, '').trim();

const params = new URLSearchParams(location.search);
const state = {
  type: ORG_LABEL[params.get('org')] ? params.get('org') : 'all',
  range: params.get('map_range') === '12' ? '12' : 'all',
};

// 組織の種類の選択肢（データにある種類のみ）
const select = $('map-type');
for (const t of ORG_TYPES.filter((t) => items.some((b) => b.org_type === t.id))) {
  select.append(new Option(t.label, t.id));
}
select.value = state.type;

function inRange(b) {
  if (state.range === 'all') return true;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 11, 1);
  return b.date_announced >= d.toISOString().slice(0, 7);
}

function aggregate() {
  const map = new Map(PREFS.map((p) => [p.name, []]));
  for (const b of items) {
    if (state.type !== 'all' && b.org_type !== state.type) continue;
    if (!inRange(b)) continue;
    map.get(b.prefecture)?.push(b);
  }
  for (const list of map.values()) list.sort((a, b) => b.date_announced.localeCompare(a.date_announced));
  return map;
}

function render() {
  const next = new URLSearchParams(location.search);
  if (state.type === 'all') next.delete('org'); else next.set('org', state.type);
  if (state.range === 'all') next.delete('map_range'); else next.set('map_range', state.range);
  const qs = next.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  for (const btn of document.querySelectorAll('[data-map-range]')) btn.setAttribute('aria-checked', String(btn.dataset.mapRange === state.range));

  const byPref = aggregate();
  const total = [...byPref.values()].reduce((n, l) => n + l.length, 0);
  const prefCount = [...byPref.values()].filter((l) => l.length).length;
  const scope = state.type === 'all' ? '自治体・国の機関・大学・病院・団体・地域の金融機関' : ORG_LABEL[state.type];
  $('map-sub').textContent = `${scope} ${total}件（${prefCount}都道府県）`;

  const grid = $('map-grid');
  grid.replaceChildren(...PREFS.map((p) => {
    const list = byPref.get(p.name);
    const bin = binOf(list.length);
    const tile = Object.assign(document.createElement(list.length ? 'a' : 'span'), { className: `tile${bin >= 0 ? ` b${bin + 1}` : ''}` });
    tile.style.gridColumn = p.x + 1;
    tile.style.gridRow = p.y + 1;
    tile.append(Object.assign(document.createElement('span'), { className: 'tile-name', textContent: shortPref(p.name) }));
    if (list.length) {
      tile.href = `../?q=${encodeURIComponent(p.name)}`;
      tile.append(Object.assign(document.createElement('span'), { className: 'tile-count', textContent: list.length }));
      tile.setAttribute('aria-label', `${p.name} ${list.length}件`);
      tile.addEventListener('pointerenter', () => showTooltip(tile, p.name, list));
      tile.addEventListener('focus', () => showTooltip(tile, p.name, list));
      tile.addEventListener('pointerleave', hideTooltip);
      tile.addEventListener('blur', hideTooltip);
    } else {
      tile.title = `${p.name} 0件`;
    }
    return tile;
  }));

  $('map-legend').replaceChildren(...[{ label: '0件', cls: '' }, ...BINS.map((b, i) => ({ label: b.label, cls: ` b${i + 1}` }))].map(({ label, cls }) => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('span'), { className: `swatch${cls}` }), label);
    return li;
  }));

  const rows = PREFS.map((p) => ({ name: p.name, list: byPref.get(p.name) })).filter((r) => r.list.length)
    .sort((a, b) => b.list.length - a.list.length);
  $('map-table').replaceChildren(...rows.map(({ name, list }) => {
    const tr = document.createElement('tr');
    tr.append(
      Object.assign(document.createElement('td'), { textContent: name }),
      Object.assign(document.createElement('td'), { className: 'num', textContent: `${list.length}件` }),
      Object.assign(document.createElement('td'), { textContent: list.map((b) => `${shortName(b.organization)}（${ORG_LABEL[b.org_type]}・${b.date_announced.slice(0, 7).replace('-', '/')}）`).join('、') }),
    );
    return tr;
  }));
  hideTooltip();
}

function showTooltip(tile, name, list) {
  const tip = $('map-tooltip');
  tip.replaceChildren();
  const affected = list.reduce((n, b) => n + (b.affected_count ?? 0), 0);
  const unknown = list.filter((b) => b.affected_count == null).length;
  tip.append(
    Object.assign(document.createElement('div'), { className: 'tt-month', textContent: name }),
    Object.assign(document.createElement('div'), { className: 'tt-value', textContent: `事案 ${list.length}件` }),
    Object.assign(document.createElement('div'), { className: 'tt-month', textContent: `漏洩件数 ${nf.format(affected)}件${unknown ? `＋件数不明 ${unknown}件` : ''}` }),
  );
  const ul = document.createElement('ul');
  for (const b of list.slice(0, 5)) {
    ul.append(Object.assign(document.createElement('li'), { textContent: `${shortName(b.organization)}（${b.date_announced.slice(0, 7).replace('-', '/')}）` }));
  }
  if (list.length > 5) ul.append(Object.assign(document.createElement('li'), { textContent: `ほか ${list.length - 5} 件` }));
  tip.append(ul);
  tip.hidden = false;
  const box = $('map').getBoundingClientRect();
  const r = tile.getBoundingClientRect();
  const left = Math.min(r.left - box.left + r.width / 2, box.width - tip.offsetWidth);
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${r.bottom - box.top + 4}px`;
}

function hideTooltip() {
  $('map-tooltip').hidden = true;
}

select.addEventListener('change', () => { state.type = select.value; render(); });
for (const btn of document.querySelectorAll('[data-map-range]')) btn.addEventListener('click', () => { state.range = btn.dataset.mapRange; render(); });
render();
