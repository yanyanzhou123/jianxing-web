import { type Env, json } from '../_lib/auth';

const CATALOG_KEY = 'config/catalog.json';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const RATE_PER_MIN = 8;
const MAX_QUESTION_LEN = 500;
const TOP_CHUNKS = 6;
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 80;

type DocChunk = {
  id: string;
  moduleSlug: string;
  moduleTitle: string;
  chapterTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  text: string;
  score: number;
};

function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

async function allowRequest(request: Request): Promise<boolean> {
  try {
    const ip = clientIp(request);
    const bucket = Math.floor(Date.now() / 60000);
    const key = new Request(`https://jx-ask-rate.internal/${ip}/${bucket}`);
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

function tokenize(s: string): string[] {
  const raw = String(s || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fffa-z0-9]+/g, ' ');
  const parts = raw.match(/[\u4e00-\u9fff]+|[a-z0-9]+/g) || [];
  const tokens: string[] = [];
  for (const p of parts) {
    if (/[\u4e00-\u9fff]/.test(p)) {
      for (let i = 0; i < p.length; i++) tokens.push(p[i]);
      for (let i = 0; i < p.length - 1; i++) tokens.push(p.slice(i, i + 2));
      if (p.length >= 3) {
        for (let i = 0; i < p.length - 2; i++) tokens.push(p.slice(i, i + 3));
      }
    } else if (p.length > 1) {
      tokens.push(p);
    }
  }
  return tokens;
}

function chunkText(text: string): string[] {
  const t = text.replace(/\r/g, '').trim();
  if (!t) return [];
  if (t.length <= CHUNK_SIZE) return [t];
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(i + CHUNK_SIZE, t.length);
    out.push(t.slice(i, end));
    if (end >= t.length) break;
    i = Math.max(end - CHUNK_OVERLAP, i + 1);
  }
  return out;
}

function extractLessons(catalog: any): Omit<DocChunk, 'id' | 'score' | 'text'> & { text: string }[] {
  const rows: any[] = [];
  for (const mod of catalog?.modules || []) {
    for (const ch of mod.chapters || []) {
      for (const les of ch.lessons || []) {
        let text = typeof les.text === 'string' ? les.text : '';
        if (!text.trim() && Array.isArray(les.segments)) {
          text = les.segments
            .map((s: any) => String(s?.text || '').trim())
            .filter(Boolean)
            .join('\n\n');
        }
        text = text.trim();
        if (!text) continue;
        rows.push({
          moduleSlug: mod.slug,
          moduleTitle: mod.title || mod.slug,
          chapterTitle: ch.title || '',
          lessonSlug: les.slug,
          lessonTitle: les.title || les.slug,
          text,
        });
      }
    }
  }
  return rows;
}

