// The on-screen banner. showOverlay is passed to chrome.scripting.executeScript({func}), so it must not use anything
// outside its own body. Text goes in with textContent only; the banner lives in a closed shadow root.
export function showOverlay(p) {
  const ID = 'commissar-study-overlay';
  document.getElementById(ID)?.remove();
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
  const root = host.attachShadow({ mode: 'closed' });
  const tone = p.tone === 'good' ? '#c9a227' : p.tone === 'info' ? '#8a9a8a' : '#c0392b';
  const style = document.createElement('style');
  style.textContent = `
    .box{box-sizing:border-box;width:min(380px,calc(100vw - 32px));background:#15130f;color:#eee6d3;
      border:1px solid #3a342a;border-left:6px solid ${tone};border-radius:6px;padding:12px 14px 12px 14px;
      font:14px/1.45 Georgia,'Times New Roman',serif;box-shadow:0 10px 30px rgba(0,0,0,.45);cursor:pointer;
      animation:in .25s ease-out}
    .who{font:600 11px/1.2 system-ui,-apple-system,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${tone};margin-bottom:6px}
    .say{font-size:15px}
    .meta{font:12px/1.3 system-ui,-apple-system,sans-serif;color:#a39a86;margin-top:8px}
    @keyframes in{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}
    @media (prefers-reduced-motion:reduce){.box{animation:none}}`;
  const box = document.createElement('div');
  box.className = 'box';
  box.setAttribute('role', 'status');
  const who = document.createElement('div'); who.className = 'who'; who.textContent = String(p.name || 'Commissar');
  const say = document.createElement('div'); say.className = 'say'; say.textContent = String(p.caption || '');
  box.append(who, say);
  if (p.meta) { const m = document.createElement('div'); m.className = 'meta'; m.textContent = String(p.meta); box.append(m); }
  box.addEventListener('click', () => host.remove());
  root.append(style, box);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), Math.min(20000, Math.max(3000, Number(p.ms) || 8000)));
}
