// 外部由来の文字列（記事の見出し・URL など）を Issue や PR の Markdown に載せる前に無害化する
// メンション・HTML・Markdown の装飾を作らせない
export const mdText = (s, max = 200) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}[\]()<>#!|~]/g, '\\$&').replace(/@/g, '@\u200b').slice(0, max);
// http(s) の URL だけをリンクにする（それ以外は空文字）
export const mdUrl = (u) => {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) ? url.href.replace(/[()<> ]/g, (c) => `%${c.charCodeAt(0).toString(16)}`) : '';
  } catch {
    return '';
  }
};
export const mdLink = (title, url) => (mdUrl(url) ? `[${mdText(title)}](${mdUrl(url)})` : mdText(title));
