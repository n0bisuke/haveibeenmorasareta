// ニュース候補から、ライター役・編集者役の LLM で事案データの下書きを作る
// このスクリプトは読み取り権限だけのジョブで動かす。結果はファイルに書き出すだけで、リポジトリには書き込まない
//   node scripts/ai-draft.mjs --in candidates.json --out ai-out [--state ai-state/seen.json]
//   環境変数は scripts/ai/llm.mjs を参照。AI_MAX_ITEMS で1回に処理する候補の数を変更（既定 5）
//   候補に issue（Issue から寄せられた URL）があるものは、見出しによる絞り込みをせずに処理し、
//   既存の事案の続報と判断したときは、既存データの更新案（status: update）を作る
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadBreaches, loadIndustries, loadAttackMethods, loadVulnTargets, loadOrgTypes, loadPrefectures, loadDataTypes } from './lib.mjs';
import { llmConfig, chatJson } from './ai/llm.mjs';
import { loadArticle } from './ai/article.mjs';
import { writerSystem, writerUser, editorSystem, editorUser, updaterSystem, updaterUser, UPDATE_FIELDS, CAUSE_IDS } from './ai/prompts.mjs';
import { sanitizeEntry, sanitizeFields, findInjection, slugify, quoteFound } from './ai/guard.mjs';

const arg = (name, def) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : def);
const IN = arg('--in', 'candidates.json');
const OUT = arg('--out', 'ai-out');
const STATE = arg('--state', 'ai-state/seen.json');
const MAX_ITEMS = Number(process.env.AI_MAX_ITEMS) || 5;

await mkdir(OUT, { recursive: true });
if (!llmConfig.ready) {
  console.log('LLM の API キー（GROQ_API_KEY、または LLM_API_KEY と LLM_MODEL）が未設定のため、AI 下書きは作りません');
  await writeFile(path.join(OUT, 'drafts.json'), '[]\n');
  process.exit(0);
}

// 個別の事案らしい見出し（件数・不正アクセスなど）を優先し、政策・解説・セミナーなどの記事は AI に渡さない
const NOT_INCIDENT = /首相|大臣|金融相|政府|与党|自民党|戦略本部|委員会が|注意喚起|呼びかけ|ウェビナー|セミナー|まとめ|一覧|随時更新|専門家|教訓|とは|なぜ|方法|対処法|自衛策|備え|コラム|エキスパート|急増|世界で|相次ぐ|ラッシュ|解説|ランキング/;
const score = (c) => (/\d[\d,.]*\s*万?\s*(件|人|名|社)/.test(c.title) ? 3 : 0)
  + (/不正アクセス|漏えい|漏洩|流出|ランサムウェア|お詫び|誤送信|紛失/.test(c.title) ? 2 : 0);
const candidates = JSON.parse(await readFile(IN, 'utf8'))
  .filter((c) => c.issue || !NOT_INCIDENT.test(c.title))
  .map((c, i) => ({ ...c, _score: score(c), _i: i }))
  .sort((a, b) => b._score - a._score || a._i - b._i);
const seen = new Set(await readFile(STATE, 'utf8').then(JSON.parse).catch(() => []));

const catalogs = {
  industries: await loadIndustries(),
  attackMethods: await loadAttackMethods(),
  vulnTargets: await loadVulnTargets(),
  orgTypes: await loadOrgTypes(),
  prefectures: (await loadPrefectures()).map((p) => p.name),
  dataTypes: Object.keys((await loadDataTypes()).types),
};
const breaches = (await loadBreaches()).filter((b) => b.data);
const knownUrls = new Set(breaches.flatMap((b) => (b.data.sources ?? []).map((s) => s.url)));
const recentSince = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
const existing = breaches
  .filter((b) => b.data.date_announced >= recentSince)
  .map((b) => ({ id: b.id, organization: b.data.organization, date_announced: b.data.date_announced }));
// Issue に紐づく既存の事案は、公表日が古くても重複・続報の確認に使う
const related = new Set(candidates.flatMap((c) => c.related ?? []));
for (const b of breaches) {
  if (related.has(b.id) && !existing.some((e) => e.id === b.id)) existing.push({ id: b.id, organization: b.data.organization, date_announced: b.data.date_announced });
}
const byId = new Map(breaches.map((b) => [b.id, b.data]));

