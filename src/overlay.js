// The on-screen banner and punishment effects. showOverlay / removeOverlay are passed to
// chrome.scripting.executeScript({func}), so they must not use anything outside their own bodies.
// Text goes in with textContent only; everything lives in one closed shadow root on top of the page.
// Effects: flash (red vignette pulse), shake (our own layer, never the page), grayscale (a click-through layer that
// greys the page), countdown (seconds until you are returned to your study tab), burn (the pixel officer torches the
// page), lockout (the writing punishment: the page is covered by an extension frame, src/penance.html, until the penance
// line is written N times; keys typed in the frame never reach the page, so YouTube's shortcuts cannot eat them).
// A lockout already on the page is never replaced or reset by a later call: only removeOverlay() lifts it.

export function showOverlay(p) {
  // the extension's font (JetBrains Mono, as "Commissar Mono"), added to this page once, for the overlay only
  if (Array.isArray(p.fonts) && !globalThis.__commissarFont) {
    globalThis.__commissarFont = true;
    for (const f of p.fonts) {
      try { document.fonts.add(new FontFace('Commissar Mono', `url(${f.url})`, { weight: f.weight, style: f.style, unicodeRange: f.unicodeRange })); } catch { /* the page refuses it: fallback font */ }
    }
  }
  const ID = 'commissar-study-overlay';
  const old = document.getElementById(ID);
  if (old?.dataset.lock) return 'locked';
  old?.remove();
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
      font:14px/1.45 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;box-shadow:0 10px 30px rgba(0,0,0,.45);cursor:pointer;animation:in .25s ease-out}
    .who{font:600 11px/1.2 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;letter-spacing:.14em;text-transform:uppercase;color:${tone};margin-bottom:6px}
    .say{font-size:15px}
    .meta{font:12px/1.3 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;color:#a39a86;margin-top:8px}
    .count{font:600 13px/1.3 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;color:#e57368;margin-top:8px}
    .vignette{position:fixed;inset:0;box-shadow:inset 0 0 160px 40px rgba(192,57,43,.55);animation:pulse 1.2s ease-in-out 2}
    .grey{position:fixed;inset:0;backdrop-filter:grayscale(1) brightness(.8);-webkit-backdrop-filter:grayscale(1) brightness(.8)}
    .shake{animation:shake .5s ease-in-out 2}
    .burn{position:fixed;inset:0;width:100vw;height:100vh;image-rendering:pixelated;image-rendering:crisp-edges}
    .lock{position:fixed;inset:0;width:100vw;height:100vh;border:0;pointer-events:auto;background:rgba(12,10,8,.55);color-scheme:dark}
    @keyframes in{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}
    @keyframes pulse{0%,100%{opacity:0}50%{opacity:1}}
    @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(9px)}60%{transform:translateX(-7px)}80%{transform:translateX(5px)}}
    @media (prefers-reduced-motion:reduce){.box,.vignette,.shake{animation:none}.vignette{opacity:.6}}`;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';

  // Pixel-art officer marches in and torches the page: low-resolution canvas scaled up with crisp pixels.
  // Original sprite (peaked cap, greatcoat, red sash, flamer); classic "doom fire" spread rising up the page.
  function burnPage(canvas, totalMs, still, alive) {
    const PX = 6;
    const W = Math.ceil(innerWidth / PX), H = Math.ceil(innerHeight / PX);
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const img = g.createImageData(W, H);
    const heat = new Uint8Array(W * H);
    const MAXH = 36;
    const pal = [];
    for (let i = 0; i <= MAXH; i += 1) { // transparent -> deep red -> orange -> yellow -> white
      const t = i / MAXH;
      pal.push([Math.min(255, 60 + 400 * t), Math.max(0, Math.min(255, 520 * t - 140)), Math.max(0, Math.min(255, 700 * t - 520)), i < 2 ? 0 : Math.min(235, 40 + 380 * t)]);
    }
    const S = p.sprite?.rows || [], LEGS = p.sprite?.legs || [], COL = p.sprite?.colors || {};
    const start = performance.now();
    const SW = S[0]?.length || 0;
    const sx = Math.max(2, Math.floor(W * 0.05)), sy = H - S.length - 1;
    const put = (x, y, c, a = 255) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = a; };
    function frame(now) {
      if (!alive()) return;
      const t = Math.min(1, (now - start) / totalMs);
      const walk = Math.min(1, t / 0.15);                 // march in during the first 15 %
      const x0 = Math.round(-SW + (sx + SW) * walk);
      const firing = t > 0.15;
      const front = firing ? Math.round(H - 2 - (H - 4) * Math.min(1, (t - 0.15) / 0.75)) : H; // fire base rises
      img.data.fill(0);
      // charred ground below the fire base, with a few embers
      for (let y = Math.max(0, front); y < H; y += 1) {
        for (let x = 0; x < W; x += 1) put(x, y, Math.random() < 0.012 ? [255, 120, 30] : [24, 14, 10], 215);
      }
      if (firing) {
        const muzzle = sx + SW;
        const reach = Math.min(W, Math.round(muzzle + (W - sx) * Math.min(1, (t - 0.15) / 0.12))); // flamer jet sweep
        const jetY = sy + 17;
        for (let x = muzzle; x < reach; x += 1) { heat[jetY * W + x] = MAXH; if (jetY + 1 < H) heat[(jetY + 1) * W + x] = MAXH - 4; }
        if (front < H) {
          for (let x = 0; x < W; x += 1) heat[Math.min(H - 1, front) * W + x] = MAXH;
          // behind the rising fire the page is burnt out: no flame left there, only char and embers
          heat.fill(0, Math.min(H, front + 3) * W, Math.max(Math.min(H, front + 3) * W, (sy - 2) * W));
          if (front + 3 < sy - 2) heat.fill(0, (sy + S.length) * W);
        }
        for (let y = 1; y < H; y += 1) { // spread upward with flicker and drift
          for (let x = 0; x < W; x += 1) {
            const src = heat[y * W + x];
            if (!src) continue;
            const r = (Math.random() * 3) | 0;
            const nx = Math.min(W - 1, Math.max(0, x - r + 1));
            const v = src - (r & 1) - (Math.random() < 0.35 ? 1 : 0);
            const ni = (y - 1) * W + nx;
            if (v > heat[ni]) heat[ni] = Math.max(0, v);
          }
        }
        for (let i = 0; i < heat.length; i += 1) {
          const h = heat[i];
          if (h < 2) continue;
          const c = pal[h];
          const o = i * 4;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = c[3];
          heat[i] = Math.max(0, h - (Math.random() < 0.5 ? 1 : 0)); // cool down
        }
      }
      // the officer, with a two-step march while walking in
      const step = walk < 1 && Math.floor(now / 160) % 2 === 1;
      S.forEach((row, y) => {
        const line = step && y >= S.length - 3 ? LEGS[y - (S.length - 3)] : row;
        for (let x = 0; x < line.length; x += 1) {
          const k = line[x];
          if (k === '.') continue;
          const glow = (k === 'r' || k === 'F') && Math.random() < 0.3; // the eyes and the pilot flame flicker
          put(x0 + x, sy + y, glow ? [255, 220, 120] : COL[k]);
        }
      });
      g.putImageData(img, 0, 0);
      if (t < 1 && !still) requestAnimationFrame(frame);
    }
    if (still) { // reduced motion: one frame, officer in place with the page already ablaze at the bottom
      frame(start + totalMs * 0.5);
    } else requestAnimationFrame(frame);
  }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
  let life = Math.min(20000, Math.max(3000, Number(p.ms) || 8000));
  const done = () => host.remove();
  const starters = []; // timers that need the overlay on the page first

  if (effects.includes('grayscale')) wrap.append(el('div', 'grey'));
  if (effects.includes('burn')) {
    const canvas = document.createElement('canvas');
    canvas.className = 'burn';
    wrap.append(canvas);
    const burnMs = Math.max(4000, (Math.max(0, Math.min(25, Number(p.countdownS) || 0)) || 8) * 1000);
    starters.push(() => burnPage(canvas, burnMs, reduce, () => host.isConnected));
    life = Math.max(life, burnMs + 1500);
  }
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

  // the page's own video and sound stop while it burns or is locked, and fullscreen is left (an overlay cannot show
  // over a fullscreen player)
  const hush = () => {
    document.querySelectorAll('video,audio').forEach((m) => { try { if (!m.paused) m.pause(); } catch { /* ignore */ } });
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
  if (effects.includes('burn') || effects.includes('lockout')) starters.push(hush);

  const locked = effects.includes('lockout');
  if (locked) {
    // the writing punishment in an extension frame: keystrokes typed there never reach the page
    host.dataset.lock = '1';
    const lock = document.createElement('iframe'); // it asks the service worker for the line and the count itself
    lock.className = 'lock';
    lock.title = 'Commissar: write your penance';
    lock.src = chrome.runtime.getURL('src/penance.html');
    wrap.append(lock);
    // keep the page paused and the cursor in the frame (the page may grab focus back, or autoplay the next video)
    const hold = () => {
      if (!host.isConnected) return;
      hush();
      if (document.activeElement !== host) lock.focus();
      setTimeout(hold, 800);
    };
    starters.push(() => { lock.addEventListener('load', () => lock.focus()); hold(); });
  }

  if (!locked) wrap.append(box); // the penance frame already carries the line
  root.append(style, wrap);
  document.documentElement.append(host);
  starters.forEach((f) => f());
  if (!locked) setTimeout(done, Math.min(61000, life)); // a lockout stays until removeOverlay(): the penance is written
  return locked ? 'lockout' : 'shown';
}

/** Removes the banner and any effect or lockout (session ended, discipline turned off). */
export function removeOverlay() {
  document.getElementById('commissar-study-overlay')?.remove();
}

/**
 * A check-in: he peeks in from an edge of the page, stares, says his line in a small bubble, and slides away.
 * Self-contained (executeScript func). Never takes clicks. `p.image` (a data: URL of your own picture) or `p.sprite`.
 */
export function showPeek(p) {
  // the extension's font (JetBrains Mono, as "Commissar Mono"), added to this page once, for the overlay only
  if (Array.isArray(p.fonts) && !globalThis.__commissarFont) {
    globalThis.__commissarFont = true;
    for (const f of p.fonts) {
      try { document.fonts.add(new FontFace('Commissar Mono', `url(${f.url})`, { weight: f.weight, style: f.style, unicodeRange: f.unicodeRange })); } catch { /* the page refuses it: fallback font */ }
    }
  }
  const ID = 'commissar-study-peek';
  document.getElementById(ID)?.remove();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  const side = ['bottom', 'left', 'right'].includes(p.side) ? p.side : 'bottom';
  const at = Math.min(0.88, Math.max(0.12, Number(p.at) || 0.5));
  const size = Math.round(Math.min(320, Math.max(180, Math.min(innerWidth, innerHeight) * 0.42)));
  const style = document.createElement('style');
  style.textContent = `
    .who{position:fixed;width:${size}px;height:${size}px;transition:transform .7s cubic-bezier(.2,.9,.3,1);filter:drop-shadow(0 8px 24px rgba(0,0,0,.6))}
    .who canvas,.who img{width:100%;height:100%;image-rendering:pixelated;object-fit:cover;border-radius:${p.image ? '10px' : '0'}}
    .say{position:fixed;max-width:240px;background:#15130f;color:#eee6d3;border:1px solid #3a342a;border-left:5px solid #c0392b;
      border-radius:6px;padding:8px 11px;font:italic 15px/1.35 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;opacity:0;transition:opacity .4s .5s}
    .show .say{opacity:1}`;
  const who = document.createElement('div');
  who.className = 'who';
  if (p.image) {
    const img = document.createElement('img');
    img.src = p.image;
    img.alt = '';
    who.append(img);
  } else {
    const rows = (p.sprite && p.sprite.rows) || [];
    const colors = (p.sprite && p.sprite.colors) || {};
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((k, x) => {
      const col = colors[k];
      if (k === '.' || !col) return;
      g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      g.fillRect(x, y + 2, 1, 1);
    }));
    who.append(c);
    // the eyes catch the light now and then
    const eyes = [];
    rows.forEach((row, y) => [...row].forEach((k, x) => { if (k === 'r') eyes.push([x, y + 2]); }));
    const blink = () => {
      if (!host.isConnected) return;
      const hot = Math.random() < 0.35;
      eyes.forEach(([x, y]) => { g.fillStyle = hot ? '#ffe08a' : '#ff281e'; g.fillRect(x, y, 1, 1); });
      setTimeout(blink, 140);
    };
    if (!reduce) setTimeout(blink, 600);
  }
  const say = document.createElement('div');
  say.className = 'say';
  say.textContent = String(p.caption || 'I am watching you.');
  // place him half hidden past an edge, then slide him in
  const hide = Math.round(size * 0.95), show = Math.round(size * 0.38);
  let inT = '', outT = '';
  if (side === 'bottom') {
    who.style.left = `${Math.round(at * (innerWidth - size))}px`; who.style.bottom = `-${hide}px`;
    inT = `translateY(-${hide - show}px)`; outT = 'translateY(0)';
    say.style.left = `${Math.min(innerWidth - 260, Math.round(at * (innerWidth - size)) + size * 0.6)}px`; say.style.bottom = `${show + 8}px`;
  } else {
    const top = Math.round(at * (innerHeight - size));
    who.style.top = `${top}px`;
    who.style[side] = `-${hide}px`;
    const dir = side === 'left' ? 1 : -1;
    inT = `translateX(${dir * (hide - show)}px) rotate(${dir * 8}deg)`; outT = 'translateX(0)';
    say.style.top = `${Math.max(8, top + size * 0.15)}px`;
    say.style[side] = `${show + 10}px`;
  }
  who.style.transform = outT;
  const wrap = document.createElement('div');
  wrap.append(who, say);
  root.append(style, wrap);
  document.documentElement.append(host);
  const dur = Math.min(9000, Math.max(3000, Number(p.ms) || 5200));
  if (reduce) { who.style.transition = 'none'; }
  requestAnimationFrame(() => requestAnimationFrame(() => { who.style.transform = inT; wrap.className = 'show'; }));
  setTimeout(() => { if (!host.isConnected) return; wrap.className = ''; who.style.transform = outT; }, dur);
  setTimeout(() => host.remove(), dur + 900);
}
