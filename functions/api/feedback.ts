import { type Env, json, requireAuth } from '../_lib/auth';

// 反馈类型白名单
const TYPES = ['practice', 'system'] as const;
type FeedbackType = (typeof TYPES)[number];

const MAX_CONTENT = 2000;
const MIN_CONTENT = 5;
const MAX_EMAIL = 254;
const RATE_PER_MIN = 5;
const LIST_LIMIT = 200;

const TYPE_LABEL: Record<FeedbackType, string> = {
  practice: '修行问题',
  system: '系统问题',
};

function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

// 简单邮箱校验：避免注入与超长
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

async function allowRequest(request: Request): Promise<boolean> {
  try {
    const ip = clientIp(request);
    const bucket = Math.floor(Date.now() / 60000);
    const key = new Request(`https://jx-feedback-rate.internal/${ip}/${bucket}`);
    const cache = caches.default;
    const hit = await cache.match(key);
    const count = hit ? Number(await hit.text()) || 0 : 0;
    if (count >= RATE_PER_MIN) return false;
    await cache.put(
      key,
      new Response(String(count + 1), {
        headers: { 'Cache-Control': 'max-age=120' },
      }),
    );
    return true;
  } catch {
    return true;
  }
}

function newId(): string {
  // crypto.randomUUID 在 Workers 运行时可用
  try {
    return crypto.randomUUID();
  } catch {
    return `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.DB) {
    return json({ error: '反馈服务未配置数据库' }, 500);
  }

  if (!(await allowRequest(request))) {
    return json({ error: '提交过于频繁，请稍后再试。' }, 429);
  }

  let body: { type?: string; content?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const type = String(body.type || '').trim();
  const content = String(body.content || '').trim();
  const email = String(body.email || '').trim();

  if (!TYPES.includes(type as FeedbackType)) {
    return json({ error: '请选择反馈类型' }, 400);
  }
  if (content.length < MIN_CONTENT) {
    return json({ error: `内容至少 ${MIN_CONTENT} 字` }, 400);
  }
  if (content.length > MAX_CONTENT) {
    return json({ error: `内容请控制在 ${MAX_CONTENT} 字以内` }, 400);
  }
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return json({ error: '请填写有效的邮箱地址' }, 400);
  }

  const id = newId();
  const createdAt = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO feedback (id, type, content, email, created_at, status)
       VALUES (?, ?, ?, ?, ?, 'new')`,
    )
      .bind(id, type, content, email, createdAt)
      .run();
  } catch (e) {
    return json({ error: `保存失败：${String(e)}` }, 500);
  }

  return json({ ok: true, id, createdAt });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.DB) {
    return json({ error: '反馈服务未配置数据库' }, 500);
  }

  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const type = url.searchParams.get('type') || '';
  const status = url.searchParams.get('status') || '';
  const limit = Math.min(
    Number(url.searchParams.get('limit')) || LIST_LIMIT,
    LIST_LIMIT,
  );

  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (TYPES.includes(type as FeedbackType)) {
    where.push('type = ?');
    binds.push(type);
  }
  if (['new', 'read', 'archived'].includes(status)) {
    where.push('status = ?');
    binds.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(
    `SELECT id, type, content, email, created_at, status
     FROM feedback
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(...binds, limit)
    .all();

  return json({
    ok: true,
    items: (results || []).map((r: any) => ({
      ...r,
      typeLabel: TYPE_LABEL[r.type as FeedbackType] || r.type,
    })),
  });
};

// 标记状态（已读 / 归档）
export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.DB) {
    return json({ error: '反馈服务未配置数据库' }, 500);
  }

  const authErr = await requireAuth(request, env);
  if (authErr) return authErr;

  let body: { id?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const id = String(body.id || '').trim();
  const status = String(body.status || '').trim();
  if (!id) return json({ error: '缺少 id' }, 400);
  if (!['new', 'read', 'archived'].includes(status)) {
    return json({ error: '状态非法' }, 400);
  }

  try {
    await env.DB.prepare(`UPDATE feedback SET status = ? WHERE id = ?`)
      .bind(status, id)
      .run();
  } catch (e) {
    return json({ error: `更新失败：${String(e)}` }, 500);
  }

  return json({ ok: true });
};