// 続報の記事から、既存の事案データの更新案を作る（記事本文に根拠のある項目だけ）
async function makeUpdate(article, id, catalogs) {
  const current = byId.get(id);
  const res = await chatJson({ model: llmConfig.editorModel, system: updaterSystem(catalogs), user: updaterUser({ article, entry: current }) });
  if (res.same_incident !== true) return { reject: `同じ事案ではないと判断（${String(res.reason ?? '').slice(0, 100)}）` };
  const raw = {};
  const evidence = {};
  for (const [field, c] of Object.entries(res.changes && typeof res.changes === 'object' ? res.changes : {})) {
    if (!UPDATE_FIELDS.includes(field) || c === null || typeof c !== 'object') continue;
    raw[field] = c.value;
    evidence[field] = c.evidence;
  }
  const { entry, dropped } = sanitizeFields(raw, { evidence, text: article.text, catalogs, causes: CAUSE_IDS });
  // 既存と同じ値は変更しない。情報の種類は追加だけ
  if (entry.data_types) {
    entry.data_types = entry.data_types.filter((t) => !(current.data_types ?? []).includes(t));
    if (!entry.data_types.length) delete entry.data_types;
  }
  for (const k of Object.keys(entry)) if (JSON.stringify(entry[k]) === JSON.stringify(current[k])) delete entry[k];
  if (entry.date_occurred && entry.date_occurred > current.date_announced) { dropped.push({ field: 'date_occurred', reason: '公表日より後' }); delete entry.date_occurred; }
  let addition = String(res.summary_addition ?? '').trim();
  if (addition) {
    const ok = addition.length <= 200 && !/[\n\r<>`]|https?:|www\.|\]\(/.test(addition) && quoteFound(res.summary_evidence, article.text)
      && `${current.summary}${addition}`.length <= 600;
    if (ok) evidence.summary = res.summary_evidence;
    else { dropped.push({ field: 'summary', reason: '追記の形式・根拠・文字数の検査に合わない' }); addition = ''; }
  }
  if (!Object.keys(entry).length && !addition) return { reject: '記事で新しく分かった項目がない（出典の追加だけになる）', dropped, sourceOnly: true };
  const used = Object.fromEntries(Object.entries(evidence).filter(([k, v]) => (k in entry || (k === 'summary' && addition)) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 300)]));
  return { update: { id, changes: entry, summary_addition: addition || undefined }, evidence: used, dropped };
}

const results = [];
let processed = 0;
for (const candidate of candidates) {
  if (processed >= MAX_ITEMS) break;
  if (seen.has(candidate.url)) continue;
  seen.add(candidate.url);
  processed++;
  const result = { candidate: { title: candidate.title, url: candidate.url }, status: 'error', notes: [] };
  results.push(result);
  try {
    const article = await loadArticle(candidate);
    seen.add(article.url);
    result.source = { title: article.title, url: article.url };
    if (knownUrls.has(article.url)) {
      result.status = 'skipped';
      result.notes.push('この記事はすでに出典として収録済み');
      continue;
    }
    const injection = findInjection(article.text);
    if (injection) result.injection = injection;

    // ライター
    const draft = await chatJson({ model: llmConfig.writerModel, system: writerSystem(catalogs), user: writerUser({ article, existing }) });
    result.writer = { is_breach: draft.is_breach, reason: String(draft.reason ?? '').slice(0, 200), duplicate_of: draft.duplicate_of ?? null };
    if (draft.is_breach !== true) {
      result.status = 'skipped';
      result.notes.push('ライター: 情報漏洩の事案ではないと判断');
      continue;
    }
    if (draft.duplicate_of && existing.some((e) => e.id === draft.duplicate_of)) {
      result.status = 'skipped';
      result.notes.push(`ライター: 既存の ${draft.duplicate_of} と同じ事案（続報）と判断`);
      // Issue から寄せられた記事は、続報として既存データの更新案を作る
      if (candidate.issue && byId.has(draft.duplicate_of)) {
        const u = await makeUpdate(article, draft.duplicate_of, catalogs);
        result.dropped = u.dropped ?? [];
        if (u.reject) {
          result.notes.push(`更新案: ${u.reject}`);
          if (u.sourceOnly) Object.assign(result, { status: 'update', update: { id: draft.duplicate_of, changes: {} }, evidence: {} });
        } else {
          Object.assign(result, { status: 'update', update: u.update, evidence: u.evidence });
        }
      }
      continue;
    }
    const ctx = { text: article.text, catalogs, published: article.published, causes: CAUSE_IDS };
    const written = sanitizeEntry(draft.entry, { ...ctx, evidence: draft.evidence ?? {} });
    result.dropped = written.dropped;
    if (written.reject) {
      result.status = 'rejected';
      result.notes.push(`ライターの下書き: ${written.reject}`);
      continue;
    }
    // ライターの照合済みの根拠は、編集者が変えなかった項目の根拠として引き継ぐ
    const evidence = { ...(draft.evidence ?? {}) };

    // 編集者（ライターの理由づけは見せず、整形済みのデータと記事本文だけを渡す）
    const review = await chatJson({ model: llmConfig.editorModel, system: editorSystem(), user: editorUser({ article, entry: written.entry }) });
    const verdict = ['ok', 'needs_fix', 'reject'].includes(review.verdict) ? review.verdict : 'needs_fix';
    const issues = (Array.isArray(review.issues) ? review.issues : [])
      .map((i) => ({ field: String(i?.field ?? '').slice(0, 40), problem: String(i?.problem ?? '').slice(0, 200) }))
      .filter((i) => i.problem);
    result.editor = { verdict, issues };
    if (verdict === 'reject') {
      result.status = 'rejected';
      result.notes.push('編集者: 掲載すべきでないと判断');
      continue;
    }
    const corrected = { ...written.entry };
    for (const [field, c] of Object.entries(review.corrections && typeof review.corrections === 'object' ? review.corrections : {})) {
      if (c === null || typeof c !== 'object') continue;
      if (c.value === null) delete corrected[field];
      else corrected[field] = c.value;
      evidence[field] = c.evidence;
      result.editor.corrected = [...(result.editor.corrected ?? []), field];
    }
    const final = sanitizeEntry(corrected, { ...ctx, evidence });
    result.dropped = [...result.dropped, ...final.dropped.filter((d) => !result.dropped.some((x) => x.field === d.field && x.reason === d.reason))];
    if (final.reject) {
      result.status = 'rejected';
      result.notes.push(`編集者の修正後: ${final.reject}`);
      continue;
    }
    const entry = { ...final.entry, country: 'JP', sources: [{ title: article.title.slice(0, 120), url: article.url }] };
    const fallback = `ai-${Buffer.from(article.url).toString('base64url').replace(/[^a-z0-9]/g, '').slice(-8).toLowerCase()}`;
    // 記事本文に実在することを確かめた根拠の引用（PR に載せ、Web を見られない環境でも照合できるようにする）
    result.evidence = Object.fromEntries(Object.entries(evidence).filter(([k, v]) => k in final.entry && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 300)]));
    result.slug = slugify(draft.slug, fallback);
    // 同じ事案を報じた別の記事を、この回の後の候補で重複として扱えるようにする
    existing.push({ id: `(この回の下書き) ${result.slug}`, organization: entry.organization, date_announced: entry.date_announced });
    result.entry = entry;
    result.status = 'draft';
  } catch (e) {
    result.notes.push(String(e.message).slice(0, 300));
  } finally {
    console.log(`${result.status.padEnd(8)} ${candidate.title}${result.notes.length ? ` … ${result.notes.join(' / ')}` : ''}`);
  }
}

await writeFile(path.join(OUT, 'drafts.json'), `${JSON.stringify(results, null, 2)}\n`);
await mkdir(path.dirname(STATE), { recursive: true });
// 処理済みの URL は直近のものだけ残す（ニュース候補は最大 7 日分なので十分）
await writeFile(STATE, `${JSON.stringify([...seen].slice(-2000))}\n`);
console.log(`✔ ${results.filter((r) => r.status === 'draft').length} 件の下書きを作りました（処理 ${results.length} 件）`);
