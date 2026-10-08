// OpenAI 互換の Chat Completions API（OpenRouter・Groq など）を呼び出す
//   LLM_API_KEY         … API キー（GitHub の Secrets に登録）
//   GROQ_API_KEY        … LLM_API_KEY が無いときに使う Groq の API キー（ベース URL・モデルの既定も Groq 用になる）
//   LLM_BASE_URL        … API のベース URL（既定: OpenRouter。GROQ_API_KEY のときは Groq）
//   LLM_MODEL           … ライター役のモデル名（GROQ_API_KEY のときの既定は openai/gpt-oss-120b）
//   LLM_EDITOR_MODEL    … 編集者役のモデル名（省略時は LLM_MODEL）
//   LLM_INTERVAL_MS     … 呼び出しの間隔（無料枠のレート制限対策。既定 4000）
const env = process.env;
// 空文字（未設定の Variables）は未指定として扱う
const pick = (...v) => v.find((x) => x) || undefined;
const groq = !env.LLM_API_KEY && Boolean(env.GROQ_API_KEY);
const LLM_API_KEY = pick(env.LLM_API_KEY, env.GROQ_API_KEY);
const LLM_BASE_URL = pick(env.LLM_BASE_URL, groq ? 'https://api.groq.com/openai/v1' : 'https://openrouter.ai/api/v1');
const LLM_MODEL = pick(env.LLM_MODEL, groq ? 'openai/gpt-oss-120b' : undefined);
const LLM_EDITOR_MODEL = pick(env.LLM_EDITOR_MODEL);
const LLM_INTERVAL_MS = pick(env.LLM_INTERVAL_MS, '4000');

export const llmConfig = {
  ready: Boolean(LLM_API_KEY && LLM_MODEL),
  writerModel: LLM_MODEL,
  editorModel: LLM_EDITOR_MODEL || LLM_MODEL,
  baseUrl: LLM_BASE_URL.replace(/\/+$/, ''),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

async function request(body) {
  for (let attempt = 1; ; attempt++) {
    const wait = last + Number(LLM_INTERVAL_MS) - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json',
        // OpenRouter のアプリ識別用（他のサービスでは無視される）
        'HTTP-Referer': 'https://github.com/n0bisuke/haveibeenmorasareta',
        'X-Title': 'haveibeenmorasareta',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    if (res.ok) return res.json();
    const text = (await res.text()).slice(0, 300);
    // レート制限・一時的な障害は待って再試行する
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15000 * attempt);
      continue;
    }
    throw new Error(`LLM API ${res.status}: ${text}`);
  }
}

// 応答本文から JSON を取り出す（```json で囲まれていても読めるようにする）
export function parseJson(text) {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
    throw new Error('JSON を読み取れませんでした');
  }
}

// system / user のプロンプトを送り、JSON オブジェクトを返す。読めなければ1回だけ指摘して再生成させる
export async function chatJson({ model, system, user }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  for (let attempt = 1; ; attempt++) {
    const json = await request({ model, messages, temperature: 0, response_format: { type: 'json_object' } });
    const content = json.choices?.[0]?.message?.content ?? '';
    try {
      return parseJson(content);
    } catch (e) {
      if (attempt >= 2) throw e;
      messages.push({ role: 'assistant', content }, { role: 'user', content: '出力が JSON として読めませんでした。指定した形式の JSON オブジェクトだけを出力し直してください。' });
    }
  }
}
