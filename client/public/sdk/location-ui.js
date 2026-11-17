// Separate, optional location consent, shown only to subscribed browsers.
(() => {
  window.PushLocationUI = { mount({ key, shareLocation }) {
    const storageKey = `push-location-dismissed:${key}`;
    try { if (Number(localStorage.getItem(storageKey)) > Date.now()) return; } catch { /* Storage is optional. */ }
    if (document.getElementById('notizo-location-consent')) return;
    const host = document.createElement('div');
    host.id = 'notizo-location-consent';
    const root = host.attachShadow({ mode: 'open' }), style = document.createElement('style');
    style.textContent = ':host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483000;max-width:calc(100vw - 40px);font:14px/1.6 system-ui,sans-serif;color:#273457}*{box-sizing:border-box}.card{width:350px;max-width:100%;padding:22px;background:white;border:1px solid #d9e3eb;border-radius:12px;box-shadow:0 10px 35px #173d5133}h2{font:600 18px/1.4 system-ui,sans-serif;margin:0 0 10px}p{margin:0 0 16px}.actions{display:flex;gap:8px;flex-wrap:wrap}button{font:600 14px/1.4 system-ui,sans-serif;min-height:44px;padding:10px 14px;border:0;border-radius:6px;cursor:pointer;color:#fff;background:#167b7e}button.secondary{color:#43556b;background:#f0f5f8}button:focus-visible{outline:3px solid #49b8bd;outline-offset:3px}button:disabled{opacity:.65;cursor:wait}.status{font-size:12px;margin:12px 0 0}.status:empty{display:none}';
    const card = document.createElement('section'); card.className = 'card'; card.setAttribute('aria-labelledby', 'location-heading');
    const title = document.createElement('h2'); title.id = 'location-heading'; title.textContent = 'Share your location?';
    const description = document.createElement('p'); description.textContent = 'Optional: save your device coordinates with your notification subscription for this website. Notifications work without sharing location.';
    const actions = document.createElement('div'); actions.className = 'actions';
    const allow = document.createElement('button'); allow.type = 'button'; allow.textContent = 'Share location';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'secondary'; dismiss.textContent = 'Not now';
    const status = document.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status');
    dismiss.addEventListener('click', () => {
      try { localStorage.setItem(storageKey, String(Date.now() + 30 * 86400000)); } catch { /* Storage is optional. */ }
      host.remove();
    });
    allow.addEventListener('click', async () => {
      allow.disabled = true; dismiss.disabled = true; status.textContent = 'Waiting for your location permission...';
      try { await shareLocation(); host.remove(); }
      catch (error) { status.textContent = error.message || 'Location was not shared. Notifications remain enabled.'; }
      finally { allow.disabled = false; dismiss.disabled = false; }
    });
    actions.append(allow, dismiss); card.append(title, description, actions, status); root.append(style, card); document.body.appendChild(host);
  } };
})();
