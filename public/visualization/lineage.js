// 漏洩の系譜: 委託先（・経由した提携先）から広がった事案を、原因になった会社ごとの家系図にする
//   A: 家系図（上から下） / B: 系譜リスト（左から右）を切り替えられる
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('ja-JP');

const { breaches } = await fetch('../breaches.json').then((r) => r.json());

// 「株式会社」や括弧書き（「（東海信金ビジネスの再委託先）」など）を除いた会社名。同じ会社をまとめるキーにも使う
const norm = (s) => String(s ?? '')
  .replace(/[（(][^）)]*[）)]/g, '')
  .replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益財団法人|学校法人|国立大学法人|\s/g, '');
const compact = (n) => (n >= 1e8 ? `${Math.round(n / 1e7) / 10}億件` : n >= 1e4 ? `${Math.round(n / 1e3) / 10}万件` : `${nf.format(n)}件`);

// ---- 系譜を組み立てる ----
// 委託先（vendor.name）ごとに1つの家系。via があれば「委託先 → 経由した会社 → 事案」、無ければ「委託先 → 事案」
const byOrg = new Map(breaches.map((b) => [norm(b.organization), b]));
const families = new Map();
for (const b of breaches.filter((x) => x.vendor)) {
  const rootKey = norm(b.vendor.name);
  if (!families.has(rootKey)) {
    families.set(rootKey, { key: rootKey, name: rootKey, breach: byOrg.get(rootKey) ?? null, children: new Map(), size: 0 });
  }
  const fam = families.get(rootKey);
  fam.size += 1;
  // 経由した会社自身の事案（大和証券など）は、同じキーのノードに重なるので経由ノードを兼ねる
  let parent = fam;
  if (b.via) {
    const viaKey = norm(b.via);
    if (!fam.children.has(viaKey)) fam.children.set(viaKey, { key: viaKey, name: viaKey, breach: null, children: new Map() });
    parent = fam.children.get(viaKey);
  }
  const key = norm(b.organization);
  const node = parent.children.get(key) ?? { key, name: key, children: new Map() };
  node.breach = b;
  parent.children.set(key, node);
}
const sortNodes = (map) => [...map.values()].sort((a, b) => (b.children.size - a.children.size) || ((b.breach?.affected_count ?? -1) - (a.breach?.affected_count ?? -1)));
const all = [...families.values()].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, 'ja'));
// 同じ会社が複数の委託先から影響を受けている（親が複数ある）場合に、ほかの親を表示するための索引
const parentsOf = new Map();
const walk = (fam, map) => {
  for (const n of map.values()) {
    if (!parentsOf.has(n.key)) parentsOf.set(n.key, new Set());
    parentsOf.get(n.key).add(fam.name);
    walk(fam, n.children);
  }
};
for (const fam of all) walk(fam, fam.children);
const shared = (fam) => {
  const keys = [];
  const collect = (map) => { for (const n of map.values()) { keys.push(n.key); collect(n.children); } };
  collect(fam.children);
  return keys.some((k) => parentsOf.get(k).size > 1);
};
// 2社以上に広がった委託先と、ほかの系譜と同じ会社を含む委託先を系譜で表示する
const multi = all.filter((f) => f.size >= 2 || shared(f));
const single = all.filter((f) => !multi.includes(f));
const otherParents = (node, fam) => [...(parentsOf.get(node.key) ?? [])].filter((name) => name !== fam.name);

// ---- 描画の部品 ----
const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
function info(b) {
  if (!b) return '';
  if (b.leaked === false) return 'お漏らし無し';
  if (b.affected_count != null) return compact(b.affected_count);
  return b.status === 'investigating' ? '件数調査中' : '件数不明';
}
function label(node, kind, fam) {
  const b = node.breach;
  const box = b ? Object.assign(el('a', `lin-node ${kind}`), { href: `../breach/${b.id}/` }) : el('span', `lin-node ${kind}`);
  box.append(el('b', '', node.name));
  const t = info(b);
  if (t) box.append(el('small', b?.leaked === false ? 'lin-ok' : '', t));
  const others = kind === 'root' ? [] : otherParents(node, fam);
  if (others.length) box.append(el('small', 'lin-also', `${others.join('・')}からも`));
  if (b) box.title = `${b.organization}（${b.date_announced.replaceAll('-', '/')}公表）`;
  return box;
}

