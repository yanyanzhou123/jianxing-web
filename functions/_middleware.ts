/**
 * jianxing.xin 公安备案期间：整站返回极简占位页。
 * 关闭方式（任选其一）：
 * 1) Cloudflare Pages → Settings → Environment variables → 设 XIN_PLACEHOLDER=0
 * 2) 删除或注释本中间件中对 xin 主机的拦截逻辑后重新 deploy
 *
 * jianxing.win 不受影响，始终为完整站。
 */

type Env = {
  ASSETS: Fetcher;
  XIN_PLACEHOLDER?: string;
};

const XIN_HOSTS = new Set(['jianxing.xin', 'www.jianxing.xin']);

function hostOf(request: Request): string {
  return (request.headers.get('host') || '').split(':')[0].toLowerCase();
}

function placeholderEnabled(env: Env): boolean {
  // 默认开启；显式设为 0 / false / off 时关闭
  const v = (env.XIN_PLACEHOLDER ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

const PASSTHROUGH = new Set([
  '/favicon.svg',
  '/favicon.ico',
  '/robots.txt',
  '/beian/index.html',
]);

export const onRequest: PagesFunction<Env> = async (context) => {
  const host = hostOf(context.request);
  if (!XIN_HOSTS.has(host) || !placeholderEnabled(context.env)) {
    return context.next();
  }

  const url = new URL(context.request.url);
  if (PASSTHROUGH.has(url.pathname)) {
    return context.next();
  }

  const assetUrl = new URL('/beian/index.html', url.origin);
  const assetReq = new Request(assetUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'text/html' },
  });
  const assetRes = await context.env.ASSETS.fetch(assetReq);
  if (!assetRes.ok) {
    return new Response('占位页暂不可用', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(assetRes.body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};
