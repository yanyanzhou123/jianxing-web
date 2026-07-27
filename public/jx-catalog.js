/* jx-catalog v20260726i — stairs without step nums, larger chapter text */
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

JX.fetchCatalog = async () => {
  const res = await fetch('/api/catalog');
  if (!res.ok) throw new Error('无法加载课程目录');
  return res.json();
};

JX.lessonCount = (mod) =>
  (mod.chapters || []).reduce((n, ch) => n + (ch.lessons?.length || 0), 0);

/** 首页/学修：分区写死，条目按 slug 取模块 */
JX.HOME_SECTIONS = [
  {
    title: '基础课',
    slugs: ['mod-fngg2o9', 'mod-1n1ezwq'],
  },
  {
    title: '公共学修',
    slugs: ['mod-fdjm6e2', 'mod-dt23wzh', 'puxian', 'pingdeng', 'xiuxin'],
  },
  {
    title: '专业课',
    groups: [
      {
        title: '大圆满前行',
        slugs: ['mod-3dup9xj', 'wujiaxing', 'shangshi', 'qianxing'],
      },
      {
        title: '菩提道次第广论',
        slugs: ['fayuanwen', 'shesong', 'guanglun'],
      },
    ],
  },
  {
    title: '实修篇',
    slugs: [
      'shixiu-zongshe',
      'shixiu-renge',
      'shixiu-yinguo',
      'shixiu-chuli',
      'shixiu-cibei',
      'shixiu-kongxing',
      'shixiu-zhenshiu',
    ],
  },
  {
    title: '见行选读',
    slugs: ['buli'],
  },
];

JX.HOME_BOOKS = [
  {
    title: '老师出的书',
    items: [
      { id: 'ref-lunhui-book', title: '轮回中的我' },
      { id: 'ref-qianxing-book', title: '前行【1-3】' },
      { id: 'ref-foguang-book', title: '见行佛光【1-3】' },
      { id: 'ref-buli-book', title: '不离见行' },
    ],
  },
  {
    title: '其他参考书',
    items: [{ id: 'ref-puxian-book', title: '大圆满前行普贤上师言教' }],
  },
];

JX.modBySlug = (catalog, slug) =>
  (catalog?.modules || []).find((m) => m.slug === slug) || null;

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
  const href = fileUrl || (ref?.id ? `/reference/#${encodeURIComponent(ref.id)}` : '/reference/');
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
  return `
    <li class="${open ? 'is-open' : ''}">
      <a href="${JX.moduleHref(mod.slug)}">
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

/** 首页次第：基础课→实修篇 竖长台阶 */
JX.HOME_STAIR_TITLES = ['基础课', '公共学修', '专业课', '实修篇'];

JX.renderStairModLink = (catalog, slug) => {
  const mod = JX.modBySlug(catalog, slug);
  if (!mod) {
    return `<li class="path-stairs__mod is-missing"><span>${JX.escape(slug)}</span></li>`;
  }
  const open = mod.status === 'open';
  return `
    <li class="path-stairs__mod ${open ? 'is-open' : 'is-soon'}">
      <a href="${JX.moduleHref(mod.slug)}">${JX.escape(mod.title)}</a>
    </li>`;
};

JX.renderHomeStairs = (catalog) => {
  const pathSecs = (JX.HOME_SECTIONS || []).filter((s) =>
    (JX.HOME_STAIR_TITLES || []).includes(s.title)
  );
  const items = pathSecs
    .map((sec, index) => {
      let modsHtml = '';
      if (sec.groups?.length) {
        modsHtml = sec.groups
          .map(
            (g) => `
            <li class="path-stairs__group">
              <span class="path-stairs__group-title">${JX.escape(g.title)}</span>
              <ul class="path-stairs__mods">
                ${(g.slugs || []).map((slug) => JX.renderStairModLink(catalog, slug)).join('')}
              </ul>
            </li>`
          )
          .join('');
        modsHtml = `<ul class="path-stairs__groups">${modsHtml}</ul>`;
      } else {
        modsHtml = `<ul class="path-stairs__mods">
          ${(sec.slugs || []).map((slug) => JX.renderStairModLink(catalog, slug)).join('')}
        </ul>`;
      }
      const anyOpen = (sec.groups || [{ slugs: sec.slugs || [] }]).some((g) =>
        (g.slugs || []).some((slug) => JX.modBySlug(catalog, slug)?.status === 'open')
      );
      return `
        <li class="path-stairs__item ${anyOpen ? 'is-open' : 'is-soon'}">
          <div class="path-stairs__card">
            <span class="path-stairs__sec">${JX.escape(sec.title)}</span>
            ${modsHtml}
          </div>
          <span class="path-stairs__arrow" aria-hidden="true">→</span>
        </li>`;
    })
    .join('');

  return `
    <section class="home-block home-block--stairs">
      <div class="section__head">
        <h2>次第修学</h2>
        <p>建议按下列次第，一门接一门循序学修。</p>
      </div>
      <ol class="path-stairs path-stairs--sections">
        ${items}
        ${JX.renderPathMore()}
      </ol>
    </section>`;
};

JX.renderHomeSections = (catalog, opts = {}) => {
  const mode = opts.mode || 'list';
  const stairTitles = new Set(JX.HOME_STAIR_TITLES || []);

  let main = '';
  if (mode === 'stairs') {
    main = JX.renderHomeStairs(catalog);
  }

  const listSecs = (JX.HOME_SECTIONS || []).filter((sec) => {
    if (mode === 'stairs' && stairTitles.has(sec.title)) return false;
    return true;
  });

  const parts = listSecs.map((sec) => {
    let body = '';
    if (sec.groups?.length) {
      body = sec.groups
        .map(
          (g) => `
          <div class="home-group">
            <h3 class="home-group__title">${JX.escape(g.title)}</h3>
            ${JX.renderSlugList(catalog, g.slugs)}
          </div>`
        )
        .join('');
    } else {
      body = JX.renderSlugList(catalog, sec.slugs);
    }
    return `
      <section class="home-block">
        <div class="section__head">
          <h2>${JX.escape(sec.title)}</h2>
        </div>
        ${body}
      </section>`;
  });

  const books = (JX.HOME_BOOKS || [])
    .map(
      (b) => `
      <section class="home-block home-block--books">
        <div class="section__head">
          <h2>${JX.escape(b.title)}</h2>
          <p>PDF 文件可能较大，打开时请耐心等待；也可前往「下载」页保存到本地。</p>
        </div>
        <ul class="book-list">
          ${(b.items || []).map((item) => JX.renderBookRow(catalog, item)).join('')}
        </ul>
      </section>`
    )
    .join('');

  return main + parts.join('') + books;
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
