import { type Env, json, requireAuth } from '../_lib/auth';

const CATALOG_KEY = 'config/catalog.json';

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 将旧小节/旧 texts·audios·videos 压平到课一级 */
function flattenLesson(les: any) {
  if (!les || typeof les !== 'object') {
    return {
      id: uid('les'),
      slug: `lesson-${uid('l')}`,
      title: '未命名课',
      summary: '',
      text: '',
      audioPath: '',
      videoPath: '',
    };
  }

  let text = typeof les.text === 'string' ? les.text : '';
  let audioPath = typeof les.audioPath === 'string' ? les.audioPath : '';
  let videoPath = typeof les.videoPath === 'string' ? les.videoPath : '';

  if (Array.isArray(les.segments) && les.segments.length) {
    const segs = les.segments;
    if (!text.trim()) {
      text = segs
        .map((s: any) => String(s?.text || '').trim())
        .filter(Boolean)
        .join('\n\n');
    }
    if (!audioPath.trim()) {
      audioPath = segs.find((s: any) => String(s?.audioPath || '').trim())?.audioPath || '';
    }
    if (!videoPath.trim()) {
      videoPath = segs.find((s: any) => String(s?.videoPath || '').trim())?.videoPath || '';
    }
  } else if (!text && !audioPath && !videoPath) {
    const texts = les.texts || [];
    const audios = les.audios || [];
    const videos = les.videos || [];
    text = texts
      .map((t: any) => String(t?.body || t?.text || '').trim())
      .filter(Boolean)
      .join('\n\n');
    audioPath = audios.find((a: any) => a?.path)?.path || '';
    videoPath = videos.find((v: any) => v?.path)?.path || '';
  }

  return {
    id: les.id || uid('les'),
    slug: les.slug || `lesson-${uid('l')}`,
    title: les.title || '未命名课',
    summary: les.summary || '',
    text,
    audioPath,
    videoPath,
  };
}

/** 兼容旧版；v4 起课直接含文字/音视频，不再有小节 */
function migrateCatalog(data: any) {
  if (!data || !Array.isArray(data.modules)) {
    return { version: 4, references: [], modules: [] };
  }

  const references: any[] = [];
  const seenPath = new Set<string>();
  const seenId = new Set<string>();

  function takeRefs(list: any[] | undefined) {
    for (const r of list || []) {
      const path = String(r?.path || '').trim();
      const id = String(r?.id || uid('ref'));
      if (path && seenPath.has(path)) continue;
      if (!path && seenId.has(id)) continue;
      if (path) seenPath.add(path);
      seenId.add(id);
      references.push({
        id,
        title: r.title || '未命名资料',
        meta: r.meta || '',
        path,
      });
    }
  }

  takeRefs(data.references);

  const modules = data.modules.map((mod: any) => {
    takeRefs(mod.references);

    let chapters: any[];
    if (Array.isArray(mod.chapters)) {
      chapters = mod.chapters.map((ch: any) => ({
        id: ch.id || uid('ch'),
        title: ch.title || '未命名章节',
        lessons: (ch.lessons || []).map(flattenLesson),
      }));
    } else {
      const sections = mod.sections || [];
      chapters = sections.map((sec: any) => ({
        id: sec.id || uid('ch'),
        title: sec.label || sec.title || '未命名章节',
        lessons: (sec.lessons || []).map(flattenLesson),
      }));
    }

    return {
      id: mod.id || mod.slug,
      slug: mod.slug,
      title: mod.title,
      shortTitle: mod.shortTitle || mod.title,
      summary: mod.summary || '',
      status: mod.status || 'coming',
      statusLabel: mod.statusLabel || '',
      intro: mod.intro || '',
      references: [],
      chapters,
    };
  });

  return { version: 4, references, modules };
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
  if (!Array.isArray(migrated.references)) {
    migrated.references = [];
  }

  await context.env.FILES.put(CATALOG_KEY, JSON.stringify(migrated, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  return json({ ok: true });
};
