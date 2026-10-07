// LLM の出力をプログラムで検査・整形する（LLM の判断に頼らない機械的なチェック）

// 照合用に表記ゆれ（全角半角・空白・桁区切り・括弧）をならす
export const normalize = (s) => String(s ?? '')
  .normalize('NFKC')
  .replace(/[\s,、，。.・「」『』（）()［］[\]【】"'“”‘’]/g, '');

// 引用が記事本文に実在するか
export function quoteFound(quote, text) {
  const q = normalize(quote);
  return q.length >= 4 && normalize(text).includes(q);
}

// 記事本文に紛れ込んだ「AI への指示」らしき文
const INJECTION = /(ignore|disregard|forget)\b.{0,30}\b(instruction|prompt|above|previous)|system\s*prompt|you are (an?|the) (ai|assistant|language model)|(以前|上記|これまで|前)の(指示|命令|プロンプト)|指示を無視|プロンプトを無視|システムプロンプト|あなたは.{0,10}(AI|ＡＩ|アシスタント|言語モデル)/i;
export const findInjection = (text) => text.match(INJECTION)?.[0] ?? null;

// 根拠の引用が必要な項目（引用が本文に見つからなければ削除する）
const EVIDENCE_FIELDS = ['organization', 'date_announced', 'date_occurred', 'affected_count', 'cause', 'root_cause', 'vuln_target', 'attack_methods', 'vendor', 'data_types'];
// LLM に書かせてよい項目（status・issue・sources・country はプログラムが決める）
const ALLOWED = ['organization', 'group', 'services', 'industry', 'org_type', 'prefecture', 'date_occurred', 'date_announced', 'affected_count', 'count_note', 'cause', 'root_cause', 'vuln_target', 'attack_methods', 'vendor', 'data_types', 'summary'];

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const plainText = (s, max) => typeof s === 'string'
  && s.trim().length > 0 && s.length <= max
  && !/[\n\r<>`]|https?:|www\.|\]\(|\{\{/.test(s);

export function slugify(slug, fallback) {
  const s = String(slug ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) ? s : fallback;
}

// writer / editor の出力した entry を、一覧・形式・根拠の引用で絞り込む
// 戻り値: { entry, dropped: [{ field, reason }], reject: 理由 or null }
export function sanitizeEntry(raw, { evidence = {}, text, catalogs, published, causes }) {
  const dropped = [];
  const drop = (field, reason) => dropped.push({ field, reason });
  const entry = {};
  for (const key of ALLOWED) {
    if (raw?.[key] !== undefined && raw[key] !== null && raw[key] !== '') entry[key] = raw[key];
  }
  for (const key of Object.keys(raw ?? {})) {
    if (!ALLOWED.includes(key)) drop(key, 'AI が書いてはいけない項目');
  }

  // 根拠の引用の照合
  for (const key of EVIDENCE_FIELDS) {
    if (entry[key] === undefined) continue;
    if (!quoteFound(evidence[key], text)) {
      drop(key, '根拠の引用が記事本文に見つからない');
      delete entry[key];
    }
  }

  // 形式・一覧のチェック
  const str = (key, max) => {
    if (entry[key] !== undefined && !plainText(entry[key], max)) { drop(key, '形式が不正'); delete entry[key]; }
  };
  str('organization', 100);
  str('group', 60);
  str('count_note', 100);
  str('root_cause', 80);
  if (entry.root_cause && entry.root_cause.length < 4) { drop('root_cause', '短すぎる'); delete entry.root_cause; }
  if (entry.services !== undefined) {
    const list = [entry.services].flat().filter((s) => plainText(s, 60));
    if (list.length) entry.services = [...new Set(list)]; else { drop('services', '形式が不正'); delete entry.services; }
  }
  if (entry.industry !== undefined) {
    const all = [entry.industry].flat();
    const list = [...new Set(all.filter((s) => catalogs.industries.includes(s)))];
    for (const s of all) if (!catalogs.industries.includes(s)) drop('industry', `一覧にない業種「${String(s).slice(0, 30)}」`);
    if (!list.length) delete entry.industry; else entry.industry = list.length === 1 ? list[0] : list;
  }
  if (entry.org_type !== undefined && !catalogs.orgTypes.some((t) => t.id === entry.org_type)) { drop('org_type', '一覧にない ID'); delete entry.org_type; }
  if (entry.prefecture !== undefined && !catalogs.prefectures.includes(entry.prefecture)) { drop('prefecture', '一覧にない都道府県'); delete entry.prefecture; }
  if (entry.org_type && !entry.prefecture) { drop('org_type', '都道府県が不明'); delete entry.org_type; }
  if (!entry.org_type && entry.prefecture) delete entry.prefecture;
  for (const key of ['date_occurred', 'date_announced']) {
    if (entry[key] !== undefined && !isDate(entry[key])) { drop(key, '日付の形式が不正'); delete entry[key]; }
  }
  if (entry.affected_count !== undefined && !(Number.isInteger(entry.affected_count) && entry.affected_count >= 0)) {
    drop('affected_count', '整数ではない'); delete entry.affected_count;
  }
  if (entry.cause !== undefined && !causes.includes(entry.cause)) { drop('cause', '一覧にない原因'); delete entry.cause; }
  if (entry.vuln_target !== undefined && !(entry.cause === 'vulnerability' && catalogs.vulnTargets.some((t) => t.id === entry.vuln_target))) {
    drop('vuln_target', '一覧にない ID か、cause が vulnerability ではない'); delete entry.vuln_target;
  }
  if (entry.attack_methods !== undefined) {
    const list = [...new Set([entry.attack_methods].flat().filter((id) => catalogs.attackMethods.some((t) => t.id === id)))];
    if (list.length) entry.attack_methods = list; else { drop('attack_methods', '一覧にない ID'); delete entry.attack_methods; }
  }
  if (entry.vendor !== undefined) {
    const name = typeof entry.vendor === 'string' ? entry.vendor : entry.vendor?.name;
    if (plainText(name, 100)) entry.vendor = { name }; else { drop('vendor', '形式が不正'); delete entry.vendor; }
  }
  if (entry.data_types !== undefined) {
    const all = [entry.data_types].flat();
    const list = [...new Set(all.filter((t) => catalogs.dataTypes.includes(t)))];
    for (const t of all) if (!catalogs.dataTypes.includes(t)) drop('data_types', `一覧にない種類「${String(t).slice(0, 30)}」`);
    if (list.length) entry.data_types = list; else delete entry.data_types;
  }
  if (entry.summary !== undefined && !(plainText(entry.summary, 600) && entry.summary.length >= 10)) {
    drop('summary', '形式が不正（改行・URL・HTML・記号の装飾、文字数）'); delete entry.summary;
  }

  // 必須項目の補完と判定
  if (!entry.cause) entry.cause = 'unknown';
  if (!('affected_count' in entry)) entry.affected_count = null;
  if (!entry.date_announced && isDate(published?.slice(0, 10))) {
    entry.date_announced = published.slice(0, 10);
    drop('date_announced', '根拠が無いため記事の公開日で代用');
  }
  if (entry.date_occurred && entry.date_announced && entry.date_occurred > entry.date_announced) {
    drop('date_occurred', '公表日より後'); delete entry.date_occurred;
  }
  const missing = ['organization', 'date_announced', 'summary'].filter((k) => !entry[k]);
  return { entry, dropped, reject: missing.length ? `必須項目を確定できない（${missing.join(', ')}）` : null };
}

// 自動マージしてよい出典ドメイン（公的機関・主要報道機関・セキュリティ専門メディア）
const TRUSTED_SUFFIXES = ['.go.jp', '.lg.jp'];
const TRUSTED_HOSTS = [
  'www3.nhk.or.jp', 'news.web.nhk', 'www.nikkei.com', 'www.asahi.com', 'mainichi.jp', 'www.yomiuri.co.jp', 'www.sankei.com',
  'www.jiji.com', 'nordot.app', 'www.tokyo-np.co.jp', 'www.itmedia.co.jp', 'xtech.nikkei.com', 'www.security-next.com',
  'scan.netsecurity.ne.jp', 'internet.watch.impress.co.jp', 'cloud.watch.impress.co.jp', 'piyolog.hatenadiary.jp',
];
export function isTrustedSource(url) {
  try {
    const host = new URL(url).hostname;
    return TRUSTED_HOSTS.includes(host) || TRUSTED_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}
