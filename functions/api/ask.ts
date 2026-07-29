import { type Env, json } from '../_lib/auth';
import {
  cardToIndexText,
  DEEPSEEK_MODEL,
  DEEPSEEK_URL,
  extractLessonsFromCatalog,
  isOffPeakChina,
  loadCardStore,
  loadQueue,
  processQueueOnce,
  type RetrievalCard,
} from '../_lib/cards';

const CATALOG_KEY = 'config/catalog.json';
const RATE_PER_MIN = 8;
const MAX_QUESTION_LEN = 500;
const TOP_SOURCES = 4;
const EXCERPT_MAX = 420;
const CARD_BATCH = 14;
const SOURCE_LABELS = ['来源一', '来源二', '来源三', '来源四', '来源五', '来源六'];

type LessonRow = {
  lessonId: string;
  moduleSlug: string;
  moduleTitle: string;
  chapterTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  text: string;
};

type SourceBlock = {
  label: string;
  moduleSlug: string;
  moduleTitle: string;
  chapterTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  href: string;
  excerpts: string[];
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

function trimExcerpt(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= EXCERPT_MAX) return t;
  return `${t.slice(0, EXCERPT_MAX).trim()}…（节选）`;
}

function pickExcerpts(text: string, question: string, max = 2): string[] {
  const chunks: string[] = [];
  const step = 480;
  for (let i = 0; i < text.length; i += step - 60) {
    chunks.push(text.slice(i, Math.min(i + step, text.length)));
    if (i + step >= text.length) break;
  }
  const qSet = new Set(tokenize(question));
  const scored = chunks
    .map((c) => {
      const toks = tokenize(c);
      let hit = 0;
      const seen = new Set<string>();
      for (const t of toks) {
        if (qSet.has(t) && !seen.has(t)) {
          seen.add(t);
          hit += t.length >= 2 ? 2 : 1;
        }
      }
      return { c, hit };
    })
    .sort((a, b) => b.hit - a.hit);
  const out: string[] = [];
  for (const s of scored) {
    if (out.length >= max) break;
    if (s.hit <= 0 && out.length > 0) continue;
    out.push(trimExcerpt(s.c));
  }
  if (!out.length && text.trim()) out.push(trimExcerpt(text));
  return out;
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

async function deepseekChat(
  apiKey: string,
  system: string,
  user: string,
  temperature = 0.2,
): Promise<string> {
  const aiRes = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature,
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const aiData: any = await aiRes.json().catch(() => ({}));
  if (!aiRes.ok) {
    const msg = aiData?.error?.message || aiData?.message || `DeepSeek 错误 ${aiRes.status}`;
    throw new Error(msg);
  }
  const content = String(aiData?.choices?.[0]?.message?.content || '').trim();
  if (!content) throw new Error('模型未返回内容');
  return content;
}

function parseLessonIds(raw: string, allowed: Set<string>): string[] {
  const text = raw.replace(/```[\s\S]*?```/g, (m) => m.replace(/```(?:json)?/g, ''));
  const ids: string[] = [];
  const re = /[a-z0-9-]+\/[a-z0-9-]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = m[0];
    if (allowed.has(id) && !ids.includes(id)) ids.push(id);
  }
  // 也尝试 JSON 数组
  try {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const arr = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(arr)) {
        for (const x of arr) {
          const id = String(x || '').trim();
          if (allowed.has(id) && !ids.includes(id)) ids.push(id);
        }
      }
    }
  } catch {
    // ignore
  }
  return ids;
}

async function selectByCards(
  apiKey: string,
  question: string,
  cards: RetrievalCard[],
  preferModule?: string,
): Promise<string[]> {
  if (!cards.length) return [];

  // 当前模块的卡优先排在前面
  const sorted = cards.slice().sort((a, b) => {
    const ap = preferModule && a.moduleSlug === preferModule ? 0 : 1;
    const bp = preferModule && b.moduleSlug === preferModule ? 0 : 1;
    return ap - bp;
  });

  const allowed = new Set(sorted.map((c) => c.lessonId));
  const nominees = new Set<string>();

  for (let i = 0; i < sorted.length; i += CARD_BATCH) {
    const batch = sorted.slice(i, i + CARD_BATCH);
    const index = batch.map(cardToIndexText).join('\n\n----\n\n');
    const system = `你是学修检索助手。根据学员问题，从检索卡中选出最相关的课。
规则：
1. 只输出 JSON 数组，元素为课ID（形如 moduleSlug/lessonSlug），不要其它文字。
2. 每批最多选 4 个；若不相关可返回 []。
3. 必须依据检索卡，尤其关注 canAnswer、topics、quotes、notCover。
4. 不要编造不存在的课ID。`;
    const user = `学员问题：${question}
${preferModule ? `学员当前所在模块优先：${preferModule}\n` : ''}
检索卡：
${index}`;
    const raw = await deepseekChat(apiKey, system, user, 0.1);
    for (const id of parseLessonIds(raw, allowed)) nominees.add(id);
  }

  const cand = [...nominees];
  if (cand.length <= TOP_SOURCES) return cand;
  if (cand.length === 0) return [];

  // 精排
  const map = new Map(sorted.map((c) => [c.lessonId, c]));
  const index = cand
    .map((id) => map.get(id))
    .filter(Boolean)
    .map((c) => cardToIndexText(c as RetrievalCard))
    .join('\n\n----\n\n');
  const system = `你是学修检索助手。从候选课中选出与问题最相关的最多 ${TOP_SOURCES} 课。
只输出 JSON 数组（课ID），不要其它文字。`;
  const user = `学员问题：${question}\n\n候选检索卡：\n${index}`;
  const raw = await deepseekChat(apiKey, system, user, 0.1);
  const final = parseLessonIds(raw, new Set(cand)).slice(0, TOP_SOURCES);
  return final.length ? final : cand.slice(0, TOP_SOURCES);
}

/** 无卡时的关键词回退 */
function keywordFallback(lessons: LessonRow[], question: string, preferModule?: string): string[] {
  const qSet = new Set(tokenize(question));
  if (!qSet.size) return [];
  const scored = lessons
    .map((l) => {
      const toks = tokenize(`${l.lessonTitle}\n${l.chapterTitle}\n${l.text.slice(0, 2000)}`);
      let hit = 0;
      const seen = new Set<string>();
      for (const t of toks) {
        if (qSet.has(t) && !seen.has(t)) {
          seen.add(t);
          hit += t.length >= 2 ? 2 : 1;
        }
      }
      if (preferModule && l.moduleSlug === preferModule) hit *= 1.35;
      return { id: l.lessonId, hit };
    })
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit);
  return scored.slice(0, TOP_SOURCES).map((x) => x.id);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!(await allowRequest(request))) {
    return json({ error: '提问过于频繁，请稍后再试。' }, 429);
  }
  if (!env.DEEPSEEK_API_KEY) {
    return json({ error: '未配置 DeepSeek API Key' }, 500);
  }

  // 空闲时段且有排队时，顺带消化 1 课（定时 Worker 的兜底）
  try {
    if (isOffPeakChina() && env.FILES) {
      const q = await loadQueue(env);
      if (q.items.length) {
        context.waitUntil(
          loadCatalog(env, request)
            .then((cat) => processQueueOnce(env, cat, { force: false, limit: 1 }))
            .catch(() => null),
        );
      }
    }
  } catch {
    // ignore
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
  const lessons: LessonRow[] = extractLessonsFromCatalog(catalog).map((l) => ({
    lessonId: l.lessonId,
    moduleSlug: l.moduleSlug,
    moduleTitle: l.moduleTitle,
    chapterTitle: l.chapterTitle,
    lessonSlug: l.lessonSlug,
    lessonTitle: l.lessonTitle,
    text: l.text,
  }));
  const byId = new Map(lessons.map((l) => [l.lessonId, l]));

  const store = await loadCardStore(env);
  const readyCards = Object.values(store.cards).filter((c) => byId.has(c.lessonId));

  let selectedIds: string[] = [];
  try {
    if (readyCards.length >= 3) {
      selectedIds = await selectByCards(env.DEEPSEEK_API_KEY, question, readyCards, prefer || undefined);
    }
    if (!selectedIds.length) {
      selectedIds = keywordFallback(lessons, question, prefer || undefined);
    }
  } catch (e) {
    selectedIds = keywordFallback(lessons, question, prefer || undefined);
    if (!selectedIds.length) {
      return json({ error: `检索失败：${String(e)}` }, 502);
    }
  }

  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean) as LessonRow[];
  if (!selected.length) {
    return json({
      ok: true,
      passages: [],
      sources: [],
      summary:
        '已录入的学修文稿中，未能找到与该问题明显相关的内容。建议换个问法，或直接到对应课程中阅读原文。',
    });
  }

  const sources: SourceBlock[] = selected.map((l, i) => ({
    label: SOURCE_LABELS[i] || `来源${i + 1}`,
    moduleSlug: l.moduleSlug,
    moduleTitle: l.moduleTitle,
    chapterTitle: l.chapterTitle,
    lessonSlug: l.lessonSlug,
    lessonTitle: l.lessonTitle,
    href: `/mod/learn/?mod=${encodeURIComponent(l.moduleSlug)}&id=${encodeURIComponent(l.lessonSlug)}`,
    excerpts: pickExcerpts(l.text, question, 2),
  }));

  const passages = sources.map((s) => ({ label: s.label, excerpts: s.excerpts }));

  const contextBlocks = sources
    .map((s) => {
      const bodyText = s.excerpts
        .map((ex, i) => (s.excerpts.length > 1 ? `（段${i + 1}）${ex}` : ex))
        .join('\n');
      return `${s.label}\n课程：${s.moduleTitle} · ${s.lessonTitle}\n原文：\n${bodyText}`;
    })
    .join('\n\n');

  const system = `你是「见行修学」网站的学修助手。页面已向学员展示相关原文与出处链接。
你的任务：仅依据用户消息中的原文，写一段简短归纳，帮助学员把握要点。
规则：
1. 只能依据给出的原文归纳；原文未述及的内容，写「已录入文稿中未述及」，不要编造。
2. 使用简洁、恭敬、明白的中文。可用「1. 2. 3.」分点，但不要使用 Markdown（不要用 **、#、-、[]() 等符号）。
3. 不要写「出处」「来源一」「文稿」等编号引用；出处由页面单独展示。
4. 不要重复大段原文，只做归纳。
5. 你不能替代依止上师与如理闻思，仅作辅助。`;

  let summary = '';
  try {
    summary = await deepseekChat(
      env.DEEPSEEK_API_KEY,
      system,
      `学员问题：${question}\n\n已检索到的原文：\n${contextBlocks}`,
    );
    summary = summary.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  } catch (e) {
    return json({ error: `调用模型失败：${String(e)}` }, 502);
  }

  return json({
    ok: true,
    passages,
    sources: sources.map((s) => ({
      label: s.label,
      moduleSlug: s.moduleSlug,
      moduleTitle: s.moduleTitle,
      chapterTitle: s.chapterTitle,
      lessonSlug: s.lessonSlug,
      lessonTitle: s.lessonTitle,
      href: s.href,
    })),
    summary,
    meta: {
      selection: readyCards.length >= 3 ? 'cards' : 'keyword-fallback',
      cardsReady: readyCards.length,
    },
  });
};
