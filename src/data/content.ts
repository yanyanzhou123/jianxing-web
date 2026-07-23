import seed from '../content/catalog.seed.json';

export type Segment = {
  id: string;
  title: string;
  text: string;
  audioPath: string;
  videoPath: string;
};

export type Lesson = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  segments: Segment[];
};

export type Chapter = {
  id: string;
  title: string;
  lessons: Lesson[];
};

export type ReferenceItem = {
  id: string;
  title: string;
  meta?: string;
  path: string;
};

export type LearningModule = {
  id: string;
  slug: string;
  title: string;
  shortTitle: string;
  summary: string;
  status: 'open' | 'coming';
  statusLabel: string;
  intro: string;
  /** @deprecated 参考资料已提升为目录顶层 references */
  references?: ReferenceItem[];
  chapters: Chapter[];
  href?: string;
  lessonCount?: number;
};

export type Catalog = {
  version: number;
  references: ReferenceItem[];
  modules: LearningModule[];
};

export const seedCatalog = seed as Catalog;

export function lessonCount(mod: LearningModule) {
  return (mod.chapters || []).reduce((n, ch) => n + (ch.lessons?.length || 0), 0);
}

export function segmentCounts(lesson: Lesson) {
  const segs = lesson.segments || [];
  return {
    segments: segs.length,
    texts: segs.filter((s) => s.text?.trim()).length,
    audios: segs.filter((s) => s.audioPath?.trim()).length,
    videos: segs.filter((s) => s.videoPath?.trim()).length,
  };
}

export function formatLessonMeta(lesson: Lesson) {
  const c = segmentCounts(lesson);
  return `小节 ${c.segments} · 文 ${c.texts} · 音 ${c.audios} · 视 ${c.videos}`;
}

export const modules = seedCatalog.modules.map((m) => ({
  ...m,
  href: `/${m.slug}/`,
  lessonCount: lessonCount(m),
}));

export function getModule(slug: string) {
  return modules.find((m) => m.slug === slug);
}
