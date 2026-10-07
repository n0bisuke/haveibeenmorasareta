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

// data/data-types.yml を読み込み、レベル一覧（重要度の高い順）と「種類名 → レベルID」の対応を返す
export async function loadDataTypes() {
  const text = await readFile(path.join(ROOT, 'data', 'data-types.yml'), 'utf8');
  const raw = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  const levels = [];
  const types = {};
  const duplicates = [];
  for (const [id, { label, description, types: names = [] }] of Object.entries(raw)) {
    levels.push({ id, label, description });
    for (const name of names) {
      if (types[name]) duplicates.push(name);
      types[name] = id;
    }
  }
  return { levels, types, duplicates };
}

// data/vuln-targets.yml（脆弱性を悪用された箇所の分類）を読み込み、[{ id, label, description }] を返す
export async function loadVulnTargets() {
  const text = await readFile(path.join(ROOT, 'data', 'vuln-targets.yml'), 'utf8');
  const raw = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  return Object.entries(raw).map(([id, { label, description }]) => ({ id, label, description }));
}

// data/industries.yml（業種の一覧）を読み込む
export async function loadIndustries() {
  const text = await readFile(path.join(ROOT, 'data', 'industries.yml'), 'utf8');
  return yaml.load(text, { schema: yaml.CORE_SCHEMA });
}

// data/attack-methods.yml（攻撃手法の分類）を読み込み、[{ id, label, category, description }] を返す
export async function loadAttackMethods() {
  const text = await readFile(path.join(ROOT, 'data', 'attack-methods.yml'), 'utf8');
  const raw = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  return Object.entries(raw).map(([id, { label, category, description }]) => ({ id, label, category, description }));
}

// data/org-types.yml（組織の種類）を読み込み、[{ id, label }] を返す
export async function loadOrgTypes() {
  const text = await readFile(path.join(ROOT, 'data', 'org-types.yml'), 'utf8');
  const raw = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  return Object.entries(raw).map(([id, { label }]) => ({ id, label }));
}

// data/prefectures.yml（都道府県とマップ上の位置）を読み込み、[{ name, x, y }] を返す
export async function loadPrefectures() {
  const text = await readFile(path.join(ROOT, 'data', 'prefectures.yml'), 'utf8');
  return yaml.load(text, { schema: yaml.CORE_SCHEMA });
}
