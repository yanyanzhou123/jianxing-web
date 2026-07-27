(() => {
  const $ = (id) => document.getElementById(id);
  const loginBox = $('ops-login');
  const appBox = $('ops-app');
  const moduleList = $('module-list');
  const editor = $('module-editor');
  const saveMsg = $('save-msg');
  const dirtyBanner = $('dirty-banner');

  let catalog = null;
  let moduleIndex = 0;
  /** @type {'module' | 'refs'} */
  let sideMode = 'module';
  /** @type {'structure' | 'lesson'} */
  let view = 'structure';
  /** @type {{ ci: number, li: number } | null} */
  let editPath = null;
  let dirty = false;
  let saving = false;
  /** 展开中的章节 id（默认全部折叠） */
  const expandedChapterIds = new Set();

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function autoSlug(title, fallback) {
    const base = String(title || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!base || /[\u4e00-\u9fff]/.test(base)) {
      return fallback || `lesson-${uid('l')}`;
    }
    return base.slice(0, 48) || fallback || `lesson-${uid('l')}`;
  }

  /** 模块网址标识：仅小写字母、数字、连字符 */
  function normalizeModSlug(raw, fallback) {
    let s = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    if (!s || !/^[a-z][a-z0-9-]*$/.test(s)) return fallback || `mod-${uid('m')}`;
    return s;
  }

  function uniqueModSlug(slug, exceptIndex) {
    let base = slug;
    let n = 2;
    let next = slug;
    while (catalog.modules.some((m, i) => i !== exceptIndex && m.slug === next)) {
      next = `${base}-${n++}`;
    }
    return next;
  }

  function statusLabelFor(status) {
    return status === 'open' ? '开放中' : '即将开放';
  }

  function addModule() {
    const n = (catalog.modules?.length || 0) + 1;
    const title = `新模块 ${n}`;
    // 网址标识自动生成，运营无需填写；一旦生成不随标题改动，以免音视频路径错乱
    const slug = uniqueModSlug(`mod-${uid('m')}`, -1);
    catalog.modules.push({
      id: slug,
      slug,
      title,
      shortTitle: title,
      summary: '',
      status: 'coming',
      statusLabel: statusLabelFor('coming'),
      intro: '',
      references: [],
      chapters: [],
    });
    moduleIndex = catalog.modules.length - 1;
    sideMode = 'module';
    view = 'structure';
    editPath = null;
    setDirty(true);
    renderModuleList();
    renderEditor();
  }

  function assetUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    const base =
      document.querySelector('meta[name="r2-base"]')?.content?.replace(/\/$/, '') || '';
    if (!base) return '';
    return `${base}/${path.replace(/^\//, '')}`;
  }

  function showMsg(el, text, ok) {
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle('is-ok', !!ok);
    el.classList.toggle('is-error', !ok);
  }

  function setDirty(value) {
    dirty = !!value;
    if (dirtyBanner) dirtyBanner.hidden = !dirty;
  }

  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `请求失败 ${res.status}`);
      err.code = data.code;
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const MULTIPART_THRESHOLD = 20 * 1024 * 1024;
  const PART_SIZE = 8 * 1024 * 1024;

  function mimeForUpload(key, file) {
    const name = String(key || file?.name || '').toLowerCase();
    if (name.endsWith('.mp4') || name.endsWith('.m4v')) return 'video/mp4';
    if (name.endsWith('.webm')) return 'video/webm';
    if (name.endsWith('.mp3')) return 'audio/mpeg';
    if (name.endsWith('.m4a')) return 'audio/mp4';
    if (name.endsWith('.pdf')) return 'application/pdf';
    return file?.type || 'application/octet-stream';
  }

  async function uploadFile(key, file, onProgress) {
    if (file.size <= MULTIPART_THRESHOLD) {
      const fd = new FormData();
      fd.set('key', key);
      fd.set('file', file);
      if (onProgress) onProgress(0, file.size);
      const result = await api('/api/upload', { method: 'POST', body: fd });
      if (onProgress) onProgress(file.size, file.size);
      return result;
    }

    const init = await api('/api/upload-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        contentType: mimeForUpload(key, file),
      }),
    });

    const parts = [];
    const total = file.size;
    let offset = 0;
    let partNumber = 1;

    while (offset < total) {
      const end = Math.min(offset + PART_SIZE, total);
      const blob = file.slice(offset, end);
      const qs = new URLSearchParams({
        key,
        uploadId: init.uploadId,
        partNumber: String(partNumber),
      });
      const res = await fetch(`/api/upload-part?${qs}`, {
        method: 'PUT',
        credentials: 'same-origin',
        body: blob,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `分片 ${partNumber} 失败`);
      parts.push({ partNumber: data.partNumber, etag: data.etag });
      offset = end;
      partNumber += 1;
      if (onProgress) onProgress(offset, total);
    }

    return api('/api/upload-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId: init.uploadId, parts }),
    });
  }

  async function saveCatalog(opts = {}) {
    const { silent = false, reason = '', force = false } = opts;
    if (saving) return;
    saving = true;
    try {
      if (!silent) showMsg(saveMsg, '保存中…', true);
      catalog.version = 4;
      if (!Array.isArray(catalog.references)) catalog.references = [];
      const payload = {
        ...catalog,
        version: 4,
        baseRev: catalog.rev ?? 0,
        force: !!force,
      };
      const result = await api('/api/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (result?.rev != null) catalog.rev = result.rev;
      setDirty(false);
      const backupHint = result?.backedUp ? '（已自动备份上一版）' : '';
      const msg = (reason || '已保存。前台刷新即可看到变化。') + backupHint;
      showMsg(saveMsg, msg, true);
    } catch (e) {
      if (e.code === 'CONFLICT') {
        showMsg(saveMsg, e.message || '目录冲突', false);
        if (
          confirm(
            `${e.message || '目录已被他人更新。'}\n\n是否重新加载服务器目录？\n（当前未保存的本地修改将丢失）`,
          )
        ) {
          await loadCatalog();
        }
        throw e;
      }
      if (e.code === 'NEED_CONFIRM' && !force) {
        const ok = confirm(
          `${e.message || '课次明显减少。'}\n\n确定仍要覆盖保存吗？\n（保存前服务器会自动备份上一版）`,
        );
        if (ok) {
          saving = false;
          return saveCatalog({ ...opts, force: true });
        }
        showMsg(saveMsg, '已取消保存', false);
        return;
      }
      showMsg(saveMsg, e.message || String(e), false);
      throw e;
    } finally {
      saving = false;
    }
  }

  async function ensureSession() {
    try {
      await api('/api/session');
      loginBox.hidden = true;
      appBox.hidden = false;
      await loadCatalog();
    } catch {
      loginBox.hidden = false;
      appBox.hidden = true;
    }
  }

  async function loadCatalog() {
    catalog = await api('/api/catalog');
    if (!catalog.modules) catalog.modules = [];
    if (!Array.isArray(catalog.references)) catalog.references = [];
    if (catalog.rev == null) catalog.rev = 0;
    // 兼容：把仍挂在模块下的参考资料提到顶层（与接口 migrate 一致的前端兜底）
    catalog.modules.forEach((mod, i) => {
      if (mod.references?.length) {
        for (const r of mod.references) {
          const path = String(r.path || '');
          const exists = catalog.references.some(
            (x) => (path && x.path === path) || x.id === r.id,
          );
          if (!exists) catalog.references.push({ ...r });
        }
        mod.references = [];
      }
      // 缺省标识时自动补全（不覆盖已有 slug）
      if (!mod.slug || !/^[a-z][a-z0-9-]{0,47}$/.test(String(mod.slug))) {
        mod.slug = uniqueModSlug(normalizeModSlug(mod.id, `mod-${uid('m')}`), i);
        if (!mod.id) mod.id = mod.slug;
        setDirty(true);
      }
      mod.statusLabel = statusLabelFor(mod.status);
      if (!mod.shortTitle) mod.shortTitle = mod.title || '';
    });
    view = 'structure';
    editPath = null;
    sideMode = 'module';
    setDirty(false);
    renderModuleList();
    renderEditor();
  }

  function currentModule() {
    return catalog?.modules?.[moduleIndex] || null;
  }

  function lessonStatus(les) {
    const hasText = !!(les.text && String(les.text).trim());
    const hasAudio = !!(les.audioPath && String(les.audioPath).trim());
    const hasVideo = !!(les.videoPath && String(les.videoPath).trim());
    const badges = [];
    if (hasText) badges.push('<span class="ops-badge" title="有文字">文</span>');
    if (hasAudio) badges.push('<span class="ops-badge ops-badge--audio" title="有音频">音</span>');
    if (hasVideo) badges.push('<span class="ops-badge ops-badge--video" title="有视频">视</span>');
    if (!badges.length) badges.push('<span class="ops-badge ops-badge--empty">空</span>');
    return badges.join('');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderModuleList() {
    const mods = catalog.modules
      .map(
        (m, i) =>
          `<li><button type="button" data-mode="module" data-i="${i}" class="${
            sideMode === 'module' && i === moduleIndex ? 'is-active' : ''
          }">${escapeHtml(m.title)}</button></li>`,
      )
      .join('');
    const refsBtn = `<li><button type="button" data-mode="refs" class="${
      sideMode === 'refs' ? 'is-active' : ''
    }">参考资料</button></li>`;
    moduleList.innerHTML = mods + refsBtn;

    moduleList.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (
          dirty &&
          !confirm('当前有未保存修改，切换将丢失这些修改（除非你已保存）。仍要切换？')
        ) {
          return;
        }
        const mode = btn.dataset.mode;
        if (mode === 'refs') {
          sideMode = 'refs';
          view = 'structure';
          editPath = null;
        } else {
          sideMode = 'module';
          moduleIndex = Number(btn.dataset.i);
          view = 'structure';
          editPath = null;
        }
        renderModuleList();
        renderEditor();
      });
    });
  }

  function renderEditor() {
    if (sideMode === 'refs') {
      renderReferencesView();
      return;
    }

    const mod = currentModule();
    if (!mod) {
      editor.innerHTML =
        '<p class="ops-empty">暂无模块。请点击左侧「+ 添加模块」，或从已有模块进入编辑。</p>';
      return;
    }
    if (!mod.chapters) mod.chapters = [];

    if (view === 'lesson' && editPath) {
      renderLessonView(mod);
      return;
    }
    renderStructureView(mod);
  }

  function renderReferencesView() {
    if (!Array.isArray(catalog.references)) catalog.references = [];
    const refs = catalog.references;

    editor.innerHTML = `
      <p class="ops-label">参考资料（与大模块并列）</p>
      <p class="ops-empty" style="margin-top:0;">在此维护全站参考书 / PDF，不归属某个学修模块。</p>
      <div class="ops-row">
        <button type="button" class="btn ops-mini" id="add-ref" style="color:inherit;border-color:var(--line);">+ 添加资料</button>
      </div>
      <div id="refs-box"></div>
    `;

    const box = $('refs-box');
    box.innerHTML = refs.length
      ? refs
          .map((ref, i) => {
            const url = assetUrl(ref.path);
            return `
              <div class="ops-tree-item ops-tree-item--chapter" data-ref-i="${i}">
                <div class="ops-tree-body" style="grid-column:1/-1;">
                  <label class="ops-field">标题<input data-ref="${i}:title" value="${escapeHtml(ref.title || '')}" /></label>
                  <label class="ops-field">说明 / 作者<input data-ref="${i}:meta" value="${escapeHtml(ref.meta || '')}" /></label>
                  <label class="ops-field">文件路径<input data-ref="${i}:path" value="${escapeHtml(ref.path || '')}" /></label>
                  ${
                    ref.path && url
                      ? `<div class="ops-preview"><a class="ops-preview-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">打开已上传文件</a></div>`
                      : ref.path
                        ? `<p class="ops-empty ops-empty--sm">已有路径，但未配置 PUBLIC_R2_BASE，无法预览。</p>`
                        : `<p class="ops-empty ops-empty--sm">尚未上传文件。</p>`
                  }
                  <div class="ops-upload-panel">
                    <input type="file" accept=".pdf,application/pdf" data-ref-upload="${i}" />
                    <div class="ops-upload-status" id="ref-upload-status-${i}" hidden></div>
                    <div class="ops-progress" id="ref-progress-${i}" hidden>
                      <div class="ops-progress-bar" id="ref-progress-bar-${i}"></div>
                    </div>
                  </div>
                  <div class="ops-tree-actions">
                    <button type="button" class="btn ops-mini" data-del-ref="${i}" style="color:inherit;border-color:var(--line);">删除</button>
                  </div>
                </div>
              </div>`;
          })
          .join('')
      : '<p class="ops-empty">暂无参考资料，请添加。</p>';

    $('add-ref')?.addEventListener('click', () => {
      refs.push({
        id: uid('ref'),
        title: `新资料 ${refs.length + 1}`,
        meta: '',
        path: '',
      });
      setDirty(true);
      renderReferencesView();
    });

    box.querySelectorAll('[data-ref]').forEach((input) => {
      input.addEventListener('input', () => {
        const [i, field] = input.dataset.ref.split(':');
        refs[Number(i)][field] = input.value;
        setDirty(true);
      });
    });

    box.querySelectorAll('[data-del-ref]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.delRef);
        if (!confirm('确定删除该参考资料？')) return;
        refs.splice(i, 1);
        setDirty(true);
        renderReferencesView();
      });
    });

    box.querySelectorAll('[data-ref-upload]').forEach((input) => {
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const i = Number(input.dataset.refUpload);
        const ref = refs[i];
        const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'pdf';
        const safe =
          file.name
            .replace(/\.[^.]+$/, '')
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 48) || `book-${uid('b')}`;
        const key = ref.path || `books/${safe}.${ext}`;
        ref.path = key;
        const status = $(`ref-upload-status-${i}`);
        const progress = $(`ref-progress-${i}`);
        const bar = $(`ref-progress-bar-${i}`);
        try {
          if (status) {
            status.hidden = false;
            status.textContent = `上传中：${file.name}`;
            status.classList.remove('is-error');
            status.classList.add('is-ok');
          }
          if (progress && bar) {
            progress.hidden = false;
            bar.style.width = '0%';
          }
          showMsg(saveMsg, '正在上传参考资料…', true);
          await uploadFile(key, file, (done, total) => {
            const pct = Math.min(100, Math.round((done / total) * 100));
            if (status) status.textContent = `上传中 ${pct}% · ${file.name}`;
            if (bar) bar.style.width = `${pct}%`;
          });
          if (status) status.textContent = `上传完成：${key}`;
          if (progress) progress.hidden = true;
          showMsg(saveMsg, '上传完成，正在自动保存…', true);
          await saveCatalog({ reason: `参考资料已上传并保存：${key}` });
          renderReferencesView();
        } catch (e) {
          if (status) {
            status.hidden = false;
            status.textContent = String(e.message || e);
            status.classList.add('is-error');
            status.classList.remove('is-ok');
          }
          if (progress) progress.hidden = true;
          showMsg(saveMsg, String(e.message || e), false);
        } finally {
          input.value = '';
        }
      });
    });
  }

  function renderStructureView(mod) {
    editor.innerHTML = `
      <div class="ops-row">
        <p class="ops-label" style="margin:0;flex:1;">模块设置</p>
        <span class="ops-move-btns">
          <button type="button" class="btn ops-mini ops-move" id="mod-move-up" title="模块上移" ${moduleIndex === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn ops-mini ops-move" id="mod-move-down" title="模块下移" ${moduleIndex >= catalog.modules.length - 1 ? 'disabled' : ''}>↓</button>
        </span>
        <button type="button" class="btn ops-mini" id="del-module" style="color:inherit;border-color:var(--line);">删除模块</button>
      </div>
      <label class="ops-field">标题<input data-mod="title" value="${escapeHtml(mod.title)}" /></label>
      <p class="ops-hint">系统标识：${escapeHtml(mod.slug || '')}（自动生成）</p>
      <label class="ops-field">状态
        <select data-mod="status">
          <option value="open" ${mod.status === 'open' ? 'selected' : ''}>开放中</option>
          <option value="coming" ${mod.status === 'coming' ? 'selected' : ''}>即将开放</option>
        </select>
      </label>
      <label class="ops-field">摘要<textarea data-mod="summary" rows="3">${escapeHtml(mod.summary || '')}</textarea></label>

      <div class="ops-row">
        <p class="ops-label" style="margin:0;flex:1;">课程结构（按住左侧 ⋮⋮ 拖动排序）</p>
        <button type="button" class="btn ops-mini" style="color:inherit;border-color:var(--line);" id="add-chapter">+ 添加章节</button>
      </div>
      <div id="chapters-box" class="ops-tree"></div>
    `;

    $('mod-move-up')?.addEventListener('click', () => {
      if (moduleIndex <= 0) return;
      moveInArray(catalog.modules, moduleIndex, moduleIndex - 1);
      moduleIndex -= 1;
      setDirty(true);
      renderModuleList();
      renderEditor();
    });
    $('mod-move-down')?.addEventListener('click', () => {
      if (moduleIndex >= catalog.modules.length - 1) return;
      moveInArray(catalog.modules, moduleIndex, moduleIndex + 1);
      moduleIndex += 1;
      setDirty(true);
      renderModuleList();
      renderEditor();
    });
    $('del-module')?.addEventListener('click', () => {
      if (!confirm(`确定删除模块「${mod.title}」及其全部章节与课？此操作保存后才会生效到服务器。`)) return;
      catalog.modules.splice(moduleIndex, 1);
      moduleIndex = Math.max(0, moduleIndex - 1);
      view = 'structure';
      editPath = null;
      setDirty(true);
      renderModuleList();
      renderEditor();
    });

    editor.querySelectorAll('[data-mod]').forEach((input) => {
      const onChange = () => {
        const key = input.getAttribute('data-mod');
        mod[key] = input.value;
        if (key === 'status') {
          mod.statusLabel = statusLabelFor(input.value);
        }
        // 简称/简介不再单独配置，与标题、摘要保持一致即可
        if (key === 'title') mod.shortTitle = input.value;
        if (key === 'summary') mod.intro = input.value;
        setDirty(true);
        if (key === 'title' || key === 'status') renderModuleList();
      };
      input.addEventListener('change', onChange);
      input.addEventListener('input', () => {
        const key = input.getAttribute('data-mod');
        if (key === 'status') return;
        mod[key] = input.value;
        if (key === 'title') mod.shortTitle = input.value;
        if (key === 'summary') mod.intro = input.value;
        setDirty(true);
        if (key === 'title') renderModuleList();
      });
    });

    // 打开编辑时校正状态文案
    mod.statusLabel = statusLabelFor(mod.status);

    $('add-chapter')?.addEventListener('click', () => {
      mod.chapters.push({
        id: uid('ch'),
        title: `新章节 ${mod.chapters.length + 1}`,
        lessons: [],
      });
      setDirty(true);
      renderEditor();
    });

    renderChapterTree(mod);
  }

  function renderChapterTree(mod) {
    const box = $('chapters-box');
    if (!box) return;

    if (!mod.chapters.length) {
      box.innerHTML = '<p class="ops-empty">暂无章节。例如可添加「闻法方式」「共同外前行」。</p>';
      return;
    }

    box.innerHTML = mod.chapters
      .map((ch, ci) => {
        if (!ch.id) ch.id = uid('ch');
        const lessonCount = (ch.lessons || []).length;
        const expanded = expandedChapterIds.has(ch.id);
        const lessons = expanded
          ? (ch.lessons || [])
              .map((les, li) => {
                return `
              <div class="ops-tree-item ops-tree-item--lesson" data-drag="lesson" data-ci="${ci}" data-li="${li}">
                <span class="ops-drag" role="button" tabindex="0" title="按住拖动排序" aria-label="拖动排序课次">⋮⋮</span>
                <div class="ops-tree-body">
                  <div class="ops-tree-line">
                    <strong class="ops-tree-label">课 ${li + 1}</strong>
                    <input class="ops-inline-input" data-les-title="${ci}:${li}" value="${escapeHtml(les.title)}" />
                    <span class="ops-badges">${lessonStatus(les)}</span>
                  </div>
                  <label class="ops-field ops-field--compact">摘要<input data-les-summary="${ci}:${li}" value="${escapeHtml(les.summary || '')}" /></label>
                  <div class="ops-tree-actions">
                    <button type="button" class="btn ops-mini ops-move-text" data-act="move-lesson" data-dir="-1" data-ci="${ci}" data-li="${li}" ${li === 0 ? 'disabled' : ''}>上移</button>
                    <button type="button" class="btn ops-mini ops-move-text" data-act="move-lesson" data-dir="1" data-ci="${ci}" data-li="${li}" ${li >= (ch.lessons || []).length - 1 ? 'disabled' : ''}>下移</button>
                    <button type="button" class="btn ops-mini" data-act="edit-lesson" data-ci="${ci}" data-li="${li}" style="color:inherit;border-color:var(--line);">编辑内容</button>
                    <button type="button" class="btn ops-mini" data-act="del-lesson" data-ci="${ci}" data-li="${li}" style="color:inherit;border-color:var(--line);">删除课</button>
                  </div>
                </div>
              </div>`;
              })
              .join('')
          : '';

        return `
          <div class="ops-tree-item ops-tree-item--chapter ${expanded ? 'is-expanded' : 'is-collapsed'}" data-drag="chapter" data-ci="${ci}" data-ch-id="${escapeHtml(ch.id)}">
            <span class="ops-drag" role="button" tabindex="0" title="按住拖动排序" aria-label="拖动排序章节">⋮⋮</span>
            <div class="ops-tree-body">
              <div class="ops-chapter-head">
                <div class="ops-chapter-head__main">
                  <strong class="ops-tree-label">章节 ${ci + 1}</strong>
                  <input class="ops-inline-input" data-ch-title="${ci}" value="${escapeHtml(ch.title)}" />
                  <span class="ops-chapter-count">${lessonCount} 课</span>
                </div>
                <button type="button" class="btn ops-mini" data-act="toggle-chapter" data-ci="${ci}" style="color:inherit;border-color:var(--line);">${expanded ? '收起课次' : '展开课次'}</button>
              </div>
              <div class="ops-tree-actions ops-chapter-actions">
                <button type="button" class="btn ops-mini ops-move-text" data-act="move-chapter" data-dir="-1" data-ci="${ci}" ${ci === 0 ? 'disabled' : ''}>上移</button>
                <button type="button" class="btn ops-mini ops-move-text" data-act="move-chapter" data-dir="1" data-ci="${ci}" ${ci >= mod.chapters.length - 1 ? 'disabled' : ''}>下移</button>
                ${expanded ? `<button type="button" class="btn ops-mini" data-act="add-lesson" data-ci="${ci}" style="color:inherit;border-color:var(--line);">+ 添加课</button>` : ''}
                <button type="button" class="btn ops-mini" data-act="del-chapter" data-ci="${ci}" style="color:inherit;border-color:var(--line);">删除章节</button>
              </div>
              ${
                expanded
                  ? `<div class="ops-tree-children" data-drop="lesson" data-ci="${ci}">
                ${lessons || '<p class="ops-empty ops-empty--sm">暂无课程，请添加。</p>'}
              </div>`
                  : ''
              }
            </div>
          </div>`;
      })
      .join('');

    box.querySelectorAll('[data-ch-title]').forEach((input) => {
      input.addEventListener('input', () => {
        mod.chapters[Number(input.dataset.chTitle)].title = input.value;
        setDirty(true);
      });
    });

    box.querySelectorAll('[data-les-title]').forEach((input) => {
      input.addEventListener('input', () => {
        const [ci, li] = input.dataset.lesTitle.split(':').map(Number);
        mod.chapters[ci].lessons[li].title = input.value;
        setDirty(true);
      });
    });

    box.querySelectorAll('[data-les-summary]').forEach((input) => {
      input.addEventListener('input', () => {
        const [ci, li] = input.dataset.lesSummary.split(':').map(Number);
        mod.chapters[ci].lessons[li].summary = input.value;
        setDirty(true);
      });
    });

    box.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ci = Number(btn.dataset.ci);
        const act = btn.dataset.act;

        if (act === 'toggle-chapter') {
          const ch = mod.chapters[ci];
          if (!ch?.id) return;
          if (expandedChapterIds.has(ch.id)) expandedChapterIds.delete(ch.id);
          else expandedChapterIds.add(ch.id);
          renderChapterTree(mod);
          return;
        }
        if (act === 'add-lesson') {
          const ch = mod.chapters[ci];
          if (ch?.id) expandedChapterIds.add(ch.id);
          const n = (ch.lessons ||= []).length + 1;
          const title = `第${n}课`;
          const slug = autoSlug(title, `lesson-${uid('l')}`);
          ch.lessons.push({
            id: uid('les'),
            slug,
            title,
            summary: '',
            text: '',
            audioPath: `${mod.slug}/${slug}.mp3`,
            videoPath: '',
          });
          setDirty(true);
          renderEditor();
        }
        if (act === 'del-chapter') {
          if (confirm('确定删除该章节及其下所有课？')) {
            const ch = mod.chapters[ci];
            if (ch?.id) expandedChapterIds.delete(ch.id);
            mod.chapters.splice(ci, 1);
            setDirty(true);
            renderEditor();
          }
        }
        if (act === 'del-lesson') {
          const li = Number(btn.dataset.li);
          if (confirm('确定删除该课？')) {
            mod.chapters[ci].lessons.splice(li, 1);
            setDirty(true);
            renderEditor();
          }
        }
        if (act === 'edit-lesson') {
          editPath = {
            ci,
            li: Number(btn.dataset.li),
          };
          view = 'lesson';
          renderEditor();
        }
        if (act === 'move-chapter') {
          const dir = Number(btn.dataset.dir);
          const to = ci + dir;
          if (to < 0 || to >= mod.chapters.length) return;
          moveInArray(mod.chapters, ci, to);
          setDirty(true);
          renderEditor();
        }
        if (act === 'move-lesson') {
          const li = Number(btn.dataset.li);
          const dir = Number(btn.dataset.dir);
          const list = mod.chapters[ci].lessons || [];
          const to = li + dir;
          if (to < 0 || to >= list.length) return;
          moveInArray(list, li, to);
          setDirty(true);
          renderEditor();
        }
      });
    });

    bindDragAndDrop(mod, box);
  }

  function bindDragAndDrop(mod, root) {
    let dragging = null;
    /** @type {'before' | 'after' | 'end'} */
    let dropPos = 'before';

    const clearDropMarks = () => {
      root.querySelectorAll('.is-drop-target, .is-drop-before, .is-drop-after').forEach((n) => {
        n.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
      });
    };

    root.querySelectorAll('[data-drag]').forEach((el) => {
      const handle = el.querySelector(':scope > .ops-drag');
      if (!handle) return;

      // 默认不可拖：避免点输入框/按钮时误触；仅按住把手时启用
      el.removeAttribute('draggable');

      const enableDrag = () => el.setAttribute('draggable', 'true');
      const disableDrag = () => el.removeAttribute('draggable');

      handle.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        enableDrag();
      });
      handle.addEventListener('pointerup', disableDrag);
      handle.addEventListener('pointercancel', disableDrag);

      el.addEventListener('dragstart', (e) => {
        if (el.getAttribute('draggable') !== 'true') {
          e.preventDefault();
          return;
        }
        dragging = {
          type: el.dataset.drag,
          ci: Number(el.dataset.ci),
          li: el.dataset.li != null ? Number(el.dataset.li) : null,
        };
        dropPos = 'before';
        el.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragging.type);
        // 透明拖影旁加一点偏移，避免挡住落点线
        try {
          e.dataTransfer.setDragImage(el, 24, 16);
        } catch (_) {}
        e.stopPropagation();
      });

      el.addEventListener('dragend', () => {
        disableDrag();
        el.classList.remove('is-dragging');
        clearDropMarks();
        dragging = null;
      });
    });

    root.querySelectorAll('[data-drag], [data-drop]').forEach((el) => {
      el.addEventListener('dragover', (e) => {
        if (!dragging) return;
        if (!isValidDropTarget(dragging, el)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        clearDropMarks();
        if (el.dataset.drop === 'lesson') {
          dropPos = 'end';
          el.classList.add('is-drop-target');
        } else {
          const rect = el.getBoundingClientRect();
          dropPos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
          el.classList.add('is-drop-target');
          el.classList.add(dropPos === 'before' ? 'is-drop-before' : 'is-drop-after');
        }
      });

      el.addEventListener('dragleave', (e) => {
        // 进入子元素时也会 leave，只有真正离开节点才清
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;
        el.classList.remove('is-drop-target', 'is-drop-before', 'is-drop-after');
      });

      el.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragging) return;
        if (!isValidDropTarget(dragging, el)) return;
        const from = dragging;
        const pos = dropPos;
        dragging = null;
        clearDropMarks();
        applyReorder(mod, from, el, pos);
        setDirty(true);
        renderEditor();
      });
    });
  }

  function isValidDropTarget(dragging, el) {
    const dragType = dragging.type;
    if (dragType === 'chapter') return el.dataset.drag === 'chapter';
    if (dragType === 'lesson') {
      return el.dataset.drag === 'lesson' || el.dataset.drop === 'lesson';
    }
    return false;
  }

  function moveInArray(arr, fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex > arr.length) return;
    const [item] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, item);
  }

  function applyReorder(mod, from, el, pos = 'before') {
    if (from.type === 'chapter' && el.dataset.drag === 'chapter') {
      let toCi = Number(el.dataset.ci);
      if (pos === 'after') toCi += 1;
      // 先移除，再按新下标插入
      if (from.ci < toCi) toCi -= 1;
      moveInArray(mod.chapters, from.ci, toCi);
      return;
    }

    if (from.type === 'lesson') {
      const srcList = mod.chapters[from.ci]?.lessons;
      if (!srcList) return;
      const [item] = srcList.splice(from.li, 1);
      if (!item) return;

      if (el.dataset.drop === 'lesson') {
        const toCi = Number(el.dataset.ci);
        (mod.chapters[toCi].lessons ||= []).push(item);
        return;
      }

      if (el.dataset.drag === 'lesson') {
        let toCi = Number(el.dataset.ci);
        let toLi = Number(el.dataset.li);
        if (pos === 'after') toLi += 1;
        // 同一章节内、从前往后拖时，源下标已 splice，目标需左移
        if (from.ci === toCi && from.li < toLi) toLi -= 1;
        (mod.chapters[toCi].lessons ||= []).splice(toLi, 0, item);
      }
    }
  }

  function renderLessonView(mod) {
    const { ci, li } = editPath;
    const ch = mod.chapters[ci];
    const les = ch?.lessons?.[li];
    if (!les) {
      view = 'structure';
      editPath = null;
      renderEditor();
      return;
    }

    const audioUrl = assetUrl(les.audioPath);
    const videoUrl = assetUrl(les.videoPath);
    const hasAudio = !!(les.audioPath && String(les.audioPath).trim());
    const hasVideo = !!(les.videoPath && String(les.videoPath).trim());

    editor.innerHTML = `
      <div class="ops-seg-page">
        <div class="ops-row" style="margin-top:0;">
          <button type="button" class="btn ops-mini" id="back-structure" style="color:inherit;border-color:var(--line);">← 返回结构</button>
          <p class="ops-crumb">${escapeHtml(ch.title)} / ${escapeHtml(les.title)}</p>
        </div>

        <p class="ops-label">课程内容</p>
        <label class="ops-field">文字<textarea id="les-text">${escapeHtml(les.text || '')}</textarea></label>

        <div class="ops-media-block" id="audio-block">
          <div class="ops-media-head">
            <p class="ops-label" style="margin:0;">音频</p>
            ${hasAudio ? '<span class="ops-status is-ok">已上传</span>' : '<span class="ops-status">未上传</span>'}
          </div>
          <label class="ops-field">存储路径<input id="les-audio-path" value="${escapeHtml(les.audioPath || '')}" /></label>
          ${
            hasAudio && audioUrl
              ? `<div class="ops-preview"><audio controls preload="metadata" src="${escapeHtml(audioUrl)}"></audio>
                   <a class="ops-preview-link" href="${escapeHtml(audioUrl)}" target="_blank" rel="noopener">打开链接</a></div>`
              : hasAudio
                ? `<p class="ops-empty ops-empty--sm">已有路径，但未配置 PUBLIC_R2_BASE，无法预览。</p>`
                : `<p class="ops-empty ops-empty--sm">尚未上传音频。</p>`
          }
          <div class="ops-upload-panel">
            <input type="file" accept="audio/*,.mp3" id="upload-audio" />
            <div class="ops-upload-status" id="audio-upload-status" hidden></div>
            <div class="ops-progress" id="audio-progress" hidden>
              <div class="ops-progress-bar" id="audio-progress-bar"></div>
            </div>
          </div>
        </div>

        <div class="ops-media-block" id="video-block">
          <div class="ops-media-head">
            <p class="ops-label" style="margin:0;">视频</p>
            ${hasVideo ? '<span class="ops-status is-ok">已上传</span>' : '<span class="ops-status">未上传</span>'}
          </div>
          <label class="ops-field">存储路径<input id="les-video-path" value="${escapeHtml(les.videoPath || '')}" /></label>
          ${
            hasVideo && videoUrl
              ? `<div class="ops-preview"><video controls playsinline webkit-playsinline x5-playsinline preload="metadata" src="${escapeHtml(videoUrl)}"></video>
                   <a class="ops-preview-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener">打开链接</a></div>`
              : hasVideo
                ? `<p class="ops-empty ops-empty--sm">已有路径，但未配置 PUBLIC_R2_BASE，无法预览。</p>`
                : `<p class="ops-empty ops-empty--sm">尚未上传视频。</p>`
          }
          <div class="ops-upload-panel">
            <label class="ops-check">
              <input type="checkbox" id="video-compress" />
              <span>上传前转 AAC 音轨（浏览器处理，大文件仍可能较慢）</span>
            </label>
            <label class="ops-check">
              <input type="checkbox" id="video-compress-deep" />
              <span>同时压画面到 720p（很慢，200MB 可能要几十分钟）</span>
            </label>
            <p class="ops-hint">
              建议：用小程序或电脑软件先转成 <strong>H.264 + AAC</strong> 再上传（更快、苹果微信才有声音）。
              上面两项为网页备用，默认不勾选；勾选后首次还需下载约 25MB 组件，大视频请耐心等待或改用软件处理。
            </p>
            <input type="file" accept="video/*,.mp4" id="upload-video" />
            <div class="ops-upload-status" id="video-upload-status" hidden></div>
            <div class="ops-progress" id="video-progress" hidden>
              <div class="ops-progress-bar" id="video-progress-bar"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    $('back-structure')?.addEventListener('click', () => {
      view = 'structure';
      editPath = null;
      renderEditor();
    });

    $('les-text')?.addEventListener('input', (e) => {
      les.text = e.target.value;
      setDirty(true);
    });
    $('les-audio-path')?.addEventListener('input', (e) => {
      les.audioPath = e.target.value;
      setDirty(true);
    });
    $('les-video-path')?.addEventListener('input', (e) => {
      les.videoPath = e.target.value;
      setDirty(true);
    });

    bindUpload('audio', mod, les);
    bindUpload('video', mod, les);
  }

  function setUploadUi(kind, { pct, text, ok, error }) {
    const status = $(`${kind}-upload-status`);
    const progress = $(`${kind}-progress`);
    const bar = $(`${kind}-progress-bar`);
    if (status) {
      status.hidden = !text;
      status.textContent = text || '';
      status.classList.toggle('is-ok', !!ok && !error);
      status.classList.toggle('is-error', !!error);
    }
    if (progress && bar) {
      if (pct == null) {
        progress.hidden = true;
      } else {
        progress.hidden = false;
        bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      }
    }
  }

  function bindUpload(kind, mod, les) {
    const input = $(`upload-${kind}`);
    if (!input) return;
    input.addEventListener('change', async () => {
      let file = input.files?.[0];
      if (!file) return;
      const field = kind === 'audio' ? 'audioPath' : 'videoPath';
      const wantCompress = kind === 'video' && $('video-compress')?.checked;
      const ext =
        kind === 'video'
          ? 'mp4'
          : file.name.includes('.')
            ? file.name.split('.').pop()
            : 'mp3';
      const key = les[field] || `${mod.slug}/${les.slug}.${ext}`;
      les[field] = key;

      try {
        if (wantCompress) {
          if (typeof window.JXCompressVideo !== 'function') {
            throw new Error('压缩组件尚未加载完成，请稍候再试，或取消勾选后直接上传。');
          }
          setUploadUi(kind, { pct: 0, text: '准备压缩…' });
          showMsg(saveMsg, '正在压缩视频（方便手机观看）…', true);
          const deep = !!$('video-compress-deep')?.checked;
          if (deep && file.size > 80 * 1024 * 1024) {
            const ok = confirm(
              `该视频约 ${(file.size / 1024 / 1024).toFixed(0)}MB。浏览器深度压缩会非常慢（可能几十分钟）。\n\n确定继续？\n选“取消”将改为只转 AAC 音轨（快很多）。`,
            );
            if (!ok) {
              const deepBox = $('video-compress-deep');
              if (deepBox) deepBox.checked = false;
            }
          }
          file = await window.JXCompressVideo(file, {
            deep: !!$('video-compress-deep')?.checked,
            onStatus: (text) => setUploadUi(kind, { pct: null, text }),
            onProgress: (pct) =>
              setUploadUi(kind, {
                pct,
                text: `处理中… ${pct}%（请勿关闭页面）`,
              }),
          });
        }

        setUploadUi(kind, {
          pct: 0,
          text: `准备上传：${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）`,
        });
        showMsg(saveMsg, `正在上传${kind === 'audio' ? '音频' : '视频'}…`, true);
        await uploadFile(key, file, (done, total) => {
          const pct = Math.min(100, Math.round((done / total) * 100));
          setUploadUi(kind, {
            pct,
            text: `上传中 ${pct}% · ${file.name}`,
          });
        });
        setUploadUi(kind, {
          pct: 100,
          text: `上传完成：${key}`,
          ok: true,
        });
        showMsg(saveMsg, '上传完成，正在自动保存目录…', true);
        await saveCatalog({ reason: `上传成功并已自动保存：${key}` });
        renderEditor();
        setUploadUi(kind, {
          pct: null,
          text: `上传完成并已保存：${key}`,
          ok: true,
        });
      } catch (e) {
        const msg = String(e.message || e);
        setUploadUi(kind, {
          pct: null,
          text: wantCompress
            ? `压缩失败：${msg}。可取消勾选「自动压缩」后直接上传原文件。`
            : msg,
          error: true,
        });
        showMsg(saveMsg, msg, false);
      } finally {
        input.value = '';
      }
    });
  }

  $('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: fd.get('password') }),
      });
      await ensureSession();
    } catch (err) {
      showMsg($('login-msg'), err.message, false);
    }
  });

  $('logout-btn')?.addEventListener('click', async () => {
    if (dirty && !confirm('有未保存修改，确定退出？')) return;
    await api('/api/logout', { method: 'POST' });
    await ensureSession();
  });

  $('btn-reload')?.addEventListener('click', () => {
    if (dirty && !confirm('有未保存修改，重新加载将丢失。继续？')) return;
    loadCatalog().catch((e) => showMsg(saveMsg, e.message, false));
  });

  $('btn-save')?.addEventListener('click', () => {
    saveCatalog().catch(() => {});
  });

  $('btn-add-module')?.addEventListener('click', () => {
    if (!catalog) {
      showMsg(saveMsg, '请先登录并加载目录', false);
      return;
    }
    addModule();
  });

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  ensureSession();
})();
