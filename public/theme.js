// ライト/ダークの切り替え。選んだテーマは localStorage に保存し、未選択なら OS の設定に従う
(() => {
  const KEY = 'theme';
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const isDark = () => (saved() ? saved() === 'dark' : media.matches);

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
  document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.site-header');
    if (!header) return;
    const btn = Object.assign(document.createElement('button'), { id: 'theme-toggle', type: 'button', className: 'theme-toggle' });
    btn.addEventListener('click', () => {
      try { localStorage.setItem(KEY, isDark() ? 'light' : 'dark'); } catch {}
      apply();
    });
    header.append(btn);
    apply();
  });
})();
