import { type Env, json, requireAuth } from '../_lib/auth';
import {
  cardStatusForLesson,
  chinaTimeLabel,
  enqueueLessons,
  extractLessonsFromCatalog,
  isOffPeakChina,
  loadCardStore,
  loadQueue,
  processQueueOnce,
  saveQueue,
  withHashes,
} from '../_lib/cards';

const CATALOG_KEY = 'config/catalog.json';

async function loadCatalog(env: Env, request: Request): Promise<any> {
  if (env.FILES) {
    const obj = await env.FILES.get(CATALOG_KEY);
    if (obj) return obj.json();
  }
  const origin = new URL(request.url).origin;
  const res = await fetch(`${origin}/catalog.seed.json`);
  if (!res.ok) throw new Error('无法加载学修目录');
  return res.json();
}

async function requireOpsOrCron(request: Request, env: Env): Promise<Response | null> {
  const cron = request.headers.get('X-Cron-Secret') || '';
  if (cron) {
    if (env.CRON_SECRET && cron === env.CRON_SECRET) return null;
    // 未单独配置 CRON_SECRET 时，允许用运营密码触发定时处理
    if (env.OPS_PASSWORD && cron === env.OPS_PASSWORD) return null;
  }
  return requireAuth(request, env);
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const denied = await requireAuth(context.request, context.env);
  if (denied) return denied;

  try {
    const catalog = await loadCatalog(context.env, context.request);
    const lessons = await withHashes(extractLessonsFromCatalog(catalog));
    const store = await loadCardStore(context.env);
    const queue = await loadQueue(context.env);

    const counts = { ready: 0, queued: 0, stale: 0, missing: 0, failed: 0 };
    const rows = lessons.map((l) => {
      const status = cardStatusForLesson(l, store, queue);
      counts[status]++;
      const card = store.cards[l.lessonId];
      const q = queue.items.find((i) => i.lessonId === l.lessonId);
      return {
        lessonId: l.lessonId,
        moduleTitle: l.moduleTitle,
        lessonTitle: l.lessonTitle,
        chars: l.text.length,
        status,
        priority: q?.priority || null,
        attempts: q?.attempts || 0,
        lastError: q?.lastError || '',
        cardUpdatedAt: card?.updatedAt || '',
      };
    });

    return json({
      ok: true,
      chinaTime: chinaTimeLabel(),
      offPeak: isOffPeakChina(),
      offPeakWindows: ['12:00–14:00', '18:00–次日09:00（北京时间）'],
      totals: {
        lessonsWithText: lessons.length,
        cards: Object.keys(store.cards).length,
        queue: queue.items.length,
        ...counts,
      },
      lessons: rows,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const denied = await requireOpsOrCron(context.request, context.env);
  if (denied) return denied;

  if (!context.env.FILES) return json({ error: '未绑定 R2' }, 500);

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'JSON 无效' }, 400);
  }

  const action = String(body?.action || '').trim();

  try {
    const catalog = await loadCatalog(context.env, context.request);
    const lessons = await withHashes(extractLessonsFromCatalog(catalog));

    if (action === 'enqueue-missing' || action === 'enqueue-all') {
      const store = await loadCardStore(context.env);
      const queue = await loadQueue(context.env);
      const priority = body?.priority === 'asap' ? 'asap' : 'offpeak';

      let targets = lessons;
      if (action === 'enqueue-missing') {
        targets = lessons.filter((l) => {
          const card = store.cards[l.lessonId];
          return !card || card.sourceHash !== l.sourceHash;
        });
      }

      const n = enqueueLessons(queue, targets, priority);
      await saveQueue(context.env, queue);
      return json({
        ok: true,
        enqueued: n,
        queueLeft: queue.items.length,
        priority,
        offPeak: isOffPeakChina(),
        chinaTime: chinaTimeLabel(),
        hint:
          priority === 'offpeak' && !isOffPeakChina()
            ? '已加入空闲时段队列，将在 12–14 点或 18 点–次日 9 点（北京时间）自动生成。'
            : priority === 'asap'
              ? '已标为立即生成，请再点「处理队列」或等待定时任务。'
              : '当前在空闲时段，可开始处理队列。',
      });
    }

    if (action === 'process') {
      const force = !!body?.force;
      const limit = Number(body?.limit) || 2;
      const result = await processQueueOnce(context.env, catalog, { force, limit });
      return json({
        ok: true,
        chinaTime: chinaTimeLabel(),
        ...result,
        hint: result.skippedOffPeak
          ? '当前不在空闲时段（12–14 / 18–次日9，北京时间）。可改用强制立即处理，或等待定时任务。'
          : undefined,
      });
    }

    return json({ error: '未知 action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};
