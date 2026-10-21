import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ROOT, FILENAME_RE, loadBreaches, loadAlerts } from './lib.mjs';
import { createChecker } from './check.mjs';

const errors = [];
const { checkEntry, dataTypes } = await createChecker();
for (const name of dataTypes.duplicates) {
  errors.push(`data-types.yml: 「${name}」が複数のレベルに登録されています`);
}
const seenUrls = new Map();
const entries = await loadBreaches();

for (const { file, data, error } of entries) {
  if (error) {
    errors.push(`${file}: YAML の構文エラー: ${error}`);
    continue;
  }
  const entryErrors = checkEntry(file, data);
  for (const e of entryErrors) errors.push(`${file}: ${e}`);
  if (entryErrors.length) continue;

  for (const { url } of data.sources) {
    // まとめサイトしか出典が無い事案（信頼度「低」・調査中）同士は同じ URL を共有してよい
    const prev = seenUrls.get(url);
    const investigating = data.status === 'investigating' || data.reliability === 'low';
    if (prev && prev.file !== file && !(investigating && prev.investigating)) {
      errors.push(`${file}: 出典URLが ${prev.file} と重複しています（同一インシデントの重複登録の可能性）`);
    }
    if (!prev) seenUrls.set(url, { file, investigating });
  }
}

// セキュリティ注意喚起（data/alerts/）の検証
const alertSchema = JSON.parse(await readFile(path.join(ROOT, 'schema', 'alert.schema.json'), 'utf8'));
const alertAjv = new Ajv({ allErrors: true });
addFormats(alertAjv);
const validateAlert = alertAjv.compile(alertSchema);
const alertSeenUrls = new Map();
const alerts = await loadAlerts();

for (const { file, data, error } of alerts) {
  if (error) {
    errors.push(`alerts/${file}: YAML の構文エラー: ${error}`);
    continue;
  }
  const m = file.match(FILENAME_RE);
  if (!m) {
    errors.push(`alerts/${file}: ファイル名は YYYY-MM-slug.yml 形式にしてください`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push(`alerts/${file}: YAML のトップレベルはオブジェクトである必要があります`);
    continue;
  }
  if (!validateAlert(data)) {
    for (const e of validateAlert.errors) errors.push(`alerts/${file}: ${e.instancePath || '(root)'} ${e.message}`);
    continue;
  }
  if (m && data.date.slice(0, 7) !== `${m[1]}-${m[2]}`) {
    errors.push(`alerts/${file}: ファイル名の年月 (${m[1]}-${m[2]}) と date (${data.date}) の年月を一致させてください`);
  }
  for (const { url } of data.sources) {
    const prev = alertSeenUrls.get(url);
    if (prev && prev !== file) {
      errors.push(`alerts/${file}: 出典URLが alerts/${prev} と重複しています`);
    }
    if (!prev) alertSeenUrls.set(url, file);
  }
}

if (errors.length) {
  console.error(`✖ ${errors.length} 件のエラー\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ 事案 ${entries.length} 件・注意喚起 ${alerts.length} 件のデータを検証しました`);
