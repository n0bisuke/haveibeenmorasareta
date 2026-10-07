// 事案データ1件分の検証。scripts/validate.mjs（全件の検証）と scripts/ai-publish.mjs（AI 下書きの検証）で共用する
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ROOT, FILENAME_RE, loadDataTypes, loadIndustries, loadVulnTargets, loadAttackMethods, loadOrgTypes, loadPrefectures } from './lib.mjs';

// 一覧（業種・攻撃手法など）を読み込み、checkEntry(file, data) => エラーメッセージの配列 を返す
export async function createChecker() {
  const schema = JSON.parse(await readFile(path.join(ROOT, 'schema', 'breach.schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const dataTypes = await loadDataTypes();
  const industries = new Set(await loadIndustries());
  const vulnTargets = new Set((await loadVulnTargets()).map((t) => t.id));
  const attackMethods = new Set((await loadAttackMethods()).map((t) => t.id));
  const orgTypes = new Set((await loadOrgTypes()).map((t) => t.id));
  const prefectures = new Set((await loadPrefectures()).map((p) => p.name));
  const today = new Date().toISOString().slice(0, 10);

  const checkEntry = (file, data) => {
    const errors = [];
    const fail = (msg) => errors.push(msg);

    const m = file.match(FILENAME_RE);
    if (!m) fail('ファイル名は YYYY-MM-slug.yml 形式（slug は半角英小文字・数字・ハイフン）にしてください');

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      fail('YAML のトップレベルはオブジェクトである必要があります');
      return errors;
    }
    if (!validate(data)) {
      for (const e of validate.errors) fail(`${e.instancePath || '(root)'} ${e.message}`);
      return errors;
    }

    if (m && data.date_announced.slice(0, 7) !== `${m[1]}-${m[2]}`) {
      fail(`ファイル名の年月 (${m[1]}-${m[2]}) と date_announced (${data.date_announced}) の年月を一致させてください`);
    }
    for (const key of ['date_occurred', 'date_announced']) {
      if (data[key] && data[key] > today) fail(`${key} が未来の日付です`);
    }
    if (data.date_occurred && data.date_occurred > data.date_announced) {
      fail('date_occurred が date_announced より後になっています');
    }
    for (const name of [data.industry ?? []].flat()) {
      if (!industries.has(name)) {
        fail(`industry の「${name}」は data/industries.yml に登録されていません（既存の業種に合わせるか、一覧に追加してください）`);
      }
    }
    if (data.status === 'investigating' && !data.issue) {
      fail('status: investigating の事案には、情報募集用の issue（GitHub Issue の URL）を指定してください');
    }
    if (data.vuln_target && !vulnTargets.has(data.vuln_target)) {
      fail(`vuln_target の「${data.vuln_target}」は data/vuln-targets.yml に登録されていません`);
    }
    for (const id of data.attack_methods ?? []) {
      if (!attackMethods.has(id)) fail(`attack_methods の「${id}」は data/attack-methods.yml に登録されていません`);
    }
    if (data.org_type && !orgTypes.has(data.org_type)) fail(`org_type の「${data.org_type}」は data/org-types.yml に登録されていません`);
    if (data.prefecture && !prefectures.has(data.prefecture)) fail(`prefecture の「${data.prefecture}」は data/prefectures.yml に登録されていません`);
    if (data.org_type && !data.prefecture) fail('org_type を指定した事案には prefecture（都道府県）も指定してください');
    for (const name of data.data_types ?? []) {
      if (!dataTypes.types[name]) {
        fail(`data_types の「${name}」は data/data-types.yml に登録されていません（表記を合わせるか、対応表に追加してください）`);
      }
    }
    return errors;
  };

  return { checkEntry, dataTypes };
}
