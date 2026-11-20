// Visitor-controlled subscription preferences. No credentials are rendered or stored.
(() => {
  window.PushSubscriptionUI = { mount({ subscribed = true, pending = false, unsubscribe, subscribe, canSubscribe = () => true }) {
    const existing = document.getElementById('notizo-subscription-manager');
    if (existing) return existing.notizoController;
    const host = document.createElement('div'); host.id = 'notizo-subscription-manager';
    const root = host.attachShadow({ mode: 'open' });
    const make = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
    const style = make('style');
    style.textContent = ':host{all:initial;position:fixed;left:max(16px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147482900;max-width:calc(100vw - 32px);font:14px/1.5 system-ui,sans-serif;color:#273457}*{box-sizing:border-box}[hidden]{display:none!important}button{font:600 13px/1.4 system-ui,sans-serif;min-height:44px;border:1px solid #d9e3eb;border-radius:9px;padding:10px 14px;cursor:pointer;color:#273457;background:#fff}button:focus-visible{outline:3px solid #49b8bd;outline-offset:3px}button:disabled{opacity:.65;cursor:wait}.launcher{box-shadow:0 3px 14px #173d5120}.panel{width:330px;max-width:100%;margin-bottom:10px;padding:20px;border:1px solid #d9e3eb;border-radius:14px;background:#fff;box-shadow:0 10px 35px #173d5133}h2{font:600 18px/1.4 system-ui,sans-serif;margin:0 0 10px}p{margin:0 0 16px;overflow-wrap:anywhere}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:#167b7e;color:#fff;border-color:#167b7e}.status{font-size:12px;margin:12px 0 0}.status:empty{display:none}';
    const launcher = make('button', 'Manage notifications', 'launcher'); launcher.type = 'button'; launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-controls', 'notizo-notification-preferences');
    const panel = make('section', '', 'panel'); panel.id = 'notizo-notification-preferences'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'notizo-notification-heading');
    const heading = make('h2', 'Notifications'); heading.id = 'notizo-notification-heading';
    const description = make('p');
    const scopeNote = make('p', 'This control manages this subscription only. Other notification services on this website are managed separately.', 'note');
    style.textContent += '.note{font-size:12px;margin:12px 0 0;color:#687b89}';
    const action = make('button', '', 'primary'); action.type = 'button';
    const close = make('button', 'Close'); close.type = 'button';
    const actions = make('div', '', 'actions'); actions.append(action, close);
    const status = make('p', '', 'status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    let busy = false;
    const render = () => {
      launcher.textContent = subscribed ? 'Manage notifications' : 'Notifications off';
      description.textContent = subscribed ? (pending ? 'Your unsubscribe request needs completing. Tap Unsubscribe to finish.' : 'You are subscribed to these website updates in this browser.') : 'You have unsubscribed from these website updates in this browser.';
      action.textContent = subscribed ? 'Unsubscribe' : 'Subscribe again';
      action.hidden = !subscribed && !canSubscribe();
    };
    const hide = () => { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus({ preventScroll: true }); };
    launcher.addEventListener('click', () => { panel.hidden = !panel.hidden; launcher.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) { render(); (action.hidden ? close : action).focus({ preventScroll: true }); } });
    close.addEventListener('click', hide);
    root.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); hide(); } });
    action.addEventListener('click', () => {
      if (busy) return;
      const removing = subscribed;
      busy = true; action.disabled = true;
      status.textContent = removing ? 'Unsubscribing...' : 'Enabling notifications...';
      // Invoke synchronously so Subscribe again preserves the visitor gesture.
      let task;
      try { task = removing ? unsubscribe() : subscribe(); } catch (error) { task = Promise.reject(error); }
      Promise.resolve(task).then(result => {
        if (!result) throw new Error(removing ? 'No subscription for this service was found. Other notification providers have not been changed.' : 'Notifications were not enabled.');
        subscribed = !removing; pending = false; render();
        status.textContent = removing ? 'Unsubscribed successfully.' : 'Notifications enabled.';
      }).catch(error => { status.textContent = error.userMessage || error.message || 'Could not update notification preferences. Please try again.'; }).finally(() => { busy = false; action.disabled = false; });
    });
    const controller = { setSubscribed(value, incomplete = false) { subscribed = value; pending = incomplete; render(); }, destroy() { host.remove(); } };
    host.notizoController = controller;
    panel.style.maxHeight = 'calc(100dvh - 100px)'; panel.style.overflowY = 'auto';
    render(); panel.append(heading, description, actions, status, scopeNote); root.append(style, panel, launcher); document.body.appendChild(host);
    return controller;
  } };
})();
