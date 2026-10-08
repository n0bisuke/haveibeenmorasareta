import { loadBreaches } from './lib.mjs';
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

if (errors.length) {
  console.error(`✖ ${errors.length} 件のエラー\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ ${entries.length} 件のデータを検証しました`);
