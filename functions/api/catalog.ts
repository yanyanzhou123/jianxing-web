import { type Env, json, requireAuth } from '../_lib/auth';
import { extractLessonsFromCatalog, withHashes } from '../_lib/cards';
import { processPassageRebuild } from '../_lib/passages';

const CATALOG_KEY = 'config/catalog.json';
const BACKUP_PREFIX = 'config/backups/';
const BACKUP_KEEP = 30;
/** 课次减少超过此比例时需二次确认（force） */
const DROP_CONFIRM_RATIO = 0.3;

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeRelatedLinks(list: any): any[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((a: any) => {
      const collectionId = String(a?.collectionId || '').trim();
      const kind = a?.kind === 'article' || collectionId ? 'article' : 'url';
      return {
        id: String(a?.id || uid('rl')),
        kind,
        title: String(a?.title || '').trim(),
        url: kind === 'url' ? String(a?.url || '').trim() : '',
        collectionId: kind === 'article' ? collectionId : '',
        articleId: kind === 'article' ? String(a?.articleId || '').trim() : '',
      };
    })
    .filter((a) => (a.kind === 'article' ? !!a.collectionId : !!(a.title || a.url)));
}

function normalizeXuequ(list: any): any[] {
  if (!Array.isArray(list)) return [];
  return list.map((x: any) => ({
    ...(x && typeof x === 'object' ? x : {}),
    id: String(x?.id || uid('xq')),
    title: String(x?.title || '').trim(),
    onStairs: !!x?.onStairs,
    groups: Array.isArray(x?.groups) ? x.groups : [],
    relatedLinks: normalizeRelatedLinks(x?.relatedLinks),
  }));
}

function countLessons(data: { modules?: any[] } | null | undefined): number {
  return (data?.modules || []).reduce((n, mod) => {
    return (
      n +
      (mod.chapters || []).reduce(
        (n2: number, ch: any) => n2 + ((ch.lessons || []) as any[]).length,
        0,
      )
    );
  }, 0);
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
      videoPathSd: '',
    };
  }

  let text = typeof les.text === 'string' ? les.text : '';
  let audioPath = typeof les.audioPath === 'string' ? les.audioPath : '';
  let videoPath = typeof les.videoPath === 'string' ? les.videoPath : '';
  let videoPathSd = typeof les.videoPathSd === 'string' ? les.videoPathSd : '';

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
    videoPathSd,
  };
}

/** 兼容旧版；v4 起课直接含文字/音视频，不再有小节 */
function migrateCatalog(data: any) {
  if (!data || !Array.isArray(data.modules)) {
    return { version: 4, rev: 0, references: [], xuequ: [], modules: [] };
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

    const out: any = {
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
    // 学修分区（运营可选）；「未归类」需显式保留；未设置时前台回退旧 slug 名单
    if (mod.section != null && String(mod.section).trim() !== '') {
      out.section = String(mod.section).trim();
    }
    if (out.section && out.section !== '未归类') {
      const sg = String(mod.sectionGroup || '').trim();
      if (sg) out.sectionGroup = sg;
    }
    if (mod.track) out.track = mod.track;
    if (mod.pathOrder != null && mod.pathOrder !== '') {
      out.pathOrder = Number(mod.pathOrder) || mod.pathOrder;
    }
    if (mod.sectionId) out.sectionId = String(mod.sectionId).trim();
    if (mod.groupId) out.groupId = String(mod.groupId).trim();
    return out;
  });

  return {
    version: 4,
    rev: Number(data.rev) || 0,
    references,
    xuequ: normalizeXuequ(data.xuequ),
    modules,
  };
}

async function loadSeed(request: Request): Promise<unknown> {
  const origin = new URL(request.url).origin;
  const res = await fetch(`${origin}/catalog.seed.json`);
  if (!res.ok) throw new Error('无法加载默认目录');
  return res.json();
}

