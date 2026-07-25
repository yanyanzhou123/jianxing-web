/* jx-catalog v20260725d — parseArticle + 甲一、/丙二、 科判目录 */
window.JX = window.JX || {};

JX.r2Base = () =>
  document.querySelector('meta[name="r2-base"]')?.content?.replace(/\/$/, '') || '';

JX.assetUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  const base = JX.r2Base();
  if (!base) return '';
  return `${base}/${path.replace(/^\//, '')}`;
};

JX.fetchCatalog = async () => {
  const res = await fetch('/api/catalog');
  if (!res.ok) throw new Error('无法加载课程目录');
  return res.json();
};

JX.lessonCount = (mod) =>
  (mod.chapters || []).reduce((n, ch) => n + (ch.lessons?.length || 0), 0);

JX.formatLessonMeta = (lesson) => {
  const texts = lesson.text?.trim() ? 1 : 0;
  const audios = lesson.audioPath?.trim() ? 1 : 0;
  const videos = lesson.videoPath?.trim() ? 1 : 0;
  return `文 ${texts} · 音 ${audios} · 视 ${videos}`;
};

JX.escape = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * 科判标题：甲一、… / 丙二、略说： / 乙一：…
 * 天干 + 中文数字 + （顿号或冒号）+ 标题。
 * 不认：全论分三：一、…；以及「甲一（…）分二：一、…」概述句。
 */
JX.HEADING_RE = /^[甲乙丙丁戊己庚辛壬癸][一二三四五六七八九十百]+[、：:].+$/;

JX.inlineFormat = (escaped) =>
  escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

JX.isOutlineHeading = (line) => {
  const s = String(line || '').trim();
  if (!JX.HEADING_RE.test(s)) return false;
  // 「甲一（礼赞…）分二：一、…；二、…」这类总述不算目录标题
  if (/分[一二三四五六七八九十]+[：:]/.test(s)) return false;
  if (/[；;]/.test(s)) return false;
  if (/（/.test(s) && /）/.test(s) && /分/.test(s)) return false;
  return true;
};

/**
 * 解析课文：按行识别科判标题；每一非空行自成一段（段间空一行）。
 * @returns {{ html: string, toc: { id: string, title: string }[] }}
 */
JX.parseArticle = (text) => {
  const toc = [];
  const raw = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!raw) return { html: '', toc };

  const lines = raw.split('\n');
  let headingIdx = 0;
  const parts = [];

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;

    if (JX.isOutlineHeading(line)) {
      const id = `sec-${headingIdx++}`;
      toc.push({ id, title: line });
      parts.push(
        `<h2 class="learn-heading" id="${id}">${JX.inlineFormat(JX.escape(line))}</h2>`,
      );
    } else {
      parts.push(`<p>${JX.inlineFormat(JX.escape(line))}</p>`);
    }
  }

  return { html: parts.join(''), toc };
};

JX.formatText = (text) => JX.parseArticle(text).html;

JX.findLesson = (catalog, moduleSlug, lessonSlug) => {
  const mod = catalog.modules.find((m) => m.slug === moduleSlug);
  if (!mod) return null;
  for (const ch of mod.chapters || []) {
    const les = (ch.lessons || []).find((l) => l.slug === lessonSlug);
    if (les) {
      return { mod, chapter: ch, lesson: les, lessonsFlat: JX.flatLessons(mod) };
    }
  }
  return null;
};

JX.flatLessons = (mod) => {
  const list = [];
  for (const ch of mod.chapters || []) {
    for (const les of ch.lessons || []) list.push({ ...les, chapterTitle: ch.title });
  }
  return list;
};
