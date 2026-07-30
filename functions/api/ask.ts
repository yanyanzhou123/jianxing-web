import { type Env, json } from '../_lib/auth';
import {
  cardToIndexText,
  DEEPSEEK_MODEL,
  DEEPSEEK_URL,
  extractLessonsFromCatalog,
  isOffPeakChina,
  loadCardStore,
  loadQueue,
  pickExcerptsFromCard,
  processQueueOnce,
  scoreCardAgainstQuestion,
  type RetrievalCard,
} from '../_lib/cards';

const CATALOG_KEY = 'config/catalog.json';
const RATE_PER_MIN = 8;
const MAX_QUESTION_LEN = 500;
/**
 * 选题按「相关度门槛」，不是按条数凑满。
 * - MIN_ABS_SCORE：最高分低于此值 → 视为没有可靠相关课
 * - MIN_RELEVANCE_RATIO：只保留得分 ≥ 最高分×该比例 的课（如 0.55 = 相对相关度 ≥55%）
 * - SOFT_MAX_SOURCES：仅防止极端情况撑爆界面，不是目标条数
 */
const MIN_ABS_SCORE = 22;
const MIN_RELEVANCE_RATIO = 0.55;
const SOFT_MAX_SOURCES = 6;
const EXCERPT_MAX = 160;
/** 本地粗排后再做门槛过滤的上限 */
const CARD_SHORTLIST = 24;
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

