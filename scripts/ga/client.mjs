// Google アナリティクス（GA4）Data API のクライアント（scripts/ga-report.mjs・scripts/feature-ideas.mjs で共用）
//   GA_CREDENTIALS  … サービスアカウントの鍵（JSON の中身をそのまま）
//   GA_PROPERTY_ID  … GA4 のプロパティ ID（数字のみ。測定 ID の G-XXXX とは別）
import { createSign } from 'node:crypto';

const { GA_CREDENTIALS, GA_PROPERTY_ID } = process.env;
const TOKEN_URL = process.env.GA_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';
const API_BASE = process.env.GA_API_BASE ?? 'https://analyticsdata.googleapis.com/v1beta';

export const gaConfigured = Boolean(GA_CREDENTIALS && GA_PROPERTY_ID);

// サービスアカウントの鍵で署名した JWT をアクセストークンに交換する
async function accessToken() {
  const key = JSON.parse(GA_CREDENTIALS);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`アクセストークンの取得に失敗しました（${res.status}）: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

// call('runReport' | 'runRealtimeReport', body) => rows
export async function gaClient() {
  const token = await accessToken();
  return async function call(method, body) {
    const res = await fetch(`${API_BASE}/properties/${GA_PROPERTY_ID}:${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GA Data API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()).rows ?? [];
  };
}
