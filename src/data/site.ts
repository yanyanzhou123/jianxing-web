/** R2 公开访问前缀：开通公开域名或 r2.dev 后填这里 */
export const R2_BASE =
  import.meta.env.PUBLIC_R2_BASE?.replace(/\/$/, '') || '';

export const site = {
  name: '见行学会',
  domain: 'jianxing.win',
  title: '见行学会',
  description:
    '见行学会学修平台。现含《轮回中的我》《大圆满前行-讲解》《见行佛光》《不离-讲解》四大模块。',
  footerNote:
    '本站内容仅供学修，禁止商业使用。文稿与音视频将陆续替换为正式版本。',
};

export function assetUrl(path: string) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  const clean = path.replace(/^\//, '');
  if (!R2_BASE) return '';
  return `${R2_BASE}/${clean}`;
}
