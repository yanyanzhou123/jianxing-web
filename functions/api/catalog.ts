import { type Env, json, requireAuth } from '../_lib/auth';

const CATALOG_KEY = 'config/catalog.json';

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 兼容旧版 sections/texts/audios/videos → chapters/segments */
function migrateCatalog(data: any) {
  if (!data || !Array.isArray(data.modules)) {
    return { version: 2, modules: [] };
  }
  const modules = data.modules.map((mod: any) => {
    if (Array.isArray(mod.chapters)) {
      return mod;
    }
    const sections = mod.sections || [];
    const chapters = sections.map((sec: any) => ({
      id: sec.id || uid('ch'),
      title: sec.label || sec.title || '未命名章节',
      lessons: (sec.lessons || []).map((les: any) => {
        const texts = les.texts || [];
        const audios = les.audios || [];
        const videos = les.videos || [];
        let segments = les.segments;
        if (!segments) {
          const n = Math.max(1, texts.length, audios.length, videos.length);
          segments = Array.from({ length: n }, (_, i) => ({
            id: uid('seg'),
            title: texts[i]?.title || `小节${i + 1}`,
            text: texts[i]?.body || '',
            audioPath: audios[i]?.path || '',
            videoPath: videos[i]?.path || '',
          }));
        }
        return {
          id: les.id || uid('les'),
          slug: les.slug,
          title: les.title,
          summary: les.summary || '',
          segments,
        };
      }),
    }));
    return {
      id: mod.id || mod.slug,
      slug: mod.slug,
      title: mod.title,
      shortTitle: mod.shortTitle || mod.title,
      summary: mod.summary || '',
      status: mod.status || 'coming',
      statusLabel: mod.statusLabel || '',
      intro: mod.intro || '',
      references: (mod.references || []).map((r: any, i: number) => ({
        id: r.id || `ref-${i}`,
        title: r.title,
        meta: r.meta || '',
        path: r.path,
      })),
      chapters,
    };
  });
  return { version: 2, modules };
}

async function loadSeed(request: Request): Promise<unknown> {
  const origin = new URL(request.url).origin;
  const res = await fetch(`${origin}/catalog.seed.json`);
  if (!res.ok) throw new Error('无法加载默认目录');
  return res.json();
}

async function readCatalog(env: Env, request: Request): Promise<unknown> {
  if (!env.FILES) {
    return migrateCatalog(await loadSeed(request));
  }
  const obj = await env.FILES.get(CATALOG_KEY);
  if (!obj) {
    const seed = migrateCatalog(await loadSeed(request));
    await env.FILES.put(CATALOG_KEY, JSON.stringify(seed, null, 2), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    return seed;
  }
  const raw = await obj.json();
  return migrateCatalog(raw);
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const data = await readCatalog(context.env, context.request);
    return json(data);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const denied = await requireAuth(context.request, context.env);
  if (denied) return denied;

  if (!context.env.FILES) {
    return json({ error: '未绑定 R2' }, 500);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'JSON 无效' }, 400);
  }

  const migrated = migrateCatalog(body);
  if (!Array.isArray(migrated.modules)) {
    return json({ error: '目录格式错误：需要 { modules: [] }' }, 400);
  }

  await context.env.FILES.put(CATALOG_KEY, JSON.stringify(migrated, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  return json({ ok: true });
};
