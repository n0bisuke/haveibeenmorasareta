import { CAUSES, showUpdated } from './labels.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('ja-JP');
const fmtDate = (s) => s.replaceAll('-', '/');

const { breaches, generated_at, severity_levels: LEVELS, data_types: TYPES, vuln_targets: VULN = [], attack_methods: ATTACKS = [] } = await fetch('breaches.json').then((r) => r.json());
// データを追加した人（デプロイ時に生成。無ければアイコンを出さない）
const CONTRIBUTORS = await fetch('contributors.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
const VULN_LABEL = Object.fromEntries(VULN.map((t) => [t.id, t.label]));
const ATTACK_LABEL = Object.fromEntries(ATTACKS.map((t) => [t.id, t.label]));
const RANK = Object.fromEntries(LEVELS.map((l, i) => [l.id, i]));
const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

// 検索用テキストを事前に作っておく
for (const b of breaches) {
  b._text = [b.organization, b.group, b.root_cause, b.vendor?.name, b.vendor?.group, ...(b.services ?? []), ...(b.data_types ?? []), ...[b.industry ?? []].flat(), b.prefecture, b.summary, CAUSES[b.cause], VULN_LABEL[b.vuln_target],
    ...(b.attack_methods ?? []).map((m) => ATTACK_LABEL[m]),
    b.status === 'investigating' && '調査中'].filter(Boolean).join(' ').toLowerCase();
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
// 「調査中」の事案だけに絞る（統計の「調査中」から切り替え）
let onlyInvestigating = params.get('status') === 'investigating';

function renderStats() {
  const total = breaches.reduce((n, b) => n + (b.affected_count ?? 0), 0);
  const investigating = breaches.filter((b) => b.status === 'investigating').length;
  const stats = [['掲載件数', `${nf.format(breaches.length)} 件`], ['漏洩件数の合計', `${nf.format(total)}`]];
  if (investigating) stats.push(['調査中', `${nf.format(investigating)} 件`, true]);
  $('stats').replaceChildren(...stats.map(([k, v, toggle]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    if (toggle) {
      // クリックで調査中の事案だけを表示する
      const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'stat-toggle', textContent: v, title: '調査中の事案だけを表示' });
      btn.setAttribute('aria-pressed', String(onlyInvestigating));
      btn.addEventListener('click', () => {
        onlyInvestigating = !onlyInvestigating;
        btn.setAttribute('aria-pressed', String(onlyInvestigating));
        render();
      });
      dd.append(btn);
    } else {
      dd.textContent = v;
    }
    div.append(dt, dd);
    return div;
  }));
  $('generated').textContent = `最終更新: ${new Date(generated_at).toLocaleString('ja-JP')}`;
  showUpdated(generated_at);
}

function renderItem(b) {
  const el = $('item-tpl').content.firstElementChild.cloneNode(true);
  el.id = b.id;
  if (b.severity) el.classList.add(`sev-${b.severity}`);
  // 組織名とカードのクリックで、事案ごとの個別ページへ
  const href = `breach/${b.id}/`;
  el.querySelector('.org').append(Object.assign(document.createElement('a'), { href, textContent: b.organization }));
  el.classList.add('linked');
  el.addEventListener('click', (e) => {
    if (e.target.closest('a, button') || getSelection().toString()) return;
    if (e.metaKey || e.ctrlKey) open(href, '_blank');
    else location.href = href;
  });
  if (b.status === 'investigating') {
    el.classList.add('is-investigating');
    el.querySelector('.status-badge').hidden = false;
    const note = el.querySelector('.investigating');
    note.hidden = false;
    const link = note.querySelector('.investigating-link');
    if (b.issue) {
      link.href = b.issue;
      link.textContent = `Issue #${b.issue.split('/').pop()}`;
    } else {
      link.replaceWith('Issue');
    }
  } else {
    el.querySelector('.status-badge').remove();
    el.querySelector('.investigating').remove();
  }
  el.querySelector('.count').textContent = b.affected_count == null ? '件数不明' : `${nf.format(b.affected_count)} 件`;
  el.querySelector('.services').textContent = (b.services ?? []).join(' / ');
  const meta = [
    `公表 ${fmtDate(b.date_announced)}`,
    b.date_occurred && `発生 ${fmtDate(b.date_occurred)}`,
    b.disclosure_days != null && `公表まで ${nf.format(b.disclosure_days)}日`,
    VULN_LABEL[b.vuln_target] ? `${CAUSES[b.cause]}（${VULN_LABEL[b.vuln_target]}）` : CAUSES[b.cause],
    b.attack_methods && `手法 ${b.attack_methods.map((m) => ATTACK_LABEL[m] ?? m).join('・')}`,
    b.vendor && `委託先 ${b.vendor.name.replace(/株式会社/g, '')}`,
    ...[b.industry ?? []].flat(),
  ].filter(Boolean);
  el.querySelector('.meta').replaceChildren(...meta.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
  if (b.root_cause) el.querySelector('.root-cause-text').textContent = b.root_cause;
  else el.querySelector('.root-cause').remove();
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
  const c = CONTRIBUTORS[b.id];
  if (c) {
    const a = el.querySelector('.contributor');
    a.hidden = false;
    a.href = c.url ?? `https://github.com/${c.login}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = c.pr ? `@${c.login} さんが #${c.pr} で追加` : `@${c.login} さんが追加`;
    const img = a.querySelector('img');
    img.src = `${c.avatar_url}${c.avatar_url.includes('?') ? '&' : '?'}s=44`;
    img.alt = `@${c.login}`;
  } else {
    el.querySelector('.contributor').remove();
  }
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
      && (!onlyInvestigating || b.status === 'investigating')
      && words.every((w) => b._text.includes(w)))
    .sort(sort === 'count'
      ? (a, b) => (b.affected_count ?? -1) - (a.affected_count ?? -1)
      : sort === 'delay'
        ? (a, b) => (b.disclosure_days ?? -1) - (a.disclosure_days ?? -1)
        : (a, b) => b.date_announced.localeCompare(a.date_announced));

  $('result-count').textContent = `${onlyInvestigating ? '調査中の事案のみ・' : ''}${nf.format(items.length)} 件を表示`;
  $('list').replaceChildren(...(items.length
    ? items.map(renderItem)
    : [Object.assign(document.createElement('li'), { className: 'empty', textContent: '該当するデータがありません' })]));

  const next = new URLSearchParams();
  if (q) next.set('q', $('q').value.trim());
  if (year) next.set('year', year);
  if (cause) next.set('cause', cause);
  if (sev) next.set('sev', sev);
  if (sort !== 'date') next.set('sort', sort);
  if (onlyInvestigating) next.set('status', 'investigating');
  const qs = next.toString();
  history.replaceState(null, '', qs ? `?${qs}${location.hash}` : location.pathname + location.hash);
}

for (const id of ['q', 'year', 'cause', 'sev', 'sort']) $(id).addEventListener('input', render);
renderStats();
render();
