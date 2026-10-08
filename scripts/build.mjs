import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadBreaches, loadDataTypes, loadIndustries, loadVulnTargets, loadAttackMethods, loadOrgTypes, loadPrefectures } from './lib.mjs';

const PUBLIC = path.join(ROOT, 'public');

const { levels, types } = await loadDataTypes();
const industries = await loadIndustries();
const vulnTargets = await loadVulnTargets();
const attackMethods = await loadAttackMethods();
const orgTypes = await loadOrgTypes();
const prefectures = await loadPrefectures();
const rank = Object.fromEntries(levels.map((l, i) => [l.id, i]));
// 出典のタイトルに公式発表らしい語があれば、公式発表を確認済みとみなす
const OFFICIAL = /公式|発表|お知らせ|お詫び|プレスリリース|ニュースリリース|適時開示|報道資料/;

// 漏洩した情報のうち最も重要度の高いレベルを、その事案の重要度とする
const breaches = (await loadBreaches())
  .map(({ id, data }) => {
    const found = (data.data_types ?? []).map((t) => types[t]);
    const severity = found.length ? found.reduce((a, b) => (rank[a] <= rank[b] ? a : b)) : null;
    // 発生から公表までの日数（発生日が分かっている事案のみ）
    const disclosure_days = data.date_occurred
      ? Math.round((Date.parse(data.date_announced) - Date.parse(data.date_occurred)) / 86400000)
      : null;
    // 情報の信頼度: low は手動で指定。それ以外は公式発表が出典にあれば high、無ければ mid
    const official = data.sources.some((s) => OFFICIAL.test(s.title ?? ''));
    const reliability = data.reliability === 'low' ? 'low' : official ? 'high' : 'mid';
    return { id, ...data, severity, disclosure_days, reliability };
  })
  .sort((a, b) => b.date_announced.localeCompare(a.date_announced) || a.id.localeCompare(b.id));

// データ変更がない限り出力が変わらないよう、更新日時は data/ の最終コミット日時を使う
function lastDataUpdate() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'data/breaches'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (out) return new Date(out).toISOString();
  } catch {}
  return new Date().toISOString();
}

// public/ の静的ファイルはそのまま公開し、データだけを生成する
await writeFile(
  path.join(PUBLIC, 'breaches.json'),
  JSON.stringify({ generated_at: lastDataUpdate(), count: breaches.length, severity_levels: levels, data_types: types, industries, vuln_targets: vulnTargets, attack_methods: attackMethods, org_types: orgTypes, prefectures, breaches }, null, 2) + '\n',
);
console.log(`✔ public/breaches.json に ${breaches.length} 件を出力しました`);
