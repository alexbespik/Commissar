// The on-screen banner and punishment effects. showOverlay / removeOverlay are passed to
// chrome.scripting.executeScript({func}), so they must not use anything outside their own bodies.
// Text goes in with textContent only; everything lives in one closed shadow root on top of the page.
// Effects: flash (red vignette pulse), shake (our own layer, never the page), grayscale (a click-through layer that
// greys the page), countdown (seconds until you are returned to your study tab), lockout (the page is covered until the
// penance is typed or the time runs out; Esc lifts it after 10 s; never longer than 60 s).

export function showOverlay(p) {
  const ID = 'commissar-study-overlay';
  document.getElementById(ID)?.remove();
  const effects = Array.isArray(p.effects) ? p.effects : [];
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  const tone = p.tone === 'good' ? '#c9a227' : p.tone === 'info' ? '#8a9a8a' : '#c0392b';
  const style = document.createElement('style');
  style.textContent = `
    *{box-sizing:border-box}
    .wrap{position:fixed;inset:0;pointer-events:none}
    .box{position:absolute;right:16px;bottom:16px;width:min(380px,calc(100vw - 32px));background:#15130f;color:#eee6d3;
      border:1px solid #3a342a;border-left:6px solid ${tone};border-radius:6px;padding:12px 14px;pointer-events:auto;
      font:14px/1.45 Georgia,'Times New Roman',serif;box-shadow:0 10px 30px rgba(0,0,0,.45);cursor:pointer;animation:in .25s ease-out}
    .who{font:600 11px/1.2 system-ui,-apple-system,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${tone};margin-bottom:6px}
    .say{font-size:15px}
    .meta{font:12px/1.3 system-ui,-apple-system,sans-serif;color:#a39a86;margin-top:8px}
    .count{font:600 13px/1.3 system-ui,-apple-system,sans-serif;color:#e57368;margin-top:8px}
    .vignette{position:fixed;inset:0;box-shadow:inset 0 0 160px 40px rgba(192,57,43,.55);animation:pulse 1.2s ease-in-out 2}
    .grey{position:fixed;inset:0;backdrop-filter:grayscale(1) brightness(.8);-webkit-backdrop-filter:grayscale(1) brightness(.8)}
    .shake{animation:shake .5s ease-in-out 2}
    .lock{position:fixed;inset:0;pointer-events:auto;background:rgba(12,10,8,.94);color:#eee6d3;display:flex;align-items:center;
      justify-content:center;padding:16px;font:15px/1.5 Georgia,'Times New Roman',serif}
    .lock .card{width:min(520px,100%);border:1px solid #3a342a;border-top:6px solid #c0392b;border-radius:6px;padding:22px;background:#15130f}
    .lock h2{margin:0 0 6px;font:600 13px/1.2 system-ui,-apple-system,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#c0392b}
    .lock .line{font-size:19px;margin:10px 0 14px}
    .lock input{width:100%;padding:9px 10px;font:16px/1.3 Georgia,serif;background:#1e1b16;color:#eee6d3;border:1px solid #3a342a;border-radius:5px}
    .lock input:focus{outline:2px solid #c9a227;outline-offset:1px}
    .lock .hint{font:12px/1.4 system-ui,-apple-system,sans-serif;color:#a39a86;margin-top:10px}
    @keyframes in{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}
    @keyframes pulse{0%,100%{opacity:0}50%{opacity:1}}
    @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(9px)}60%{transform:translateX(-7px)}80%{transform:translateX(5px)}}
    @media (prefers-reduced-motion:reduce){.box,.vignette,.shake{animation:none}.vignette{opacity:.6}}`;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  let life = Math.min(20000, Math.max(3000, Number(p.ms) || 8000));
  const done = () => host.remove();
  const starters = []; // timers that need the overlay on the page first

  if (effects.includes('grayscale')) wrap.append(el('div', 'grey'));
  if (effects.includes('flash') || effects.includes('shake')) wrap.append(el('div', 'vignette'));

  const box = el('div', 'box');
  box.setAttribute('role', 'status');
  box.append(el('div', 'who', p.name || 'Commissar'), el('div', 'say', p.caption || ''));
  if (p.meta) box.append(el('div', 'meta', p.meta));
  if (effects.includes('shake') && !reduce) box.classList.add('shake');
  box.addEventListener('click', done);

  const countdown = Math.max(0, Math.min(25, Number(p.countdownS) || 0));
  if (effects.includes('countdown') && countdown) {
    const c = el('div', 'count');
    box.append(c);
    let left = countdown;
    const tick = () => {
      if (!host.isConnected) return;
      c.textContent = `Returning you to your post in ${left} s.`;
      left -= 1;
      if (left >= 0) setTimeout(tick, 1000);
    };
    starters.push(tick);
    life = Math.max(life, (countdown + 2) * 1000);
  }

  if (effects.includes('lockout')) {
    const secs = Math.max(10, Math.min(60, Number(p.lockoutS) || 30));
    const penance = String(p.penance || 'I will not desert my studies.').slice(0, 80);
    const lock = el('div', 'lock');
    lock.setAttribute('role', 'dialog');
    lock.setAttribute('aria-modal', 'true');
    lock.setAttribute('aria-label', 'Commissar lockout');
    const card = el('div', 'card');
    const timer = el('div', 'hint');
    const input = el('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Type the penance line');
    card.append(el('h2', '', `${p.name || 'Commissar'}: judgment`), el('div', '', p.caption || 'Repeated desertion.'),
      el('div', 'line', penance), input, timer);
    lock.append(card);
    wrap.append(lock);
    const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    input.addEventListener('input', () => { if (norm(input.value) === norm(penance)) done(); });
    let started = Date.now();
    const onKey = (e) => { if (e.key === 'Escape' && Date.now() - started > 10000) done(); };
    window.addEventListener('keydown', onKey, true); // wherever focus is
    const stopKeys = () => window.removeEventListener('keydown', onKey, true);
    new MutationObserver((_, o) => { if (!host.isConnected) { stopKeys(); o.disconnect(); } }).observe(document.documentElement, { childList: true });
    const tick = () => {
      if (!host.isConnected) return;
      const left = Math.max(0, Math.ceil(secs - (Date.now() - started) / 1000));
      timer.textContent = `Write the line above to continue, or wait ${left} s.${Date.now() - started > 10000 ? ' Esc also lifts it.' : ''}`;
      if (left <= 0) done(); else setTimeout(tick, 500);
    };
    starters.push(() => { started = Date.now(); tick(); input.focus(); });
    life = Math.max(life, secs * 1000 + 500);
  }

  if (!effects.includes('lockout')) wrap.append(box); // the lockout card already carries the line
  root.append(style, wrap);
  document.documentElement.append(host);
  starters.forEach((f) => f());
  setTimeout(done, Math.min(61000, life));
}

/** Removes the banner and any effect or lockout (session ended, discipline turned off). */
export function removeOverlay() {
  document.getElementById('commissar-study-overlay')?.remove();
}
