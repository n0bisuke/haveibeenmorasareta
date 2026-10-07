import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ROOT, FILENAME_RE, loadBreaches, loadDataTypes, loadIndustries } from './lib.mjs';

const schema = JSON.parse(await readFile(path.join(ROOT, 'schema', 'breach.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const today = new Date().toISOString().slice(0, 10);
const errors = [];
const dataTypes = await loadDataTypes();
const industries = new Set(await loadIndustries());
for (const name of dataTypes.duplicates) {
  errors.push(`data-types.yml: 「${name}」が複数のレベルに登録されています`);
}
const seenUrls = new Map();
const entries = await loadBreaches();

for (const { file, data, error } of entries) {
  const fail = (msg) => errors.push(`${file}: ${msg}`);

  const m = file.match(FILENAME_RE);
  if (!m) fail('ファイル名は YYYY-MM-slug.yml 形式（slug は半角英小文字・数字・ハイフン）にしてください');

  if (error) {
    fail(`YAML の構文エラー: ${error}`);
    continue;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail('YAML のトップレベルはオブジェクトである必要があります');
    continue;
  }

  if (!validate(data)) {
    for (const e of validate.errors) fail(`${e.instancePath || '(root)'} ${e.message}`);
    continue;
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
  if (data.industry && !industries.has(data.industry)) {
    fail(`industry の「${data.industry}」は data/industries.yml に登録されていません（既存の業種に合わせるか、一覧に追加してください）`);
  }
  for (const name of data.data_types ?? []) {
    if (!dataTypes.types[name]) {
      fail(`data_types の「${name}」は data/data-types.yml に登録されていません（表記を合わせるか、対応表に追加してください）`);
    }
  }
  for (const { url } of data.sources) {
    if (seenUrls.has(url) && seenUrls.get(url) !== file) {
      fail(`出典URLが ${seenUrls.get(url)} と重複しています（同一インシデントの重複登録の可能性）`);
    }
    seenUrls.set(url, file);
  }
}

if (errors.length) {
  console.error(`✖ ${errors.length} 件のエラー\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ ${entries.length} 件のデータを検証しました`);
