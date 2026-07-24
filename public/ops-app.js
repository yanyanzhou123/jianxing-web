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
    if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
    return data;
  }

  const MULTIPART_THRESHOLD = 20 * 1024 * 1024;
  const PART_SIZE = 8 * 1024 * 1024;

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
        contentType: file.type || 'application/octet-stream',
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
    const { silent = false, reason = '' } = opts;
    if (saving) return;
    saving = true;
    try {
      if (!silent) showMsg(saveMsg, '保存中…', true);
      catalog.version = 4;
      if (!Array.isArray(catalog.references)) catalog.references = [];
      await api('/api/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(catalog),
      });
      setDirty(false);
      const msg = reason || '已保存。前台刷新即可看到变化。';
      showMsg(saveMsg, msg, true);
    } catch (e) {
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
    // 兼容：把仍挂在模块下的参考资料提到顶层（与接口 migrate 一致的前端兜底）
    for (const mod of catalog.modules) {
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
    }
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
      editor.innerHTML = '<p class="ops-empty">请选择左侧模块</p>';
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
      <p class="ops-label">模块设置</p>
      <label class="ops-field">标题<input data-mod="title" value="${escapeHtml(mod.title)}" /></label>
      <label class="ops-field">简称<input data-mod="shortTitle" value="${escapeHtml(mod.shortTitle || '')}" /></label>
      <label class="ops-field">状态
        <select data-mod="status">
          <option value="open" ${mod.status === 'open' ? 'selected' : ''}>开放</option>
          <option value="coming" ${mod.status === 'coming' ? 'selected' : ''}>即将开放</option>
        </select>
      </label>
      <label class="ops-field">状态文案<input data-mod="statusLabel" value="${escapeHtml(mod.statusLabel || '')}" /></label>
      <label class="ops-field">简介<textarea data-mod="intro">${escapeHtml(mod.intro || '')}</textarea></label>
      <label class="ops-field">摘要<input data-mod="summary" value="${escapeHtml(mod.summary || '')}" /></label>

      <div class="ops-row">
        <p class="ops-label" style="margin:0;flex:1;">课程结构（拖拽左侧把手排序）</p>
        <button type="button" class="btn ops-mini" style="color:inherit;border-color:var(--line);" id="add-chapter">+ 添加章节</button>
      </div>
      <div id="chapters-box" class="ops-tree"></div>
    `;

    editor.querySelectorAll('[data-mod]').forEach((input) => {
      const onChange = () => {
        const key = input.getAttribute('data-mod');
        mod[key] = input.value;
        if (key === 'status') {
          mod.statusLabel = input.value === 'open' ? '开放中' : '即将开放';
        }
        setDirty(true);
        if (key === 'title' || key === 'status') renderModuleList();
      };
      input.addEventListener('change', onChange);
      input.addEventListener('input', () => {
        const key = input.getAttribute('data-mod');
        if (key !== 'status') mod[key] = input.value;
        setDirty(true);
        if (key === 'title') renderModuleList();
      });
    });

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
        const lessons = (ch.lessons || [])
          .map((les, li) => {
            return `
              <div class="ops-tree-item ops-tree-item--lesson" draggable="true" data-drag="lesson" data-ci="${ci}" data-li="${li}">
                <span class="ops-drag" title="拖拽排序" aria-hidden="true">⋮⋮</span>
                <div class="ops-tree-body">
                  <div class="ops-tree-line">
                    <strong class="ops-tree-label">课 ${li + 1}</strong>
                    <input class="ops-inline-input" data-les-title="${ci}:${li}" value="${escapeHtml(les.title)}" />
                    <span class="ops-badges">${lessonStatus(les)}</span>
                  </div>
                  <label class="ops-field ops-field--compact">摘要<input data-les-summary="${ci}:${li}" value="${escapeHtml(les.summary || '')}" /></label>
                  <div class="ops-tree-actions">
                    <button type="button" class="btn ops-mini" data-act="edit-lesson" data-ci="${ci}" data-li="${li}" style="color:inherit;border-color:var(--line);">编辑内容</button>
                    <button type="button" class="btn ops-mini" data-act="del-lesson" data-ci="${ci}" data-li="${li}" style="color:inherit;border-color:var(--line);">删除课</button>
                  </div>
                </div>
              </div>`;
          })
          .join('');

        return `
          <div class="ops-tree-item ops-tree-item--chapter" draggable="true" data-drag="chapter" data-ci="${ci}">
            <span class="ops-drag" title="拖拽排序" aria-hidden="true">⋮⋮</span>
            <div class="ops-tree-body">
              <div class="ops-tree-line">
                <strong class="ops-tree-label">章节 ${ci + 1}</strong>
                <input class="ops-inline-input" data-ch-title="${ci}" value="${escapeHtml(ch.title)}" />
              </div>
              <div class="ops-tree-actions">
                <button type="button" class="btn ops-mini" data-act="add-lesson" data-ci="${ci}" style="color:inherit;border-color:var(--line);">+ 添加课</button>
                <button type="button" class="btn ops-mini" data-act="del-chapter" data-ci="${ci}" style="color:inherit;border-color:var(--line);">删除章节</button>
              </div>
              <div class="ops-tree-children" data-drop="lesson" data-ci="${ci}">
                ${lessons || '<p class="ops-empty ops-empty--sm">暂无课程，请添加。</p>'}
              </div>
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

        if (act === 'add-lesson') {
          const n = (mod.chapters[ci].lessons ||= []).length + 1;
          const title = `第${n}课`;
          const slug = autoSlug(title, `lesson-${uid('l')}`);
          mod.chapters[ci].lessons.push({
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
      });
    });

    bindDragAndDrop(mod, box);
  }

  function bindDragAndDrop(mod, root) {
    let dragging = null;

    root.querySelectorAll('[data-drag]').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        // Only drag from the handle, so editing titles won't start a drag
        if (!e.target.closest('.ops-drag')) {
          e.preventDefault();
          return;
        }
        dragging = {
          type: el.dataset.drag,
          ci: Number(el.dataset.ci),
          li: el.dataset.li != null ? Number(el.dataset.li) : null,
        };
        el.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragging.type);
        e.stopPropagation();
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('is-dragging');
        root.querySelectorAll('.is-drop-target').forEach((n) => n.classList.remove('is-drop-target'));
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
        el.classList.add('is-drop-target');
      });
      el.addEventListener('dragleave', () => el.classList.remove('is-drop-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('is-drop-target');
        if (!dragging) return;
        if (!isValidDropTarget(dragging, el)) return;
        applyReorder(mod, dragging, el);
        dragging = null;
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
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const [item] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, item);
  }

  function applyReorder(mod, from, el) {
    if (from.type === 'chapter' && el.dataset.drag === 'chapter') {
      const toCi = Number(el.dataset.ci);
      moveInArray(mod.chapters, from.ci, toCi);
      return;
    }

    if (from.type === 'lesson') {
      const item = mod.chapters[from.ci].lessons.splice(from.li, 1)[0];
      if (!item) return;

      if (el.dataset.drop === 'lesson') {
        const toCi = Number(el.dataset.ci);
        mod.chapters[toCi].lessons.push(item);
        return;
      }

      if (el.dataset.drag === 'lesson') {
        let toCi = Number(el.dataset.ci);
        let toLi = Number(el.dataset.li);
        // After removal, adjust index when moving within same chapter downward
        if (from.ci === toCi && from.li < toLi) toLi -= 1;
        mod.chapters[toCi].lessons.splice(toLi, 0, item);
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
              ? `<div class="ops-preview"><video controls preload="metadata" src="${escapeHtml(videoUrl)}"></video>
                   <a class="ops-preview-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener">打开链接</a></div>`
              : hasVideo
                ? `<p class="ops-empty ops-empty--sm">已有路径，但未配置 PUBLIC_R2_BASE，无法预览。</p>`
                : `<p class="ops-empty ops-empty--sm">尚未上传视频。</p>`
          }
          <div class="ops-upload-panel">
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
      const file = input.files?.[0];
      if (!file) return;
      const field = kind === 'audio' ? 'audioPath' : 'videoPath';
      const ext = file.name.includes('.')
        ? file.name.split('.').pop()
        : kind === 'audio'
          ? 'mp3'
          : 'mp4';
      const key = les[field] || `${mod.slug}/${les.slug}.${ext}`;
      les[field] = key;

      try {
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
        // refresh preview while staying on lesson page
        renderEditor();
        setUploadUi(kind, {
          pct: null,
          text: `上传完成并已保存：${key}`,
          ok: true,
        });
      } catch (e) {
        setUploadUi(kind, {
          pct: null,
          text: String(e.message || e),
          error: true,
        });
        showMsg(saveMsg, String(e.message || e), false);
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

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  ensureSession();
})();
