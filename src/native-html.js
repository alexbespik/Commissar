// The pages the Mac helper shows (native/CommissarOverlay.swift loads them into its panels). Built only from the
// extension's own art and captions; anything with text is escaped, and each page's CSP forbids loading anything. Pure functions: unit-tested under node.
import { BUST, COLORS } from './pixelart.js';
import { scareSVG } from './scare-art.js';

// only our own @font-face rules with data: URLs go into a page's style (nothing that could close the tag)
const safeCss = (css) => (/^(@font-face\{[^<>{}]*\})*$/.test(String(css || '')) ? css : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** His small watch panel: the pixel face with flickering eyes, a line, and the outside-resources button. */
export function watchHtml({ line = 'I am watching you.', passUntil = 0, fontCss = '' } = {}) {
  const until = passUntil > Date.now() ? `Outside resources until ${new Date(passUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>${safeCss(fontCss)}
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:italic 14px/1.3 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;color:#eee6d3;-webkit-user-select:none}
  .box{position:absolute;inset:6px;background:rgba(10,8,7,.92);border:1px solid #3a342a;border-left:4px solid #c0392b;border-radius:10px;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px}
  canvas{width:120px;height:120px;image-rendering:pixelated}
  button{background:#2a241c;color:#eee6d3;border:1px solid #3a342a;border-radius:5px;padding:5px 8px;font:600 11px 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;cursor:pointer}
  .until{font:11px 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;color:#c9a227}
  </style></head><body><div class="box"><canvas id="c" width="32" height="32"></canvas><div>${esc(line)}</div>
  <div class="until">${esc(until)}</div>
  <button id="pass">I need outside resources (10 min)</button></div>
  <script>
  const rows=${JSON.stringify(BUST)}, col=${JSON.stringify(COLORS)};
  const g=document.getElementById('c').getContext('2d'); const eyes=[];
  rows.forEach((r,y)=>[...r].forEach((k,x)=>{const c=col[k]; if(k==='.'||!c) return; if(k==='r') eyes.push([x,y]); g.fillStyle='rgb('+c+')'; g.fillRect(x,y,1,1);}));
  setInterval(()=>{const hot=Math.random()<.35; eyes.forEach(([x,y])=>{g.fillStyle=hot?'#ffe08a':'#ff281e'; g.fillRect(x,y,1,1);});},160);
  document.getElementById('pass').onclick=()=>window.webkit?.messageHandlers?.commissar?.postMessage('outsidePass');
  </script></body></html>`;
}

/** His watch panel for a version 2 helper, which draws it natively: just the data, no page and no font. */
export function watchData({ line = 'I am watching you.', passUntil = 0 } = {}) {
  const until = passUntil > Date.now() ? `Outside resources until ${new Date(passUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  return { line: String(line).slice(0, 160), until, rows: BUST, colors: COLORS };
}

/** A screamer for the big panel: 'point' (he lunges, pointing) or 'shoot' (he fires: a white flash and a crack). */
export function scareHtml(kind, line = '', fontCss = '') {
  const shoot = kind === 'shoot';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>${safeCss(fontCss)}
  html,body{margin:0;height:100%;background:#050404;overflow:hidden;color:#eee6d3}
  .stage{position:absolute;inset:0 0 70px 0;display:flex;justify-content:center;align-items:center}
  svg{height:100%;max-width:100%;transform-origin:50% 45%;animation:${shoot ? 'aim 1.3s ease-out both, kick .35s 1.3s' : 'lunge .9s cubic-bezier(.2,1.6,.4,1) both, lean 6s .9s ease-in-out infinite alternate'}}
  .text{position:absolute;left:0;right:0;bottom:10px;text-align:center;font:15px/1.4 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;padding:0 12px}
  .big{font:700 40px/1 'Commissar Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;letter-spacing:.08em;color:#ff3b2f;text-shadow:0 0 18px rgba(255,40,30,.6)}
  .flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;${shoot ? 'animation:flash .5s 1.3s ease-out' : ''}}
  @keyframes lunge{from{transform:scale(.55);opacity:0}to{transform:scale(1.08);opacity:1}}
  @keyframes lean{from{transform:scale(1.08)}to{transform:scale(1.14)}}
  @keyframes aim{from{transform:scale(.8)}to{transform:scale(1)}}
  @keyframes kick{0%{transform:translate(0,0) scale(1.04)}25%{transform:translate(-9px,6px)}50%{transform:translate(8px,-7px)}100%{transform:none}}
  @keyframes flash{0%{opacity:.95}100%{opacity:0}}
  @media (prefers-reduced-motion:reduce){svg,.flash{animation:none}}
  </style></head><body><div class="stage">${scareSVG(shoot ? 'shoot' : 'point')}</div><div class="flash"></div>
  <div class="text"><div class="big">${shoot ? 'BANG.' : 'YOU.'}</div><div>${esc(line)}</div></div></body></html>`;
}
