// Installation education only. Never requests permission, subscribes, or records
// a push-prompt conversion. iPhone and iPad native permissions stay inside PWA.
(() => {
  window.PushAppleInstall = { mount({ key, ipad = false, settings }) {
    const p = settings || { enabled: true, trigger: 'delay', delay: 15, scroll: 50, cooldown: 7, include_paths: [], exclude_paths: [], accent: '#12ad88', background: '#ffffff', text: '#25394b', logo: '' };
    const storageKey = `push-apple-install-dismissed:${key}`, matches = prefix => prefix === '/' || location.pathname === prefix || location.pathname.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    let dismissedUntil = 0, host, panel, timer, scrollHandler, visibilityHandler, shown = false, previousFocus, previousOverflow, previousPriority, modalOpen = false;
    try { dismissedUntil = Number(localStorage.getItem(storageKey)) || 0; } catch { /* Storage is optional. */ }
    const clear = () => { clearTimeout(timer); if (scrollHandler) window.removeEventListener('scroll', scrollHandler); if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler); };
    const hide = () => {
      clear();
      const restore = modalOpen || document.activeElement === host;
      if (panel?.open && typeof panel.close === 'function') panel.close();
      if (modalOpen && document.documentElement.style.getPropertyValue('overflow') === 'hidden') {
        if (previousOverflow) document.documentElement.style.setProperty('overflow', previousOverflow, previousPriority);
        else document.documentElement.style.removeProperty('overflow');
      }
      host?.remove(); host = null; modalOpen = false;
      if (restore && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const controller = { hide };
    if (!p.enabled || dismissedUntil > Date.now() || (p.include_paths.length && !p.include_paths.some(matches)) || p.exclude_paths.some(matches)) return controller;
    const show = () => {
      if (shown) return;
      if (document.hidden) { if (!visibilityHandler) { visibilityHandler = () => { if (!document.hidden) show(); }; document.addEventListener('visibilitychange', visibilityHandler); } return; }
      shown = true; clear(); previousFocus = document.activeElement;
      host = document.createElement('div'); host.setAttribute('data-push-apple-install', '');
      const root = host.attachShadow({ mode: 'open' }), style = document.createElement('style');
      style.textContent = `:host{all:initial;position:fixed;inset:0;z-index:2147483001;font:14px/1.6 system-ui,sans-serif;color:#25394b;pointer-events:none}*{box-sizing:border-box}dialog,section{font:inherit;color:inherit;pointer-events:auto;width:420px;max-width:calc(100vw - 28px);max-height:calc(100dvh - 32px);overflow:auto;border:1px solid #dce5e8;border-radius:18px;padding:24px;box-shadow:0 14px 55px #173d5140;background:#fff}dialog{inset:0;margin:auto}dialog::backdrop{background:#142d4d70}section{position:fixed;bottom:max(16px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%)}.brand{display:flex;gap:12px;align-items:center}.brand img{width:44px;height:44px;object-fit:contain;flex-shrink:0}h2{font-size:21px;line-height:1.35;margin:0;overflow-wrap:anywhere}p{margin:14px 0}ol{padding-left:22px;margin:16px 0}li{padding:5px 0}.note{font-size:12px;opacity:.8}.dismiss{display:block;width:100%;padding:12px 16px;border:0;border-radius:9px;color:white;background:#12ad88;font:600 14px system-ui,sans-serif;min-height:44px;cursor:pointer}.dismiss:focus-visible{outline:3px solid #5486e6;outline-offset:3px}a{color:inherit;text-underline-offset:3px}@media(prefers-reduced-motion:no-preference){dialog[open]{animation:appear .18s ease-out}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}`;
      root.appendChild(style);
      const make = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
      panel = make('dialog');
      // Older iOS can still display the instructions as a dismissible card.
      const nativeModal = typeof panel.showModal === 'function';
      if (!nativeModal) panel = make('section');
      panel.setAttribute('aria-label', 'Enable notifications on your Apple device'); panel.style.background = p.background; panel.style.color = p.text;
      const brand = make('div', '', 'brand');
      if (p.logo) { const logo = make('img'); logo.src = p.logo; logo.alt = ''; logo.referrerPolicy = 'no-referrer'; logo.addEventListener('error', () => logo.remove()); brand.appendChild(logo); }
      brand.appendChild(make('h2', `Get updates on your ${ipad ? 'iPad' : 'iPhone'}`)); panel.appendChild(brand);
      panel.appendChild(make('p', 'First add this website to your Home Screen. Then open it from the new icon to enable notifications.'));
      const steps = make('ol');
      for (const text of ['Open this website in Safari.', 'Tap Share, then Add to Home Screen. You may need to scroll the Share menu.', 'If Open as Web App appears, turn it on, then tap Add.', 'Open the new Home Screen icon. Tap Enable notifications there, then Allow.']) steps.appendChild(make('li', text));
      panel.appendChild(steps); panel.appendChild(make('p', 'Notifications work from the Home Screen app on iOS or iPadOS 16.4 or later.', 'note'));
      const help = make('a', 'Apple Home Screen setup instructions'); help.href = 'https://support.apple.com/guide/iphone/iphea86e5236/ios'; if (ipad) help.href = 'https://support.apple.com/guide/ipad/ipad8f1f7a29/ipados'; help.target = '_blank'; help.rel = 'noopener noreferrer'; panel.appendChild(make('p')).appendChild(help);
      const dismiss = make('button', 'Maybe later', 'dismiss'); dismiss.type = 'button'; dismiss.style.background = p.accent; dismiss.autofocus = true;
      dismiss.addEventListener('click', () => { try { localStorage.setItem(storageKey, String(Date.now() + p.cooldown * 86400000)); } catch { /* Best effort. */ } hide(); });
      panel.addEventListener('cancel', event => { event.preventDefault(); dismiss.click(); }); root.addEventListener('keydown', event => { if (!nativeModal && event.key === 'Escape') { event.preventDefault(); dismiss.click(); } });
      panel.appendChild(dismiss); root.appendChild(panel); document.body.appendChild(host);
      if (nativeModal) {
        previousOverflow = document.documentElement.style.getPropertyValue('overflow'); previousPriority = document.documentElement.style.getPropertyPriority('overflow');
        panel.showModal(); modalOpen = true; document.documentElement.style.setProperty('overflow', 'hidden');
      }
      dismiss.focus({ preventScroll: true });
    };
    if (p.trigger === 'scroll') { scrollHandler = () => { const height = document.documentElement.scrollHeight - window.innerHeight; if (height > 0 && window.scrollY / height * 100 >= p.scroll) show(); }; window.addEventListener('scroll', scrollHandler, { passive: true }); scrollHandler(); }
    else timer = setTimeout(show, p.delay * 1000);
    return controller;
  } };
})();