function pickExcerptsKeyword(text: string, question: string, max = 2): string[] {
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

function byRelevanceThreshold<T extends { score: number }>(
  scored: T[],
  absMin = MIN_ABS_SCORE,
  ratio = MIN_RELEVANCE_RATIO,
): T[] {
  if (!scored.length) return [];
  const top = scored[0].score;
  if (top < absMin) return [];
  const floor = Math.max(absMin * 0.45, top * ratio);
  return scored.filter((x) => x.score >= floor).slice(0, SOFT_MAX_SOURCES);
}

/**
 * 检索卡选题：先按相关度门槛过滤，再让 DeepSeek 从达标候选里剔假阳性（只减不增）
 */
async function selectByCards(
  apiKey: string,
  question: string,
  cards: RetrievalCard[],
  preferModule?: string,
): Promise<{ ids: string[]; shortlist: number; topScore: number; threshold: number }> {
  if (!cards.length) return { ids: [], shortlist: 0, topScore: 0, threshold: 0 };

  const scored = cards
    .map((c) => {
      let score = scoreCardAgainstQuestion(c, question);
      if (preferModule && c.moduleSlug === preferModule) score *= 1.25;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, CARD_SHORTLIST);

  const pool = byRelevanceThreshold(scored);
  const topScore = scored[0]?.score || 0;
  const threshold = pool.length ? Math.min(...pool.map((x) => x.score)) : 0;
  if (!pool.length) return { ids: [], shortlist: 0, topScore, threshold: 0 };

  const allowed = new Set(pool.map((x) => x.c.lessonId));
  const index = pool
    .map((x) => {
      const pct = topScore > 0 ? Math.round((x.score / topScore) * 100) : 0;
      return `${cardToIndexText(x.c)}\n[本地相关度: ${pct}% / 分值 ${Math.round(x.score)}]`;
    })
    .join('\n\n----\n\n');

  const system = `你是学修检索助手。下面候选课均已通过本地相关度门槛。
你的任务是「剔假阳性」：只删不增。
规则：
1. 只输出 JSON 数组，元素必须是候选中的课ID（形如 moduleSlug/lessonSlug）。
2. 保留确实能回答问题的课；删掉答非所问、仅关键词碰巧撞上、或 notCover 排除的。
3. 不要为了凑数量保留弱相关；相关就留、不相关就删。可以全部删掉输出 []。
4. 不要编造课ID，不要输出解释，不要新增候选外的课。`;
  const user = `学员问题：${question}
${preferModule ? `学员当前模块（可作轻微参考，勿因此保留不相关课）：${preferModule}\n` : ''}
已过相关度门槛的候选：
${index}`;

  const raw = await deepseekChat(apiKey, system, user, 0.1);
  let ids = parseLessonIds(raw, allowed);

  // 模型若返回空：保留本地最高分那条（已过门槛），不凑满
  if (!ids.length && pool[0]) {
    ids = [pool[0].c.lessonId];
  }

  // 最终仍按门槛约束（防止模型乱序后夹带弱项——实际上 allowed 已全是达标项）
  const scoreMap = new Map(pool.map((x) => [x.c.lessonId, x.score]));
  ids = ids
    .filter((id) => (scoreMap.get(id) || 0) >= threshold)
    .slice(0, SOFT_MAX_SOURCES);

  return { ids, shortlist: pool.length, topScore, threshold };
}

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
      return { id: l.lessonId, score: hit };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  // 关键词兜底：相对最高分门槛（绝对值用较低的 8）
  return byRelevanceThreshold(scored, 8, MIN_RELEVANCE_RATIO).map((x) => x.id);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!(await allowRequest(request))) {
    return json({ error: '提问过于频繁，请稍后再试。' }, 429);
  }
  if (!env.DEEPSEEK_API_KEY) {
    return json({ error: '未配置 DeepSeek API Key' }, 500);
  }

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
  const cardById = new Map(readyCards.map((c) => [c.lessonId, c]));

  let selectedIds: string[] = [];
  let selection: 'cards' | 'keyword-fallback' = 'keyword-fallback';
  let shortlist = 0;
  let topScore = 0;
  let threshold = 0;
  try {
    if (readyCards.length >= 3) {
      const picked = await selectByCards(
        env.DEEPSEEK_API_KEY,
        question,
        readyCards,
        prefer || undefined,
      );
      selectedIds = picked.ids;
      shortlist = picked.shortlist;
      topScore = picked.topScore;
      threshold = picked.threshold;
      if (selectedIds.length) selection = 'cards';
    }
    if (!selectedIds.length) {
      selectedIds = keywordFallback(lessons, question, prefer || undefined);
      selection = 'keyword-fallback';
    }
  } catch (e) {
    selectedIds = keywordFallback(lessons, question, prefer || undefined);
    selection = 'keyword-fallback';
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
      meta: {
        selection,
        cardsReady: readyCards.length,
        shortlist,
        topScore,
        threshold,
        minRelevanceRatio: MIN_RELEVANCE_RATIO,
      },
    });
  }

  const sources: SourceBlock[] = selected.map((l, i) => {
    const card = cardById.get(l.lessonId);
    let excerpts =
      selection === 'cards'
        ? pickExcerptsFromCard(l.text, card, question, 1, EXCERPT_MAX)
        : [];
    if (!excerpts.length) {
      const more = pickExcerptsKeyword(l.text, question, 1);
      excerpts = more.slice(0, 1);
    }
    if (!excerpts.length) excerpts = [trimExcerpt(l.text)];
    // 关键词兜底也压短
    excerpts = excerpts.map((ex) => trimExcerpt(ex)).slice(0, 1);
    return {
      label: SOURCE_LABELS[i] || `来源${i + 1}`,
      moduleSlug: l.moduleSlug,
      moduleTitle: l.moduleTitle,
      chapterTitle: l.chapterTitle,
      lessonSlug: l.lessonSlug,
      lessonTitle: l.lessonTitle,
      href: `/mod/learn/?mod=${encodeURIComponent(l.moduleSlug)}&id=${encodeURIComponent(l.lessonSlug)}`,
      excerpts,
    };
  });

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
      selection,
      cardsReady: readyCards.length,
      shortlist,
      topScore,
      threshold,
      minRelevanceRatio: MIN_RELEVANCE_RATIO,
    },
  });
};
