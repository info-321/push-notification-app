// Site-owned pre-permission UI. Text is assigned with textContent, never HTML.
(() => {
  const css = `:host{all:initial;position:fixed;bottom:24px;right:24px;z-index:2147483000;font:14px/1.5 system-ui,sans-serif;color:#25394b;max-width:calc(100vw - 32px)}*{box-sizing:border-box}.card{width:360px;max-width:100%;padding:24px;border:1px solid #dce5e8;border-radius:16px;box-shadow:0 12px 45px #173d5133}.brand{display:flex;align-items:center;gap:12px;margin-bottom:12px}.brand img{width:46px;height:46px;object-fit:contain}.bell{font-size:26px}.heading{font-size:19px;font-weight:650;margin:0}.message{font-size:14px;margin:0 0 22px;line-height:1.6;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}button{font:600 14px/1.4 system-ui,sans-serif;cursor:pointer;border:0;border-radius:8px;padding:12px 16px;min-height:44px;overflow-wrap:anywhere}button:focus-visible{outline:3px solid #5486e6;outline-offset:3px}button:disabled{opacity:.65;cursor:wait}.allow{color:#fff;background:#12ad88}.dismiss{background:transparent;color:inherit}.floating{display:flex;align-items:center;gap:10px;box-shadow:0 5px 20px #173d5126}.status{font-size:12px;margin:12px 0 0}.close{margin-left:auto;padding:4px 10px;min-height:36px;background:transparent;color:inherit;font-size:21px}@media(prefers-reduced-motion:no-preference){.card,.floating{animation:appear .2s ease-out}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}`;
  const isPhone = nav => {
    const ua = nav.userAgent || '';
    if (/iPad|Tablet|Silk\/|Kindle/i.test(ua) || /Android/i.test(ua) && !/Mobile/i.test(ua) || /Macintosh/i.test(ua) && nav.maxTouchPoints > 1) return false;
    return /iPhone|iPod|Windows Phone|Mobile/i.test(ua) || nav.userAgentData?.mobile === true;
  };
  window.PushPermissionUI = { isPhone, mount({ settings: p, key, track, subscribe }) {
    const storageKey = `push-prompt-dismissed:${key}`;
    const pathMatches = prefix => prefix === '/' || location.pathname === prefix || location.pathname.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    let dismissedUntil = 0;
    try { dismissedUntil = Number(localStorage.getItem(storageKey)) || 0; } catch { /* Private browsing may disable storage. */ }
    let queue = Promise.resolve(), host, active = false, timer, scrollHandler, visibilityHandler;
    const event = (name, outcome) => { queue = queue.catch(() => {}).then(() => track(name, outcome)).catch(() => {}); return queue; };
    const clearTriggers = () => { clearTimeout(timer); if (scrollHandler) window.removeEventListener('scroll', scrollHandler); if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler); };
    const hide = () => { clearTriggers(); if (host) host.remove(); host = null; };
    const postpone = () => { try { localStorage.setItem(storageKey, String(Date.now() + p.cooldown * 86400000)); } catch { /* Best-effort local cooldown. */ } };
    const controller = { flush: () => queue, outcome(value) { event('permission', value); if (value !== 'granted') { postpone(); hide(); } }, hide };
    if (!p.enabled || isPhone(navigator) || dismissedUntil > Date.now() || (p.include_paths.length && !p.include_paths.some(pathMatches)) || p.exclude_paths.some(pathMatches)) return controller;
    const show = () => {
      if (active || Notification.permission === 'denied') { clearTriggers(); return; }
      if (document.hidden) {
        if (!visibilityHandler) { visibilityHandler = () => { if (!document.hidden) show(); }; document.addEventListener('visibilitychange', visibilityHandler); }
        return;
      }
      clearTriggers(); active = true;
      host = document.createElement('div'); host.setAttribute('data-push-permission-prompt', ''); host.style[p.position === 'left' ? 'left' : 'right'] = '24px'; if (p.position === 'left') host.style.right = 'auto';
      const root = host.attachShadow({ mode: 'open' }), style = document.createElement('style'); style.textContent = css + '.heading{min-width:0;overflow-wrap:anywhere}.brand img{flex-shrink:0}'; root.appendChild(style);
      const make = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
      const panel = make('section', '', p.template === 'button' ? 'floating' : 'card'); panel.setAttribute('aria-label', 'Notification subscription'); panel.style.background = p.background; panel.style.color = p.text;
      const allow = make('button', p.allow_label, 'allow'); allow.type = 'button'; allow.style.background = p.accent;
      const dismiss = make('button', p.template === 'button' ? '×' : p.dismiss_label, p.template === 'button' ? 'close' : 'dismiss'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', p.dismiss_label);
      if (p.template === 'button') { panel.appendChild(allow); panel.appendChild(dismiss); }
      else {
        const brand = make('div', '', 'brand');
        if (p.logo) { const image = make('img'); image.src = p.logo; image.alt = ''; image.referrerPolicy = 'no-referrer'; image.addEventListener('error', () => image.remove()); brand.appendChild(image); }
        else { const bell = make('span', '🔔', 'bell'); bell.setAttribute('aria-hidden', 'true'); brand.appendChild(bell); }
        brand.appendChild(make('h2', p.heading, 'heading')); panel.appendChild(brand); panel.appendChild(make('p', p.message, 'message'));
        const actions = make('div', '', 'actions'); actions.appendChild(allow); actions.appendChild(dismiss); panel.appendChild(actions);
      }
      const status = make('p', '', 'status'); status.setAttribute('role', 'status');
      dismiss.addEventListener('click', () => { event('dismiss'); postpone(); hide(); });
      root.addEventListener('keydown', event => { if (event.key === 'Escape' && !dismiss.disabled) { event.preventDefault(); dismiss.click(); } });
      allow.addEventListener('click', () => {
        if (allow.disabled) return;
        allow.disabled = true; dismiss.disabled = true; event('click');
        // Call synchronously within this gesture; telemetry never delays permission.
        subscribe().then(result => { if (result) hide(); }).catch(() => { status.textContent = 'Could not enable notifications. Please try again.'; panel.appendChild(status); }).finally(() => { allow.disabled = false; dismiss.disabled = false; });
      });
      root.appendChild(panel); document.body.appendChild(host); event('view');
      // Informational prompt: do not steal focus or trap the visitor on the page.
    };
    if (p.trigger === 'scroll') {
      scrollHandler = () => { const distance = document.documentElement.scrollHeight - innerHeight; if (distance > 0 && scrollY / distance * 100 >= p.scroll) show(); };
      window.addEventListener('scroll', scrollHandler, { passive: true }); scrollHandler();
    } else timer = setTimeout(show, p.delay * 1000);
    return controller;
  } };
})();
