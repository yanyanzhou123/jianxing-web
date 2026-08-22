/* jx-catalog v20260822e — 课文支持 # 行标题 */
window.JX = window.JX || {};

/** 播放地址加版本，避开浏览器对旧 URL 的一年 immutable 缓存 */
JX.MEDIA_REV = '20260816';

JX.r2Base = () =>
  document.querySelector('meta[name="r2-base"]')?.content?.replace(/\/$/, '') || '';

JX.withMediaRev = (url) => {
  if (!url) return '';
  if (/[?&]v=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${JX.MEDIA_REV}`;
};

JX.assetUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return JX.withMediaRev(path);
  const base = JX.r2Base();
  if (!base) return '';
  return JX.withMediaRev(`${base}/${path.replace(/^\//, '')}`);
};

/** 模块列表页（可配置 slug，不再写死 /lunhui/ 等） */
JX.moduleHref = (slug) => `/mod/?id=${encodeURIComponent(slug || '')}`;

/** 课学习页 */
JX.lessonHref = (modSlug, lessonSlug) =>
  `/mod/learn/?mod=${encodeURIComponent(modSlug || '')}&id=${encodeURIComponent(lessonSlug || '')}`;

/** 强制另存为（同源 API，避免音视频在浏览器内直接播放） */
JX.downloadHref = (path) => {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) {
    try {
      const u = new URL(path);
      const base = JX.r2Base();
      if (base && path.startsWith(base + '/')) {
        return `/api/download?path=${encodeURIComponent(path.slice(base.length + 1))}`;
      }
    } catch (_) {}
    return path;
  }
  return `/api/download?path=${encodeURIComponent(String(path).replace(/^\//, ''))}`;
};

JX.fetchCatalog = async (opts) => {
  const lite = !!(opts && opts.lite);
  const res = await fetch(lite ? '/api/catalog?lite=1&v=20260822e' : '/api/catalog', { cache: 'no-store' });
  if (!res.ok) throw new Error('无法加载课程目录');
  const data = await res.json();
  if (lite) JX._liteCatalog = data;
  return data;
};

JX.fetchLesson = async (moduleSlug, lessonSlug) => {
  const qs = new URLSearchParams({
    mod: moduleSlug || '',
    id: lessonSlug || '',
  });
  const res = await fetch(`/api/catalog?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('无法加载课文');
  return res.json();
};

JX.lessonCount = (mod) =>
  (mod.chapters || []).reduce((n, ch) => n + (ch.lessons?.length || 0), 0);

/** 学区默认名单。课表有 xuequ 时以前台课表为准。 */
JX.DEFAULT_XUEQU = [
  { id: 'xq-jichu', title: '基础课', onStairs: true, groups: [] },
  { id: 'xq-gonggong', title: '公共学修', onStairs: true, groups: [] },
  {
    id: 'xq-zhuanye',
    title: '专业课',
    onStairs: true,
    groups: [
      { id: 'xz-qianxing', title: '大圆满前行' },
      { id: 'xz-guanglun', title: '菩提道次第广论' },
    ],
  },
  { id: 'xq-xuanxiu', title: '见行选修', onStairs: false, groups: [] },
];

/** 旧版：按 slug 写死分区（模块尚未写 section 时回退） */
JX.LEGACY_SECTION_SLUGS = [
  { title: '基础课', slugs: ['mod-fngg2o9', 'mod-1n1ezwq'] },
  {
    title: '公共学修',
    slugs: ['mod-fdjm6e2', 'mod-dt23wzh', 'puxian', 'pingdeng', 'xiuxin', 'xinbaoshi'],
  },
  {
    title: '专业课',
    groups: [
      { title: '大圆满前行', slugs: ['mod-3dup9xj', 'wujiaxing', 'shangshi', 'qianxing'] },
      { title: '菩提道次第广论', slugs: ['fayuanwen', 'shesong', 'guanglun'] },
    ],
  },
  { title: '见行选修', slugs: ['buli'] },
];

JX.getXuequ = (catalog) =>
  Array.isArray(catalog?.xuequ) && catalog.xuequ.length ? catalog.xuequ : JX.DEFAULT_XUEQU;

JX.isLatestXuequ = (sec) => String(sec?.title || '').trim() === '最新开示';

JX.isLatestPlaceholderMod = (mod) => {
  if (!mod) return false;
  if (String(mod.title || '').trim() === '最新开示') return true;
  return JX.resolveModSection(mod).section === '最新开示';
};

JX.formatLessonAge = (iso) => {
  const t = Date.parse(iso);
  if (!t) return '';
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (days < 1) return '今天';
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  const months = Math.max(1, Math.floor(days / 30));
  return `${months}个月前`;
};

JX.recentLessons = (catalog, months = 3) => {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceMs = since.getTime();
  const rows = [];
  for (const mod of catalog?.modules || []) {
    if (JX.isComing(mod) || JX.isLatestPlaceholderMod(mod)) continue;
    for (const ch of mod.chapters || []) {
      for (const les of ch.lessons || []) {
        const at = Date.parse(les.createdAt || '');
        if (!at || at < sinceMs) continue;
        rows.push({ mod, chapter: ch, lesson: les, at });
      }
    }
  }
  rows.sort((a, b) => b.at - a.at);
  return rows;
};

JX.renderLatestRail = (catalog) => {
  const rows = JX.recentLessons(catalog);
  const items = rows.length
    ? `<ul class="home-latest__list">${rows
        .map((row) => {
          const href = JX.lessonHref(row.mod.slug, row.lesson.slug);
          const modTitle = row.mod.shortTitle || row.mod.title || '';
          return `
        <li class="home-latest__item">
          <a href="${href}">
            <span class="home-latest__mod">${JX.escape(modTitle)}</span>
            <span class="home-latest__title">${JX.escape(row.lesson.title || '未命名课')}</span>
            <span class="home-latest__time">${JX.escape(JX.formatLessonAge(row.lesson.createdAt))}</span>
          </a>
        </li>`;
        })
        .join('')}</ul>`
    : `<p class="home-latest__empty">近三个月暂无新课</p>`;
  return `
    <section class="home-block home-latest" aria-label="最新开示">
      <div class="section__head">
        <h2>最新开示</h2>
        <p>近三个月新课</p>
      </div>
      ${items}
    </section>`;
};

JX.modBySlug = (catalog, slug) =>
  (catalog?.modules || []).find((m) => m.slug === slug) || null;

/** 旧版：按 slug 写死分区（无 section 字段时回退） */
JX.legacySlugPlacement = () => {
  if (JX._legacyPlacement) return JX._legacyPlacement;
  const map = Object.create(null);
  for (const sec of JX.LEGACY_SECTION_SLUGS || []) {
    for (const slug of sec.slugs || []) {
      map[slug] = { section: sec.title, group: '' };
    }
    for (const g of sec.groups || []) {
      for (const slug of g.slugs || []) {
        map[slug] = { section: sec.title, group: g.title || '' };
      }
    }
  }
  JX._legacyPlacement = map;
  return map;
};

/**
 * 解析模块所属分区。
 * - section 为「未归类」：明确未归类
 * - section 有值：用运营配置
 * - 否则回退旧 slug 名单
 */
JX.resolveModSection = (mod) => {
  if (!mod) return { section: '', group: '' };
  const raw = mod.section;
  if (raw === '未归类') return { section: '', group: '' };
  const sec = String(raw ?? '').trim();
  if (sec) {
    return { section: sec, group: String(mod.sectionGroup || '').trim() };
  }
  const legacy = JX.legacySlugPlacement()[mod.slug];
  if (legacy) return { section: legacy.section, group: legacy.group || '' };
  return { section: '', group: '' };
};

JX.modulesInSection = (catalog, sectionTitle, groupTitle) => {
  const wantGroup = groupTitle == null ? null : String(groupTitle);
  return (catalog?.modules || []).filter((m) => {
    const p = JX.resolveModSection(m);
    if (p.section !== sectionTitle) return false;
    if (wantGroup == null) return true;
    return (p.group || '') === wantGroup;
  });
};

JX.unsectionedModules = (catalog) => {
  const titles = new Set((JX.getXuequ(catalog) || []).map((x) => x.title));
  return (catalog?.modules || []).filter((m) => {
    const p = JX.resolveModSection(m);
    return !p.section || !titles.has(p.section);
  });
};

JX.refByIdOrTitle = (catalog, id, title) => {
  const refs = catalog?.references || [];
  return (
    refs.find((r) => r.id === id) ||
    refs.find((r) => (r.title || '') === title) ||
    null
  );
};

JX.renderBookRow = (catalog, item) => {
  const title = typeof item === 'string' ? item : item.title;
  const id = typeof item === 'string' ? '' : item.id || '';
  const ref = JX.refByIdOrTitle(catalog, id, title);
  const fileUrl = ref?.path ? JX.assetUrl(ref.path) : '';
  const href = fileUrl || (ref?.id ? `/reference/books/#${encodeURIComponent(ref.id)}` : '/reference/books/');
  const meta = fileUrl ? '打开 PDF' : '进入参考资料';
  const external = fileUrl
    ? ' target="_blank" rel="noopener"'
    : '';
  const hint = fileUrl
    ? `<p class="book-list__hint">文件可能较大，打开或下载需要一些时间，请稍候。</p>`
    : '';
  return `
    <li>
      <a class="book-list__link" href="${href}"${external}>
        <span class="book-list__title">《${JX.escape(title)}》</span>
        <span class="book-list__meta">${meta}</span>
      </a>
      ${hint}
    </li>`;
};

JX.isComing = (mod) => !!mod && mod.status !== 'open';

JX.comingNotice = () => {
  window.alert('即将开放');
};

JX.bindComingGuards = () => {
  if (JX._comingBound) return;
  JX._comingBound = true;
  const block = (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-jx-coming]') : null;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    JX.comingNotice();
  };
  document.addEventListener('click', block, true);
  document.addEventListener('auxclick', block, true);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', JX.bindComingGuards);
} else {
  JX.bindComingGuards();
}

JX.renderModuleRow = (mod, index) => {
  if (!mod) {
    return `
      <li class="is-missing">
        <span class="module-list__num">${String(index + 1).padStart(2, '0')}</span>
        <div>
          <p class="module-list__meta">待创建</p>
          <h3 class="module-list__title">（模块缺失）</h3>
        </div>
      </li>`;
  }
  const count = JX.lessonCount(mod);
  const open = mod.status === 'open';
  const meta = `${JX.escape(mod.statusLabel || (open ? '开放中' : '即将开放'))}${count ? ` · ${count} 课` : ''}`;
  const comingAttr = open ? '' : ' data-jx-coming="1" aria-disabled="true"';
  return `
    <li class="${open ? 'is-open' : ''}">
      <a href="${JX.moduleHref(mod.slug)}"${comingAttr}>
        <span class="module-list__num">${String(index + 1).padStart(2, '0')}</span>
        <div>
          <p class="module-list__meta">${meta}</p>
          <h3 class="module-list__title">《${JX.escape(mod.title)}》</h3>
          ${mod.summary ? `<p class="module-list__summary">${JX.escape(mod.summary)}</p>` : ''}
        </div>
      </a>
    </li>`;
};

JX.renderSlugList = (catalog, slugs) =>
  `<ul class="module-list">${(slugs || [])
    .map((slug, i) => JX.renderModuleRow(JX.modBySlug(catalog, slug), i))
    .join('')}</ul>`;

JX.renderModList = (mods) =>
  `<ul class="module-list">${(mods || [])
    .map((mod, i) => JX.renderModuleRow(mod, i))
    .join('')}</ul>`;

/** 首页次第：勾选「上首页台阶」的学区；默认基础课→专业课 */
JX.HOME_STAIR_TITLES = ['基础课', '公共学修', '专业课'];

JX.renderStairModFromMod = (mod) => {
  if (!mod) {
    return `<li class="path-stairs__mod is-missing"><span>（缺失）</span></li>`;
  }
  const open = mod.status === 'open';
  const comingAttr = open ? '' : ' data-jx-coming="1" aria-disabled="true"';
  return `
    <li class="path-stairs__mod ${open ? 'is-open' : 'is-soon'}">
      <a href="${JX.moduleHref(mod.slug)}"${comingAttr}>${JX.escape(mod.title)}</a>
    </li>`;
};

JX.renderSectionModsBody = (catalog, sec) => {
  if (sec.groups?.length) {
    const knownGroups = new Set(sec.groups.map((g) => g.title));
    const groupBlocks = sec.groups
      .map((g) => {
        const mods = JX.modulesInSection(catalog, sec.title, g.title);
        if (!mods.length) return '';
        return `
          <div class="home-group">
            <h3 class="home-group__title">${JX.escape(g.title)}</h3>
            ${JX.renderModList(mods)}
          </div>`;
      })
      .join('');
    const orphans = JX.modulesInSection(catalog, sec.title).filter(
      (m) => !knownGroups.has(JX.resolveModSection(m).group),
    );
    const orphanBlock = orphans.length
      ? `<div class="home-group"><h3 class="home-group__title">其他</h3>${JX.renderModList(orphans)}</div>`
      : '';
    return groupBlocks + orphanBlock;
  }
  return JX.renderModList(JX.modulesInSection(catalog, sec.title, ''));
};

JX.renderHomeStairs = (catalog) => JX.renderLatestRail(catalog);

JX.safeHttpUrl = (url) => {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
};

JX.safeHref = (url) => {
  const u = String(url || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return u;
  return '';
};

JX.fetchArticles = async () => {
  const res = await fetch('/api/articles', { cache: 'no-store' });
  if (!res.ok) throw new Error('无法加载公众号好文');
  const data = await res.json();
  return Array.isArray(data.collections) ? data.collections : [];
};

JX.resolveRelatedLink = (item, collections) => {
  if (!item) return null;
  const override = String(item.title || '').trim();
  if (item.kind === 'article' || item.collectionId) {
    const col = (collections || []).find((c) => c.id === item.collectionId);
    if (!col) return null;
    if (item.articleId) {
      const art = (col.articles || []).find((a) => a.id === item.articleId);
      if (!art) return null;
      const href = JX.safeHref(art.url);
      if (!href) return null;
      return {
        title: override || art.title || col.title || '相关链接',
        href,
        external: /^https?:\/\//i.test(href),
      };
    }
    if (col.kind === 'link') {
      const href = JX.safeHref(col.url);
      if (!href) return null;
      return {
        title: override || col.title || '相关链接',
        href,
        external: /^https?:\/\//i.test(href),
      };
    }
    return {
      title: override || col.title || '相关链接',
      href: `/reference/articles/#acol-${encodeURIComponent(col.id)}`,
      external: false,
    };
  }
  const href = JX.safeHref(item.url);
  if (!href) return null;
  return {
    title: override || '相关链接',
    href,
    external: /^https?:\/\//i.test(href),
  };
};

JX.renderRelatedLinks = (links, collections) => {
  const items = (links || [])
    .map((item) => {
      const resolved = JX.resolveRelatedLink(item, collections);
      if (!resolved) return '';
      const extra = resolved.external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<li class="home-related__item"><a href="${JX.escape(resolved.href)}"${extra}><span class="home-related__title">${JX.escape(resolved.title)}</span><span class="home-related__go" aria-hidden="true">↗</span></a></li>`;
    })
    .filter(Boolean);
  if (!items.length) return '';
  return `<ul class="home-related">${items.join('')}</ul>`;
};

JX.renderHomeSections = (catalog, opts = {}) => {
  const mode = opts.mode || 'list';
  const xuequ = JX.getXuequ(catalog) || [];

  let main = '';
  if (mode === 'stairs') {
    main = JX.renderHomeStairs(catalog);
  }

  const listSecs = xuequ.filter((sec) => {
    if (mode === 'stairs' && JX.isLatestXuequ(sec)) return false;
    return true;
  });

  const parts = listSecs.map((sec) => {
    const body = JX.renderSectionModsBody(catalog, sec);
    const linksHtml = JX.renderRelatedLinks(sec.relatedLinks, opts.articles);
    if ((!body || body === '<ul class="module-list"></ul>') && !linksHtml) return '';
    return `
      <section class="home-block">
        <div class="section__head">
          <h2>${JX.escape(sec.title)}</h2>
        </div>
        ${body || ''}
        ${linksHtml}
      </section>`;
  }).filter(Boolean);

  const extras = JX.unsectionedModules(catalog);
  if (extras.length) {
    parts.push(`
      <section class="home-block">
        <div class="section__head">
          <h2>未归类</h2>
          <p>尚未选择学修分区的模块，可在运营后台为模块指定分区。</p>
        </div>
        ${JX.renderModList(extras)}
      </section>`);
  }

  // 书籍与其他材料不在学修目录展示，见 /reference/
  return main + parts.join('');
};

/** 兼容旧调用 */
JX.pathModules = (catalog) => catalog?.modules || [];
JX.extraModules = () => [];
JX.renderPathItem = (mod, index) => JX.renderModuleRow(mod, index);
JX.renderPathListItem = (mod, index) => JX.renderModuleRow(mod, index);
JX.renderPathMore = () => `
  <li class="path-stairs__more" aria-label="后续还有更多次第">
    <span class="path-stairs__more-dots" aria-hidden="true">···</span>
    <span class="path-stairs__more-title">后续</span>
    <span class="path-stairs__more-label">还有更多</span>
  </li>`;

JX.formatLessonMeta = (lesson) => {
  const texts = lesson.text?.trim() || lesson.hasText ? 1 : 0;
  const audios = lesson.audioPath?.trim() ? 1 : 0;
  const videos = (lesson.videoPath?.trim() || lesson.videoPathSd?.trim()) ? 1 : 0;
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

/** Markdown 行标题：# 标题 / ## 标题（# 后至少空一格） */
JX.MD_HEADING_RE = /^(#{1,3})[\s\u3000]+(.+)$/;

JX.parseMarkdownHeading = (line) => {
  const m = String(line || '').trim().match(JX.MD_HEADING_RE);
  if (!m) return null;
  const title = String(m[2] || '').trim();
  return title ? { level: m[1].length, title } : null;
};

/**
 * 解析课文：按行识别科判标题与 # 标题；每一非空行自成一段（段间空一行）。
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

    const md = JX.parseMarkdownHeading(line);
    if (JX.isOutlineHeading(line) || md) {
      const id = `sec-${headingIdx++}`;
      const title = md ? md.title : line;
      toc.push({ id, title });
      parts.push(
        `<h2 class="learn-heading" id="${id}">${JX.inlineFormat(JX.escape(title))}</h2>`,
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
