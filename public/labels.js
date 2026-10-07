// 画面に表示する名称（複数ページで共有）
export const CAUSES = {
  ransomware: 'ランサムウェア',
  unauthorized_access: '不正アクセス',
  vulnerability: '脆弱性の悪用',
  misconfiguration: '設定ミス',
  phishing: 'フィッシング',
  malware: 'マルウェア感染',
  third_party: '委託先・関連会社経由',
  insider: '内部不正',
  human_error: '誤送信・人的ミス',
  lost_device: '紛失・盗難',
  unknown: '不明',
  other: 'その他',
};

// ページ上部に「最終更新」を小さく表示する
export function showUpdated(iso) {
  const el = document.getElementById('updated');
  if (!el || !iso) return;
  const d = new Date(iso);
  const time = Object.assign(document.createElement('time'), {
    dateTime: iso,
    textContent: d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
  });
  el.replaceChildren('最終更新 ', time);
  el.hidden = false;
}
