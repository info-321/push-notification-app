// Site-owned pre-permission UI. Text is assigned with textContent, never HTML.
(() => {
  const css = `:host{all:initial;position:fixed;bottom:24px;right:24px;z-index:2147483000;font:14px/1.5 system-ui,sans-serif;color:#25394b;max-width:calc(100vw - 32px)}*{box-sizing:border-box}.card{width:360px;max-width:100%;padding:24px;border:1px solid #dce5e8;border-radius:16px;box-shadow:0 12px 45px #173d5133}.brand{display:flex;align-items:center;gap:12px;margin-bottom:12px}.brand img{width:46px;height:46px;object-fit:contain}.bell{font-size:26px}.heading{font-size:19px;font-weight:650;margin:0}.message{font-size:14px;margin:0 0 22px;line-height:1.6;overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}button{font:600 14px/1.4 system-ui,sans-serif;cursor:pointer;border:0;border-radius:8px;padding:12px 16px;min-height:44px;overflow-wrap:anywhere}button:focus-visible{outline:3px solid #5486e6;outline-offset:3px}button:disabled{opacity:.65;cursor:wait}.allow{color:#fff;background:#12ad88}.dismiss{background:transparent;color:inherit}.floating{display:flex;align-items:center;gap:10px;box-shadow:0 5px 20px #173d5126}.status{font-size:12px;margin:12px 0 0}.close{margin-left:auto;padding:4px 10px;min-height:36px;background:transparent;color:inherit;font-size:21px}@media(prefers-reduced-motion:no-preference){.card,.floating{animation:appear .2s ease-out}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}`;
  const isPhone = nav => {
    const ua = nav.userAgent || '';
    if (/iPad|Tablet|Silk\/|Kindle/i.test(ua) || /Android/i.test(ua) && !/Mobile/i.test(ua) || /Macintosh/i.test(ua) && nav.maxTouchPoints > 1) return false;
    return /iPhone|iPod|Windows Phone|Mobile/i.test(ua) || nav.userAgentData?.mobile === true;
  };
  const templateCss = `
    [hidden]{display:none!important}.heading{min-width:0;overflow-wrap:anywhere}.brand img{flex-shrink:0}
    .dialog{width:480px;border-radius:5px;padding:18px 22px}.dialog .brand{margin-bottom:6px}.dialog .heading{font-size:16px}.dialog .message{margin-left:58px;font-size:12px;margin-bottom:10px}.dialog .actions{justify-content:flex-end}.dialog button{padding:9px 16px}
    dialog.card{font:14px/1.5 system-ui,sans-serif;inset:0;margin:auto;max-width:calc(100vw - 40px);max-height:calc(100dvh - 40px);overflow:auto;color:inherit}
    dialog::backdrop{background:#142d4d70}.modal{width:420px;padding:34px;border-radius:14px}.modal .brand{flex-direction:column;align-items:flex-start}.modal .heading{font-size:23px}.modal .message{margin:18px 0 28px}
    dialog.fullscreen{width:100vw;height:100dvh;max-width:none;max-height:none;border:0;border-radius:0;padding:40px;box-shadow:none}
    dialog.fullscreen[open]{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:16px}
    .fullscreen .brand{flex-direction:column;margin:0;max-width:760px}.fullscreen .heading{font-size:clamp(22px,3vw,34px);font-weight:500}.fullscreen .message{max-width:700px;font-size:17px;margin:0 0 18px}.fullscreen .actions{justify-content:center;gap:24px}.fullscreen .allow{min-width:150px;border-radius:24px}
    .sticky-tab{display:block;writing-mode:vertical-rl;border-radius:8px 0 0 8px;box-shadow:0 5px 22px #173d5130;padding:18px 12px;background:#12ad88;color:white;max-height:calc(100dvh - 40px)}
    :host([data-edge=left]) .sticky-tab{border-radius:0 8px 8px 0}.sticky.card{max-height:calc(100dvh - 40px);overflow:auto}
  `;
  const mobileCss = `
    :host([data-device=mobile]){max-width:calc(100vw - 24px)}
    :host([data-device=mobile]) .card{width:360px;max-width:100%;padding:18px;font-size:13px}
    :host([data-device=mobile]) .heading{font-size:18px}:host([data-device=mobile]) .message{font-size:13px}
    :host([data-device=mobile]) .dialog{border-radius:6px;max-height:calc(100dvh - 32px);overflow:auto}
    :host([data-device=mobile]) .dialog .heading{font-size:14px}:host([data-device=mobile]) .dialog .brand{gap:10px}:host([data-device=mobile]) .dialog .message{margin-left:56px;font-size:12px}
    :host([data-device=mobile]) .modal{max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);padding:24px}
    :host([data-device=mobile]) .fullscreen{width:100vw;max-width:none;padding:24px max(20px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}
    :host([data-device=mobile]) .fullscreen .heading{font-size:24px}:host([data-device=mobile]) .fullscreen .message{font-size:15px}
    :host([data-device=mobile]) .header,:host([data-device=mobile]) .slide-up{width:100vw;max-width:none;border-radius:0;padding:18px max(18px,env(safe-area-inset-right)) 18px max(18px,env(safe-area-inset-left));max-height:70dvh;overflow:auto}
    :host([data-device=mobile]) .header{padding-top:max(18px,env(safe-area-inset-top))}
    :host([data-device=mobile]) .slide-up{border-radius:14px 14px 0 0;padding-bottom:max(18px,env(safe-area-inset-bottom))}
    :host([data-device=mobile]) .header .brand,:host([data-device=mobile]) .slide-up .brand{margin-bottom:8px}
    :host([data-device=mobile]) .header .actions,:host([data-device=mobile]) .slide-up .actions{justify-content:center}
    @media(prefers-reduced-motion:no-preference){:host([data-device=mobile]) .slide-up{animation:mobile-slide .25s ease-out}@keyframes mobile-slide{from{transform:translateY(100%)}to{transform:translateY(0)}}}
  `;
  window.PushPermissionUI = { isPhone, mount({ settings: p, key, device = 'large', track, subscribe }) {
    const mobile = device === 'mobile';
    const storageKey = `push-prompt-dismissed:${key}${mobile ? ':mobile' : ''}`;
    const pathMatches = prefix => prefix === '/' || location.pathname === prefix || location.pathname.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    let dismissedUntil = 0;
    try { dismissedUntil = Number(localStorage.getItem(storageKey)) || 0; } catch { /* Private browsing may disable storage. */ }
    let queue = Promise.resolve(), host, panel, active = false, timer, scrollHandler, visibilityHandler, previousFocus, previousOverflow, previousOverflowPriority, modalOpen = false;
    const event = (name, outcome) => { queue = queue.catch(() => {}).then(() => track(name, outcome)).catch(() => {}); return queue; };
    const clearTriggers = () => { clearTimeout(timer); if (scrollHandler) window.removeEventListener('scroll', scrollHandler); if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler); };
    const hide = () => {
      clearTriggers();
      const restoreFocus = modalOpen || document.activeElement === host;
      if (panel?.open && typeof panel.close === 'function') panel.close();
      if (modalOpen && document.documentElement.style.getPropertyValue('overflow') === 'hidden') {
        if (previousOverflow) document.documentElement.style.setProperty('overflow', previousOverflow, previousOverflowPriority);
        else document.documentElement.style.removeProperty('overflow');
      }
      modalOpen = false;
      if (host) host.remove(); host = null;
      if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const postpone = () => { try { localStorage.setItem(storageKey, String(Date.now() + p.cooldown * 86400000)); } catch { /* Best-effort local cooldown. */ } };
    const controller = { flush: () => queue, outcome(value) { event('permission', value); if (value !== 'granted') { postpone(); hide(); } }, hide };
    if (!p.enabled || isPhone(navigator) !== mobile || dismissedUntil > Date.now() || (p.include_paths.length && !p.include_paths.some(pathMatches)) || p.exclude_paths.some(pathMatches)) return controller;
    const show = () => {
      if (active || Notification.permission === 'denied') { clearTriggers(); return; }
      if (document.hidden) {
        if (!visibilityHandler) { visibilityHandler = () => { if (!document.hidden) show(); }; document.addEventListener('visibilitychange', visibilityHandler); }
        return;
      }
      clearTriggers(); active = true;
      previousFocus = document.activeElement;
      host = document.createElement('div'); host.setAttribute('data-push-permission-prompt', ''); host.style[p.position === 'left' ? 'left' : 'right'] = '24px'; if (p.position === 'left') host.style.right = 'auto';
      host.setAttribute('data-template', p.template); host.setAttribute('data-edge', p.position);
      host.setAttribute('data-device', device);
      if (p.template === 'dialog') { host.style.top = mobile ? 'auto' : '20px'; host.style.bottom = mobile ? 'max(14px, env(safe-area-inset-bottom))' : 'auto'; host.style.left = '50%'; host.style.right = 'auto'; host.style.transform = 'translateX(-50%)'; }
      if (mobile && (p.template === 'header' || p.template === 'slide-up')) { host.style.left = '0'; host.style.right = '0'; host.style.maxWidth = 'none'; host.style.top = p.template === 'header' ? '0' : 'auto'; host.style.bottom = p.template === 'header' ? 'auto' : '0'; }
      if (p.template === 'sticky') { host.style.top = '50%'; host.style.bottom = 'auto'; host.style.transform = 'translateY(-50%)'; host.style[p.position] = '0'; }
      const root = host.attachShadow({ mode: 'open' }), style = document.createElement('style'); style.textContent = css + templateCss + mobileCss; root.appendChild(style);
      const make = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
      const isModal = p.template === 'modal' || p.template === 'fullscreen';
      const launcher = p.template === 'button' || p.template === 'native';
      panel = make(isModal ? 'dialog' : 'section', '', launcher ? `floating ${p.template}` : `card ${p.template}`); panel.setAttribute('aria-label', 'Notification subscription'); panel.style.background = p.background; panel.style.color = p.text;
      const allow = make('button', p.allow_label, 'allow'); allow.type = 'button'; allow.style.background = p.accent;
      const dismiss = make('button', launcher ? '×' : p.dismiss_label, launcher ? 'close' : 'dismiss'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', p.dismiss_label);
      if (launcher) { panel.appendChild(allow); panel.appendChild(dismiss); }
      else {
        const brand = make('div', '', 'brand');
        if (p.logo) { const image = make('img'); image.src = p.logo; image.alt = ''; image.referrerPolicy = 'no-referrer'; image.addEventListener('error', () => image.remove()); brand.appendChild(image); }
        else { const bell = make('span', '🔔', 'bell'); bell.setAttribute('aria-hidden', 'true'); brand.appendChild(bell); }
        brand.appendChild(make('h2', p.heading, 'heading')); panel.appendChild(brand);
        const message = make('p', p.message, 'message'); message.id = 'push-prompt-description'; panel.appendChild(message); panel.setAttribute('aria-describedby', message.id);
        const actions = make('div', '', 'actions'); actions.appendChild(allow); actions.appendChild(dismiss); panel.appendChild(actions);
      }
      const status = make('p', '', 'status'); status.setAttribute('role', 'status');
      dismiss.addEventListener('click', () => { event('dismiss'); postpone(); hide(); });
      root.addEventListener('keydown', event => { if (!isModal && event.key === 'Escape') { event.preventDefault(); dismiss.click(); } });
      if (isModal) {
        dismiss.autofocus = true;
        panel.addEventListener('cancel', event => { event.preventDefault(); dismiss.click(); });
      }
      allow.addEventListener('click', () => {
        if (allow.disabled) return;
        allow.disabled = true; event('click');
        // Call synchronously within this gesture; telemetry never delays permission.
        subscribe().then(result => { if (result) hide(); }).catch(() => { status.textContent = 'Could not enable notifications. Please try again.'; panel.appendChild(status); }).finally(() => { allow.disabled = false; dismiss.disabled = false; });
      });
      if (p.template === 'sticky') {
        panel.hidden = true;
        const tab = make('button', p.allow_label, 'sticky-tab'); tab.type = 'button'; tab.style.background = p.accent;
        tab.setAttribute('aria-expanded', 'false'); panel.id = 'push-sticky-invitation'; tab.setAttribute('aria-controls', panel.id);
        tab.addEventListener('click', () => { tab.hidden = true; tab.setAttribute('aria-expanded', 'true'); panel.hidden = false; host.style[p.position] = '24px'; if (mobile) host.style.maxWidth = 'calc(100vw - 48px)'; allow.focus({ preventScroll: true }); });
        root.appendChild(tab);
      }
      root.appendChild(panel); document.body.appendChild(host);
      if (isModal) {
        if (typeof panel.showModal === 'function') {
          previousOverflow = document.documentElement.style.getPropertyValue('overflow'); previousOverflowPriority = document.documentElement.style.getPropertyPriority('overflow');
          panel.showModal(); modalOpen = true; document.documentElement.style.setProperty('overflow', 'hidden');
        } else { panel.setAttribute('open', ''); panel.style.position = 'fixed'; }
        dismiss.focus({ preventScroll: true });
      }
      event('view');
    };
    if (p.trigger === 'scroll') {
      scrollHandler = () => { const distance = document.documentElement.scrollHeight - innerHeight; if (distance > 0 && scrollY / distance * 100 >= p.scroll) show(); };
      window.addEventListener('scroll', scrollHandler, { passive: true }); scrollHandler();
    } else timer = setTimeout(show, p.delay * 1000);
    return controller;
  } };
})();
