/** R2 公开访问前缀：开通公开域名或 r2.dev 后填这里 */
export const R2_BASE =
  import.meta.env.PUBLIC_R2_BASE?.replace(/\/$/, '') || '';

export const site = {
  name: '见行修学',
  domain: 'jianxing.win',
  title: '见行修学',
  description:
    '见行修学平台。现含《轮回中的我》《大圆满前行-讲解》《见行佛光》《不离-讲解》四大模块。',
  footerNote:
    '本站内容将持续更新，以最新版本为准；所有内容仅供学修使用，禁止用于商业用途。',
  /** 工信部 ICP 备案号（页脚展示） */
  icpNo: '京ICP备2026033921号-2',
};

const MEDIA_REV = '20260816';

export function assetUrl(path: string) {
  if (!path) return '';
  const withRev = (url: string) =>
    url.includes('?') ? `${url}&v=${MEDIA_REV}` : `${url}?v=${MEDIA_REV}`;
  if (path.startsWith('http')) return withRev(path);
  const clean = path.replace(/^\//, '');
  if (!R2_BASE) return '';
  return withRev(`${R2_BASE}/${clean}`);
}
