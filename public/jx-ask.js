(() => {
  if (window.__jxAskMounted) return;
  window.__jxAskMounted = true;

  const path = location.pathname || '';
  if (path.startsWith('/ops')) return;

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function currentContext() {
    const qs = new URLSearchParams(location.search);
    return {
      moduleSlug: qs.get('mod') || '',
      lessonSlug: qs.get('id') || '',
    };
  }

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'jx-ask-fab';
  fab.setAttribute('aria-label', '打开学修问答');
  fab.textContent = '问';

  const panel = document.createElement('div');
  panel.className = 'jx-ask-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="jx-ask-head">
      <strong>学修问答</strong>
      <button type="button" class="jx-ask-close" aria-label="关闭">×</button>
    </div>
    <div class="jx-ask-body">
      <p class="jx-ask-hint">根据本站已录入的课本文字检索作答。回答仅供参考，请以原文与录音为准。</p>
      <textarea class="jx-ask-input" maxlength="500" placeholder="请输入你的问题，例如：什么是暇满人身？"></textarea>
      <div class="jx-ask-actions">
        <button type="button" class="jx-ask-submit">提问</button>
      </div>
      <p class="jx-ask-error" hidden></p>
      <div class="jx-ask-result" hidden></div>
      <ul class="jx-ask-sources" hidden></ul>
      <p class="jx-ask-foot">AI 辅助学修，不能替代依止与如理闻思。</p>
    </div>
  `;

  const input = panel.querySelector('.jx-ask-input');
  const submit = panel.querySelector('.jx-ask-submit');
  const errEl = panel.querySelector('.jx-ask-error');
  const resultEl = panel.querySelector('.jx-ask-result');
  const sourcesEl = panel.querySelector('.jx-ask-sources');
  const closeBtn = panel.querySelector('.jx-ask-close');

  function setOpen(open) {
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) setTimeout(() => input.focus(), 50);
  }

  fab.addEventListener('click', () => setOpen(panel.hidden));
  closeBtn.addEventListener('click', () => setOpen(false));

  async function ask() {
    const question = String(input.value || '').trim();
    errEl.hidden = true;
    resultEl.hidden = true;
    sourcesEl.hidden = true;
    sourcesEl.innerHTML = '';
    if (!question) {
      errEl.textContent = '请先输入问题';
      errEl.hidden = false;
      return;
    }

    submit.disabled = true;
    submit.textContent = '检索中…';
    const ctx = currentContext();

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          moduleSlug: ctx.moduleSlug || undefined,
          lessonSlug: ctx.lessonSlug || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);

      resultEl.textContent = data.answer || '';
      resultEl.hidden = !data.answer;

      if (Array.isArray(data.sources) && data.sources.length) {
        sourcesEl.innerHTML = data.sources
          .map((s) => {
            const label = `${escapeHtml(s.moduleTitle)} · ${escapeHtml(s.lessonTitle)}`;
            return `<li>出处：<a href="${escapeHtml(s.href)}">${label}</a></li>`;
          })
          .join('');
        sourcesEl.hidden = false;
      }
    } catch (e) {
      errEl.textContent = e.message || String(e);
      errEl.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = '提问';
    }
  }

  submit.addEventListener('click', ask);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ask();
    }
  });

  document.body.appendChild(panel);
  document.body.appendChild(fab);
})();