// A: 家系図（上から下）
function treeA(node, fam, kind = 'root') {
  const li = el('li');
  li.append(label(node, kind, fam));
  const kids = sortNodes(node.children);
  if (kids.length) {
    const ul = el('ul');
    ul.append(...kids.map((c) => treeA(c, fam, c.children.size ? 'mid' : 'leaf')));
    li.append(ul);
  }
  return li;
}
// B: 系譜リスト（左から右）
function treeB(node, fam, kind = 'root') {
  const frag = document.createDocumentFragment();
  const row = el('div', `lin-row ${kind}`);
  const b = node.breach;
  const name = b ? Object.assign(el('a', 'lin-name', node.name), { href: `../breach/${b.id}/` }) : el('span', 'lin-name', node.name);
  row.append(name);
  const others = kind === 'root' ? [] : otherParents(node, fam);
  if (others.length) row.append(el('span', 'lin-also', `${others.join('・')}からも`));
  const t = info(b);
  if (t) row.append(el('span', `lin-cnt${b?.leaked === false ? ' lin-ok' : ''}`, t));
  frag.append(row);
  const kids = sortNodes(node.children);
  if (kids.length) {
    const box = el('div', 'lin-kids');
    for (const c of kids) box.append(treeB(c, fam, c.children.size ? 'mid' : 'leaf'));
    frag.append(box);
  }
  return frag;
}

// ---- 表示の切り替え ----
const params = new URLSearchParams(location.search);
let view = params.get('lineage') === 'list' ? 'list' : 'tree';

function render() {
  for (const btn of document.querySelectorAll('[data-lineage]')) btn.setAttribute('aria-checked', String(btn.dataset.lineage === view));
  const out = $('lineage');
  out.className = `lineage lineage-${view}`;
  if (view === 'tree') {
    out.replaceChildren(...multi.map((f) => {
      const wrap = el('div', 'lin-family');
      const ul = el('ul', 'lin-tree');
      ul.append(treeA(f, f));
      wrap.append(ul);
      return wrap;
    }));
  } else {
    out.replaceChildren(...multi.map((f) => {
      const card = el('div', 'lin-card');
      card.append(el('span', 'lin-badge', `${f.size}社に影響`), treeB(f, f));
      return card;
    }));
  }
  // 幅が足りず横スクロールになる家系は、起点（中央）が見えるようにしておく
  if (view === 'tree') {
    for (const fam of out.children) fam.scrollLeft = (fam.scrollWidth - fam.clientWidth) / 2;
  }
  // 1社だけに影響した委託先は、まとめて小さく並べる
  $('lineage-single').replaceChildren(...single.map((f) => {
    const li = el('li');
    const [only] = [...f.children.values()].flatMap((n) => (n.breach ? [n] : [...n.children.values()]));
    li.append(el('span', 'lin-vendor', f.name), ' → ');
    if (only?.breach) li.append(Object.assign(el('a', '', only.name), { href: `../breach/${only.breach.id}/` }));
    return li;
  }));
  $('lineage-sub').textContent = `委託先・提携先から広がった事案 ${breaches.filter((b) => b.vendor).length}件（原因になった会社 ${all.length}社）。2社以上に広がったものを系譜で表示しています`;
}

for (const btn of document.querySelectorAll('[data-lineage]')) {
  btn.addEventListener('click', () => {
    view = btn.dataset.lineage;
    const next = new URLSearchParams(location.search);
    if (view === 'list') next.set('lineage', 'list'); else next.delete('lineage');
    const qs = next.toString();
    history.replaceState(null, '', `${qs ? `?${qs}` : location.pathname}${location.hash}`);
    render();
  });
}
render();
