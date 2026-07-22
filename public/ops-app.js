(() => {
  const $ = (id) => document.getElementById(id);
  const loginBox = $('ops-login');
  const appBox = $('ops-app');
  const moduleList = $('module-list');
  const editor = $('module-editor');
  const saveMsg = $('save-msg');

  let catalog = null;
  let moduleIndex = 0;

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /** 自动生成 URL 标识，运营无需填写 */
  function autoSlug(title, fallback) {
    const base = String(title || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    // 含中文时用随机稳定 id，避免 URL 难写
    if (!base || /[\u4e00-\u9fff]/.test(base)) {
      return fallback || `lesson-${uid('l')}`;
    }
    return base.slice(0, 48) || fallback || `lesson-${uid('l')}`;
  }

  function showMsg(el, text, ok) {
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle('is-ok', !!ok);
    el.classList.toggle('is-error', !ok);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
    return data;
  }

  /** 大于此大小用分片上传（每片 8MB，可传数 GB 视频） */
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
    renderModuleList();
    renderEditor();
  }

  function currentModule() {
    return catalog?.modules?.[moduleIndex] || null;
  }

  function renderModuleList() {
    moduleList.innerHTML = catalog.modules
      .map(
        (m, i) =>
          `<li><button type="button" data-i="${i}" class="${i === moduleIndex ? 'is-active' : ''}">${escapeHtml(m.title)}</button></li>`,
      )
      .join('');
    moduleList.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        moduleIndex = Number(btn.dataset.i);
        renderModuleList();
        renderEditor();
      });
    });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderEditor() {
    const mod = currentModule();
    if (!mod) {
      editor.innerHTML = '<p class="ops-empty">请选择左侧模块</p>';
      return;
    }
    if (!mod.chapters) mod.chapters = [];
    if (!mod.references) mod.references = [];

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
        <p class="ops-label" style="margin:0;flex:1;">章节（课程结构）</p>
        <button type="button" class="btn ops-mini" style="color:inherit;border-color:var(--line);" id="add-chapter">+ 添加章节</button>
      </div>
      <div id="chapters-box"></div>
    `;

    editor.querySelectorAll('[data-mod]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.getAttribute('data-mod');
        mod[key] = input.value;
        if (key === 'status') {
          mod.statusLabel = input.value === 'open' ? '开放中' : '即将开放';
        }
        renderModuleList();
      });
      input.addEventListener('input', () => {
        const key = input.getAttribute('data-mod');
        if (key !== 'status') mod[key] = input.value;
        if (key === 'title') renderModuleList();
      });
    });

    $('add-chapter')?.addEventListener('click', () => {
      mod.chapters.push({
        id: uid('ch'),
        title: `新章节 ${mod.chapters.length + 1}`,
        lessons: [],
      });
      renderEditor();
    });

    renderChapters(mod);
  }

  function renderChapters(mod) {
    const box = $('chapters-box');
    if (!box) return;
    box.innerHTML = mod.chapters
      .map((ch, ci) => {
        const lessonsHtml = (ch.lessons || [])
          .map((les, li) => renderLessonCard(mod, ch, ci, les, li))
          .join('');
        return `
          <div class="ops-card" data-ci="${ci}">
            <div class="ops-card-head">
              <h3>章节 ${ci + 1}</h3>
              <div class="ops-row" style="margin:0;">
                <button type="button" class="btn ops-mini" data-act="add-lesson" data-ci="${ci}" style="color:inherit;border-color:var(--line);">+ 添加课</button>
                <button type="button" class="btn ops-mini" data-act="del-chapter" data-ci="${ci}" style="color:inherit;border-color:var(--line);">删除章节</button>
              </div>
            </div>
            <label class="ops-field">章节标题<input data-ch-title="${ci}" value="${escapeHtml(ch.title)}" /></label>
            ${lessonsHtml || '<p class="ops-empty">暂无课程，请添加。</p>'}
          </div>`;
      })
      .join('') || '<p class="ops-empty">暂无章节。例如可添加「闻法方式」「共同外前行」。</p>';

    box.querySelectorAll('[data-ch-title]').forEach((input) => {
      input.addEventListener('input', () => {
        mod.chapters[Number(input.dataset.chTitle)].title = input.value;
      });
    });

    box.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
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
            segments: [
              {
                id: uid('seg'),
                title: '小节1',
                text: '',
                audioPath: `${mod.slug}/${slug}/seg-1.mp3`,
                videoPath: '',
              },
            ],
          });
          renderEditor();
        }
        if (act === 'del-chapter') {
          if (confirm('确定删除该章节及其下所有课？')) {
            mod.chapters.splice(ci, 1);
            renderEditor();
          }
        }
        if (act === 'del-lesson') {
          const li = Number(btn.dataset.li);
          if (confirm('确定删除该课？')) {
            mod.chapters[ci].lessons.splice(li, 1);
            renderEditor();
          }
        }
        if (act === 'add-seg') {
          const li = Number(btn.dataset.li);
          const les = mod.chapters[ci].lessons[li];
          const n = (les.segments ||= []).length + 1;
          les.segments.push({
            id: uid('seg'),
            title: `小节${n}`,
            text: '',
            audioPath: `${mod.slug}/${les.slug}/seg-${n}.mp3`,
            videoPath: `${mod.slug}/${les.slug}/seg-${n}.mp4`,
          });
          renderEditor();
        }
        if (act === 'del-seg') {
          const li = Number(btn.dataset.li);
          const si = Number(btn.dataset.si);
          mod.chapters[ci].lessons[li].segments.splice(si, 1);
          renderEditor();
        }
      });
    });

    bindLessonFields(mod);
  }

  function renderLessonCard(mod, ch, ci, les, li) {
    const segs = (les.segments || [])
      .map((seg, si) => renderSegment(mod, ci, li, seg, si))
      .join('');
    return `
      <div class="ops-card" style="background:rgba(255,255,255,0.55);">
        <div class="ops-card-head">
          <h4>课 ${li + 1}</h4>
          <div class="ops-row" style="margin:0;">
            <button type="button" class="btn ops-mini" data-act="add-seg" data-ci="${ci}" data-li="${li}" style="color:inherit;border-color:var(--line);">+ 小节</button>
            <button type="button" class="btn ops-mini" data-act="del-lesson" data-ci="${ci}" data-li="${li}" style="color:inherit;border-color:var(--line);">删除课</button>
          </div>
        </div>
        <label class="ops-field">课标题<input data-les="${ci}:${li}:title" value="${escapeHtml(les.title)}" /></label>
        <label class="ops-field">摘要<input data-les="${ci}:${li}:summary" value="${escapeHtml(les.summary || '')}" /></label>
        ${segs}
      </div>`;
  }

  function renderSegment(mod, ci, li, seg, si) {
    return `
      <div class="ops-seg">
        <div class="ops-card-head">
          <strong>${escapeHtml(seg.title || `小节${si + 1}`)}</strong>
          <button type="button" class="btn ops-mini" data-act="del-seg" data-ci="${ci}" data-li="${li}" data-si="${si}" style="color:inherit;border-color:var(--line);">删除小节</button>
        </div>
        <label class="ops-field">小节标题<input data-seg="${ci}:${li}:${si}:title" value="${escapeHtml(seg.title)}" /></label>
        <label class="ops-field">文字<textarea data-seg="${ci}:${li}:${si}:text">${escapeHtml(seg.text || '')}</textarea></label>
        <label class="ops-field">音频路径
          <input data-seg="${ci}:${li}:${si}:audioPath" value="${escapeHtml(seg.audioPath || '')}" />
          <div class="ops-upload-line">
            <input type="file" accept="audio/*,.mp3" data-upload="${ci}:${li}:${si}:audio" />
            <span class="ops-path">上传后自动写入路径</span>
          </div>
        </label>
        <label class="ops-field">视频路径
          <input data-seg="${ci}:${li}:${si}:videoPath" value="${escapeHtml(seg.videoPath || '')}" />
          <div class="ops-upload-line">
            <input type="file" accept="video/*,.mp4" data-upload="${ci}:${li}:${si}:video" />
            <span class="ops-path">上传后自动写入路径</span>
          </div>
        </label>
      </div>`;
  }

  function bindLessonFields(mod) {
    editor.querySelectorAll('[data-les]').forEach((input) => {
      input.addEventListener('input', () => {
        const [ci, li, field] = input.dataset.les.split(':');
        mod.chapters[ci].lessons[li][field] = input.value;
      });
    });
    editor.querySelectorAll('[data-seg]').forEach((input) => {
      input.addEventListener('input', () => {
        const [ci, li, si, field] = input.dataset.seg.split(':');
        mod.chapters[ci].lessons[li].segments[si][field] = input.value;
      });
    });
    editor.querySelectorAll('[data-upload]').forEach((input) => {
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const [ci, li, si, kind] = input.dataset.upload.split(':');
        const les = mod.chapters[ci].lessons[li];
        const seg = les.segments[si];
        const ext = file.name.includes('.') ? file.name.split('.').pop() : kind === 'audio' ? 'mp3' : 'mp4';
        const field = kind === 'audio' ? 'audioPath' : 'videoPath';
        const key =
          seg[field] ||
          `${mod.slug}/${les.slug}/seg-${Number(si) + 1}.${ext}`;
        seg[field] = key;
        try {
          showMsg(saveMsg, `上传中：${key}（${(file.size / 1024 / 1024).toFixed(1)} MB）`, true);
          await uploadFile(key, file, (done, total) => {
            const pct = Math.min(100, Math.round((done / total) * 100));
            showMsg(saveMsg, `上传中 ${pct}% · ${key}`, true);
          });
          showMsg(saveMsg, `上传成功：${key}`, true);
          renderEditor();
        } catch (e) {
          showMsg(saveMsg, String(e.message || e), false);
        }
      });
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
    await api('/api/logout', { method: 'POST' });
    await ensureSession();
  });

  $('btn-reload')?.addEventListener('click', () => loadCatalog().catch((e) => showMsg(saveMsg, e.message, false)));

  $('btn-save')?.addEventListener('click', async () => {
    try {
      showMsg(saveMsg, '保存中…', true);
      catalog.version = 2;
      await api('/api/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(catalog),
      });
      showMsg(saveMsg, '已保存。前台刷新即可看到结构变化。', true);
    } catch (e) {
      showMsg(saveMsg, e.message, false);
    }
  });

  ensureSession();
})();