async function readCatalog(env: Env, request: Request): Promise<any> {
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

/** 选课/考问用：是否有足够正文（排除「（占位）」等空壳） */
function isSubstantialLessonText(text: string, hasSegText = false): boolean {
  const t = String(text || '').trim();
  if (/[（(]\s*占位\s*[）)]/.test(t)) return false;
  if (/^(待补充|暂无正文|占位|内容待上传)/.test(t)) return false;
  if (t.length >= 80) return true;
  // 极短文且无分段正文：视为不可考
  if (hasSegText && t.length >= 40) return true;
  return false;
}

function lessonHasText(les: any): boolean {
  const text = typeof les?.text === 'string' ? les.text.trim() : '';
  const segText = Array.isArray(les?.segments)
    ? les.segments
        .map((s: any) => String(s?.text || '').trim())
        .filter(Boolean)
        .join('\n\n')
    : '';
  return isSubstantialLessonText(text || segText, segText.length > 0);
}

function findLessonInCatalog(data: any, moduleSlug: string, lessonSlug: string) {
  const mod = (data?.modules || []).find((m: any) => m.slug === moduleSlug);
  if (!mod) return null;
  for (const ch of mod.chapters || []) {
    const lesson = (ch.lessons || []).find((l: any) => l.slug === lessonSlug);
    if (lesson) return { mod, chapter: ch, lesson };
  }
  return null;
}

/** 列表页用：去掉课文正文，体积小很多 */
function liteCatalog(data: any) {
  return {
    version: data?.version || 4,
    rev: Number(data?.rev) || 0,
    references: data?.references || [],
    xuequ: normalizeXuequ(data?.xuequ),
    modules: (data?.modules || []).map((mod: any) => {
      const out: any = {
        id: mod.id,
        slug: mod.slug,
        title: mod.title,
        shortTitle: mod.shortTitle || mod.title,
        summary: mod.summary || '',
        status: mod.status,
        statusLabel: mod.statusLabel || '',
        intro: mod.intro || '',
        chapters: (mod.chapters || []).map((ch: any) => ({
          id: ch.id,
          title: ch.title,
          lessons: (ch.lessons || []).map((les: any) => ({
            id: les.id,
            slug: les.slug,
            title: les.title,
            summary: les.summary || '',
            audioPath: les.audioPath || '',
            videoPath: les.videoPath || '',
            videoPathSd: les.videoPathSd || '',
            hasText: lessonHasText(les),
          })),
        })),
      };
      if (mod.section != null && String(mod.section).trim() !== '') {
        out.section = String(mod.section).trim();
      }
      if (out.section && out.section !== '未归类' && mod.sectionGroup) {
        out.sectionGroup = String(mod.sectionGroup).trim();
      }
      if (mod.sectionId) out.sectionId = String(mod.sectionId).trim();
      if (mod.groupId) out.groupId = String(mod.groupId).trim();
      if (mod.track) out.track = mod.track;
      if (mod.pathOrder != null && mod.pathOrder !== '') out.pathOrder = mod.pathOrder;
      return out;
    }),
  };
}

async function pruneBackups(env: Env) {
  const listed = await env.FILES.list({ prefix: BACKUP_PREFIX, limit: 1000 });
  const objs = (listed.objects || []).slice().sort((a, b) => a.key.localeCompare(b.key));
  const excess = objs.length - BACKUP_KEEP;
  if (excess <= 0) return;
  await Promise.all(objs.slice(0, excess).map((o) => env.FILES.delete(o.key)));
}

async function backupCurrent(env: Env, raw: unknown, rev: number) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `${BACKUP_PREFIX}catalog-${stamp}-rev${rev}.json`;
  await env.FILES.put(key, JSON.stringify(raw, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  try {
    await pruneBackups(env);
  } catch {
    // 清理失败不影响主保存
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const data = await readCatalog(context.env, context.request);
    const url = new URL(context.request.url);
    const lite = url.searchParams.get('lite') === '1';
    const modSlug = (url.searchParams.get('mod') || '').trim();
    const lessonSlug = (url.searchParams.get('id') || '').trim();

    if (modSlug && lessonSlug) {
      const found = findLessonInCatalog(data, modSlug, lessonSlug);
      if (!found) return json({ error: '未找到课程' }, 404);
      const res = json({
        rev: Number(data?.rev) || 0,
        lesson: found.lesson,
      });
      res.headers.set('Cache-Control', 'public, max-age=60');
      return res;
    }

    const body = lite ? liteCatalog(data) : data;
    const res = json(body);
    if (lite) {
      res.headers.set('Cache-Control', 'public, max-age=120');
    } else {
      res.headers.set('Cache-Control', 'no-store');
    }
    return res;
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

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'JSON 无效' }, 400);
  }

  const force = !!body?.force;
  const baseRevRaw = body?.baseRev;
  const baseRev =
    baseRevRaw === undefined || baseRevRaw === null || baseRevRaw === ''
      ? null
      : Number(baseRevRaw);

  // 客户端辅助字段不入库
  if (body && typeof body === 'object') {
    delete body.force;
    delete body.baseRev;
  }

  const existingObj = await context.env.FILES.get(CATALOG_KEY);
  let currentRaw: unknown = null;
  let currentRev = 0;
  let currentLessons = 0;
  if (existingObj) {
    currentRaw = await existingObj.json();
    const current = migrateCatalog(currentRaw);
    currentRev = Number(current.rev) || 0;
    currentLessons = countLessons(current);
  }

  if (baseRev !== null && !Number.isNaN(baseRev) && baseRev !== currentRev) {
    return json(
      {
        error: '目录已被他人更新，请重新加载后再保存，以免覆盖别人的修改。',
        code: 'CONFLICT',
        serverRev: currentRev,
        clientRev: baseRev,
      },
      409,
    );
  }

  const migrated = migrateCatalog(body);
  if (!Array.isArray(migrated.modules)) {
    return json({ error: '目录格式错误：需要 { modules: [] }' }, 400);
  }
  if (!Array.isArray(migrated.references)) {
    migrated.references = [];
  }

  const newLessons = countLessons(migrated);
  if (
    !force &&
    currentLessons > 0 &&
    newLessons < currentLessons * (1 - DROP_CONFIRM_RATIO)
  ) {
    return json(
      {
        error: `课次从 ${currentLessons} 减少到 ${newLessons}，可能误删。确认要覆盖保存吗？`,
        code: 'NEED_CONFIRM',
        currentLessons,
        newLessons,
      },
      409,
    );
  }

  if (currentRaw != null) {
    await backupCurrent(context.env, currentRaw, currentRev);
  }

  migrated.rev = currentRev + 1;
  migrated.version = 4;

  await context.env.FILES.put(CATALOG_KEY, JSON.stringify(migrated, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });

  // 正文变更后增量重建段落向量索引（异步）；检索卡已停用
  try {
    if (context.env.AI && context.env.VECTORIZE) {
      context.waitUntil(
        processPassageRebuild(context.env, migrated, { limit: 8 }).catch(() => null),
      );
    }
  } catch {
    // ignore
  }

  return json({
    ok: true,
    rev: migrated.rev,
    lessonCount: newLessons,
    backedUp: currentRaw != null,
  });
};