function retrieve(
  catalog: any,
  question: string,
  preferModule?: string,
): DocChunk[] {
  const qTokens = tokenize(question);
  if (!qTokens.length) return [];

  const qSet = new Set(qTokens);
  const chunks: DocChunk[] = [];
  let n = 0;

  for (const les of extractLessons(catalog)) {
    const parts = chunkText(les.text);
    parts.forEach((part, idx) => {
      const tTokens = tokenize(part);
      if (!tTokens.length) return;
      let hit = 0;
      const seen = new Set<string>();
      for (const tok of tTokens) {
        if (qSet.has(tok) && !seen.has(tok)) {
          seen.add(tok);
          // 二元/三元权重更高
          hit += tok.length >= 2 ? 2 : 1;
        }
      }
      let score = hit;
      if (preferModule && les.moduleSlug === preferModule) score *= 1.35;
      // 标题命中加权
      const titleHit = tokenize(`${les.lessonTitle}${les.chapterTitle}`).filter((t) =>
        qSet.has(t),
      ).length;
      score += titleHit * 3;
      if (score <= 0) return;
      chunks.push({
        id: `${les.moduleSlug}/${les.lessonSlug}#${idx}`,
        moduleSlug: les.moduleSlug,
        moduleTitle: les.moduleTitle,
        chapterTitle: les.chapterTitle,
        lessonSlug: les.lessonSlug,
        lessonTitle: les.lessonTitle,
        text: part,
        score,
      });
      n++;
    });
  }

  chunks.sort((a, b) => b.score - a.score);
  // 去重同课过多片段，每课最多 2 段
  const perLesson = new Map<string, number>();
  const picked: DocChunk[] = [];
  for (const c of chunks) {
    const k = `${c.moduleSlug}/${c.lessonSlug}`;
    const used = perLesson.get(k) || 0;
    if (used >= 2) continue;
    perLesson.set(k, used + 1);
    picked.push(c);
    if (picked.length >= TOP_CHUNKS) break;
  }
  return picked;
}

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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!(await allowRequest(request))) {
    return json({ error: '提问过于频繁，请稍后再试。' }, 429);
  }

  if (!env.DEEPSEEK_API_KEY) {
    return json({ error: '未配置 DeepSeek API Key' }, 500);
  }

  let body: { question?: string; moduleSlug?: string; lessonSlug?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const question = String(body.question || '').trim();
  if (!question) return json({ error: '请输入问题' }, 400);
  if (question.length > MAX_QUESTION_LEN) {
    return json({ error: `问题请控制在 ${MAX_QUESTION_LEN} 字以内` }, 400);
  }

  let catalog: any;
  try {
    catalog = await loadCatalog(env, request);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }

  const prefer = String(body.moduleSlug || '').trim();
  const chunks = retrieve(catalog, question, prefer || undefined);

  if (!chunks.length) {
    return json({
      ok: true,
      answer:
        '已录入的学修文稿中，未能找到与该问题明显相关的内容。建议换个问法，或直接到对应课程中阅读原文。',
      sources: [],
    });
  }

  const contextBlocks = chunks
    .map(
      (c, i) =>
        `【文稿${i + 1}】\n模块：${c.moduleTitle}\n章节：${c.chapterTitle}\n课程：${c.lessonTitle}\n链接参数：mod=${c.moduleSlug}&id=${c.lessonSlug}\n内容：\n${c.text}`,
    )
    .join('\n\n');

  const system = `你是「见行修学」网站的学修助手。你只能依据用户消息中提供的「参考文稿」回答问题。
规则：
1. 不得使用参考文稿之外的知识进行发挥或补充；文稿未述及的内容，必须明确回答「已录入文稿中未述及」，不要编造。
2. 用简洁、恭敬、明白的中文回答，可分点说明。
3. 回答末尾用「出处：」列出依据的课程名称（不要编造课程）。
4. 你不能替代依止上师与如理闻思，仅作辅助检索与归纳。`;

  const userMsg = `学员问题：${question}\n\n参考文稿：\n${contextBlocks}`;

  let answer = '';
  try {
    const aiRes = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMsg },
        ],
      }),
    });

    const aiData: any = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) {
      const msg = aiData?.error?.message || aiData?.message || `DeepSeek 错误 ${aiRes.status}`;
      return json({ error: msg }, 502);
    }
    answer = String(aiData?.choices?.[0]?.message?.content || '').trim();
    if (!answer) return json({ error: '模型未返回内容，请稍后再试' }, 502);
  } catch (e) {
    return json({ error: `调用模型失败：${String(e)}` }, 502);
  }

  // 来源去重
  const sourceMap = new Map<string, any>();
  for (const c of chunks) {
    const k = `${c.moduleSlug}/${c.lessonSlug}`;
    if (!sourceMap.has(k)) {
      sourceMap.set(k, {
        moduleSlug: c.moduleSlug,
        moduleTitle: c.moduleTitle,
        chapterTitle: c.chapterTitle,
        lessonSlug: c.lessonSlug,
        lessonTitle: c.lessonTitle,
        href: `/mod/learn/?mod=${encodeURIComponent(c.moduleSlug)}&id=${encodeURIComponent(c.lessonSlug)}`,
      });
    }
  }

  return json({
    ok: true,
    answer,
    sources: [...sourceMap.values()],
  });
};
