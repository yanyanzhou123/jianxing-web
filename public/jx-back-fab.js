(() => {
  if (window.__jxBackFabMounted) return;
  window.__jxBackFabMounted = true;

  const path = location.pathname || '';

  function determineBack() {
    const isModIndex = path === '/mod/' || path === '/mod/index.html';
    const isModLearn = path === '/mod/learn' || path === '/mod/learn/';

    if (isModIndex) {
      return { href: '/xuexiu/', label: '返回学修' };
    }
    if (isModLearn) {
      const qs = new URLSearchParams(location.search);
      const mod = qs.get('mod') || '';
      const href = mod
        ? (typeof JX !== 'undefined' && typeof JX.moduleHref === 'function'
          ? JX.moduleHref(mod)
          : `/mod/?id=${encodeURIComponent(mod)}`)
        : '/xuexiu/';
      return { href, label: '返回课次列表' };
    }
    return null;
  }

  const info = determineBack();
  if (!info) return;

  const a = document.createElement('a');
  a.className = 'jx-back-fab';
  a.href = info.href;
  a.setAttribute('aria-label', info.label);
  a.innerHTML = `<span aria-hidden="true">←</span><span class="jx-back-fab__label">${info.label}</span>`;
  document.body.appendChild(a);

  if (isModLearnPage()) {
    const moveToc = () => {
      const toc = document.querySelector('.learn-toc-fab');
      if (!toc) return;
      document.body.classList.add('has-back-fab');
    };
    if (document.querySelector('.learn-toc-fab')) {
      moveToc();
    } else {
      const obs = new MutationObserver(() => {
        if (document.querySelector('.learn-toc-fab')) {
          moveToc();
          obs.disconnect();
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 5000);
    }
  }

  function isModLearnPage() {
    return path.startsWith('/mod/learn');
  }
})();
