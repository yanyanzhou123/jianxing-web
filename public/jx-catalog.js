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

JX.formatText = (text) =>
  JX.escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, '<br />')}</p>`)
    .join('');

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
