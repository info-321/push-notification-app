(function () {
  'use strict';
  var pre = document.getElementById('notizo-preloader');
  var root = document.getElementById('root');
  if (!pre || !root) return;
  var number = pre.querySelector('.pnum span');
  var fill = pre.querySelector('.pnum b');
  var line = pre.querySelector('.pline i');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var started = performance.now(), value = 0, frame, finishing = false, removed = false;
  var appReady = false, pageReady = document.readyState === 'complete';
  root.inert = true;
  root.setAttribute('aria-busy', 'true');
  function paint(next) {
    value = next;
    var rounded = Math.round(next);
    number.textContent = fill.textContent = String(rounded);
    fill.style.clipPath = 'inset(' + (100 - rounded) + '% 0 0 0)';
    line.style.transform = 'scaleX(' + (next / 100) + ')';
  }
  function remove() {
    if (removed) return;
    removed = true;
    clearTimeout(slowTimer);
    clearTimeout(exitTimer);
    cancelAnimationFrame(frame);
    document.removeEventListener('notizo:ready', ready);
    window.removeEventListener('load', loaded);
    pre.removeEventListener('animationend', remove);
    root.inert = false;
    root.removeAttribute('aria-busy');
    pre.remove();
  }
  function finish() {
    if (!appReady || !pageReady || finishing) return;
    finishing = true;
    clearTimeout(slowTimer);
    cancelAnimationFrame(frame);
    var from = value, completion = performance.now();
    function complete(now) {
      var elapsed = reduced ? 1 : Math.min(1, (now - completion) / 280);
      paint(from + (100 - from) * (1 - Math.pow(1 - elapsed, 3)));
      if (elapsed < 1) { frame = requestAnimationFrame(complete); return; }
      if (reduced) { remove(); return; }
      pre.addEventListener('animationend', remove);
      pre.classList.add('exit');
      exitTimer = setTimeout(remove, 850);
    }
    frame = requestAnimationFrame(complete);
  }
  function ready() { appReady = true; finish(); }
  function loaded() { pageReady = true; finish(); }
  // The counter is an animation, not measured download progress. Wait for both
  // the document and the initial session check before completing it.
  function tick(now) {
    paint(Math.min(90, 90 * (1 - Math.exp(-(now - started) / 850))));
    if (!finishing) frame = requestAnimationFrame(tick);
  }
  document.addEventListener('notizo:ready', ready);
  window.addEventListener('load', loaded, { once: true });
  pre.querySelector('button').addEventListener('click', function () { window.location.reload(); });
  var exitTimer;
  var slowTimer = setTimeout(function () { pre.querySelector('.preloader-help').hidden = false; }, 20000);
  if (!reduced) frame = requestAnimationFrame(tick);
})();
