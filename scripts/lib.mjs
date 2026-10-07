import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data', 'breaches');
export const FILENAME_RE = /^(\d{4})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.ya?ml$/;

// CORE_SCHEMA を使い、日付を Date ではなく文字列のまま扱う
export async function loadBreaches() {
  const files = (await readdir(DATA_DIR)).filter((f) => /\.ya?ml$/.test(f)).sort();
  const entries = [];
  for (const file of files) {
    const text = await readFile(path.join(DATA_DIR, file), 'utf8');
    let data;
    let error;
    try {
      data = yaml.load(text, { schema: yaml.CORE_SCHEMA });
    } catch (e) {
      error = e.message;
    }
    entries.push({ file, id: file.replace(/\.ya?ml$/, ''), data, error });
  }
  return entries;
}
