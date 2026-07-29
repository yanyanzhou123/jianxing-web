/**
 * 定时消化检索卡队列（仅北京时间空闲时段真正有活干，具体判断在站点 API）。
 * 部署：在仓库根目录执行 npm run deploy:cron
 */
export interface Env {
  SITE_URL: string;
  CRON_SECRET: string;
}

async function tick(env: Env) {
  const base = (env.SITE_URL || 'https://jianxing.win').replace(/\/$/, '');
  const res = await fetch(`${base}/api/cards`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Cron-Secret': env.CRON_SECRET,
    },
    body: JSON.stringify({ action: 'process', limit: 2, force: false }),
  });
  const text = await res.text();
  console.log(`cards process ${res.status}: ${text.slice(0, 500)}`);
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(tick(env));
  },
  async fetch(_request: Request, env: Env): Promise<Response> {
    await tick(env);
    return new Response('ok');
  },
};
