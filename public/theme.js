// ライト/ダークの切り替え。選んだテーマは localStorage に保存し、未選択なら OS の設定に従う
// （切り替えた結果が OS の設定と同じになったら保存を消し、また OS に従うようにする）
(() => {
  const KEY = 'theme';
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  // 保存できない環境（サイトデータのブロックなど）でも、切り替えはそのページで効くようにする
  let override = read();
  const isDark = () => (override ? override === 'dark' : media.matches);

  // ダークモードで使うドット文字のフォントは、必要になったときだけ読み込む
  function loadFont() {
    if (document.getElementById('dot-font')) return;
    const link = Object.assign(document.createElement('link'), {
      id: 'dot-font', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DotGothic16&display=swap',
    });
    document.head.append(link);
  }

  function apply() {
    const dark = isDark();
    root.classList.toggle('dark', dark);
    if (dark) loadFont();
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = dark ? '☀' : '☾';
      btn.setAttribute('aria-label', dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
      btn.title = btn.getAttribute('aria-label');
    }
  }

  apply();
  media.addEventListener('change', apply);
  // 別のタブで切り替えたときも合わせる
  addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    override = read();
    apply();
  });

  // 次に開きそうなページ（同じサイト内のリンク）を、ホバーなどの操作をきっかけに先読みする。
  // 対応していないブラウザ（Firefox・Safari）では無視される
  if (HTMLScriptElement.supports?.('speculationrules')) {
    const rules = document.createElement('script');
    rules.type = 'speculationrules';
    rules.textContent = JSON.stringify({
      prefetch: [{
        where: { and: [{ href_matches: '/*' }, { not: { href_matches: '/*.json' } }, { not: { selector_matches: '[target=_blank], [download]' } }] },
        eagerness: 'moderate',
      }],
    });
    document.head.append(rules);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.site-header');
    if (!header) return;
    const btn = Object.assign(document.createElement('button'), { id: 'theme-toggle', type: 'button', className: 'theme-toggle' });
    btn.addEventListener('click', () => {
      // 今見えているテーマの反対にする。OS の設定と同じなら保存を消して OS に従う
      const target = isDark() ? 'light' : 'dark';
      const system = media.matches ? 'dark' : 'light';
      override = target === system ? null : target;
      try {
        if (override) localStorage.setItem(KEY, override);
        else localStorage.removeItem(KEY);
      } catch {}
      apply();
    });
    header.append(btn);
    apply();
  });
})();
