// The screamer window, opened by the service worker when you have been out of the browser too long.
// ?kind=point: the officer lunges at you, pointing. ?kind=shoot: he aims his pistol and fires (the gunshot sound comes
// from the offscreen player at the same moment). Detailed SVG illustration (src/scare-art.js); no gore.
// Reduced motion: no lunge, shake, recoil or white flash.
import { scareSVG } from './scare-art.js';

const params = new URLSearchParams(location.search);
const kind = params.get('kind') === 'shoot' ? 'shoot' : 'point';
const caption = (params.get('line') || '').slice(0, 160);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FIRE_AT = 1300; // ms
const SVGNS = 'http://www.w3.org/2000/svg';

const stage = document.getElementById('stage');
stage.innerHTML = scareSVG(kind); // static markup from our own module; no outside data
const svg = stage.querySelector('svg');
const figure = svg.querySelector('.figure');
const hand = svg.querySelector('.hand');
const eyes = svg.querySelector('.eyes');
const fx = svg.querySelector('.fx');

document.getElementById('big').textContent = kind === 'shoot' ? '' : 'YOU.';
document.getElementById('line').textContent = caption || (kind === 'shoot' ? 'That was a warning shot. Back to your post.' : 'Yes, you. Back to your desk. Now.');
// ?embed=1: playing inside his always-on-top watch window (src/post.js), which puts him back on watch afterwards
const embed = params.get('embed') === '1';
if (embed) document.documentElement.classList.add('embed');
const back = document.getElementById('back');
back.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'returnNow' }).catch(() => {}).finally(() => { if (!embed) window.close(); });
});
if (!embed) {
  addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
  setTimeout(() => window.close(), 15000);
}
back.focus();

const el = (name, attrs) => {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

// the muzzle flash, smoke and the cracked glass: built once, shown at FIRE_AT
function shot() {
  const at = { x: 298, y: 294 }; // the muzzle in the illustration
  const flash = el('g', { class: 'flash-g', transform: `translate(${at.x} ${at.y})` });
  flash.append(
    el('circle', { r: 80, fill: '#ffb347', opacity: 0.55, filter: 'url(#glow)' }),
    el('polygon', { points: '0,-95 14,-20 90,-30 22,4 70,70 0,22 -70,70 -22,4 -90,-30 -14,-20', fill: '#ffd36b' }),
    el('polygon', { points: '0,-50 8,-10 46,-14 12,3 34,36 0,12 -34,36 -12,3 -46,-14 -8,-10', fill: '#fff6d6' }),
  );
  const smoke = el('g', { class: 'smoke-g', filter: 'url(#smoke)', opacity: 0 });
  for (let i = 0; i < 6; i += 1) smoke.append(el('circle', { cx: at.x + (i - 3) * 14, cy: at.y - 30 - i * 16, r: 26 + i * 6, fill: '#8c8c90', opacity: 0.35 }));
  const crack = el('g', { class: 'crack-g', opacity: 0 });
  const cx = 200, cy = 230;
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * Math.PI * 2 + Math.sin(i * 7) * 0.2;
    const len = 90 + ((i * 37) % 120);
    const mx = cx + Math.cos(a) * len * 0.5 + Math.sin(i) * 10, my = cy + Math.sin(a) * len * 0.5 + Math.cos(i) * 10;
    crack.append(el('path', { d: `M${cx} ${cy} L${mx} ${my} L${cx + Math.cos(a) * len} ${cy + Math.sin(a) * len}`, stroke: '#e9edf2', 'stroke-width': 1.6, fill: 'none', opacity: 0.85 }));
  }
  for (let r = 34; r <= 70; r += 18) crack.append(el('circle', { cx, cy, r, stroke: '#e9edf2', 'stroke-width': 1, fill: 'none', opacity: 0.45 }));
  crack.append(el('circle', { cx, cy, r: 14, fill: '#000' }), el('circle', { cx, cy, r: 20, fill: 'none', stroke: '#fff', 'stroke-width': 2, opacity: 0.6 }));
  fx.append(smoke, flash, crack);
  flash.style.opacity = '0';
  return { flash, smoke, crack };
}
const parts = kind === 'shoot' ? shot() : null;

// Your own picture (private): custom/scare-point.*, custom/scare-shoot.* or custom/scare.* (png, jpg, jpeg, webp) in
// the extension folder replace the drawing; the folder is git-ignored and never published. Effects stay on top.
async function customImage() {
  if (!globalThis.chrome?.runtime?.getURL) return '';
  const names = [`scare-${kind}`, 'scare'];
  for (const n of names) {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      const url = chrome.runtime.getURL(`custom/${n}.${ext}`);
      const ok = await new Promise((res) => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = url; });
      if (ok) return url;
    }
  }
  return '';
}

let start = performance.now();
const ease = (t) => 1 - (1 - t) ** 3;
function frame(now) {
  const t = now - start;
  let scale = 1, sx = 0, sy = 0;
  if (!reduce) {
    if (kind === 'point') {
      // the lunge: far, then suddenly close, then a slow lean in
      scale = t < 300 ? 0.55 + 0.6 * ease(t / 300) : 1.15 - 0.1 * Math.min(1, (t - 300) / 600) + 0.015 * Math.sin(t / 420);
      if (t > 260 && t < 600) { sx = (Math.random() - 0.5) * 14; sy = (Math.random() - 0.5) * 14; }
    } else {
      scale = 1 + 0.01 * Math.sin(t / 380) + (t > FIRE_AT && t < FIRE_AT + 260 ? 0.04 : 0);
      if (t > FIRE_AT && t < FIRE_AT + 380) { sx = (Math.random() - 0.5) * 22; sy = (Math.random() - 0.5) * 22; }
    }
  }
  stage.style.transform = `translate(${sx}px, ${sy}px) scale(${scale})`;
  // the hand comes at you; the pistol kicks when it fires
  if (kind === 'point') {
    const k = reduce ? 1 : ease(Math.min(1, t / 420));
    hand.setAttribute('transform', `translate(${(1 - k) * 60} ${(1 - k) * 80}) scale(${0.7 + 0.3 * k})`);
  } else if (!reduce && t > FIRE_AT && t < FIRE_AT + 300) {
    const r = 1 - (t - FIRE_AT) / 300;
    hand.setAttribute('transform', `translate(${8 * r} ${-26 * r}) rotate(${-6 * r} 300 300)`);
  } else hand.setAttribute('transform', '');
  // the eyes burn and flicker
  eyes.style.opacity = String(0.75 + 0.25 * Math.random());
  if (parts) {
    const since = t - FIRE_AT;
    parts.flash.style.opacity = since > 0 && since < 140 ? '1' : since >= 140 && since < 260 ? String(1 - (since - 140) / 120) : '0';
    parts.smoke.setAttribute('opacity', since > 80 ? String(Math.max(0, 0.9 - since / 3200)) : '0');
    parts.smoke.setAttribute('transform', `translate(0 ${since > 0 ? -since / 40 : 0})`);
    parts.crack.setAttribute('opacity', since > 0 ? '1' : '0');
    if (since > 0) document.getElementById('big').textContent = 'BANG.';
  }
  if (t < 5000) requestAnimationFrame(frame);
}
customImage().then((url) => {
  if (url) {
    // the picture fills the window; the drawn officer, hall and fog step aside (the shot's effects stay)
    stage.style.background = `#000 url("${url}") center 30% / cover no-repeat`;
    for (const sel of ['.bg', '.hall', '.fog', '.figure', '.hand']) svg.querySelector(sel)?.setAttribute('display', 'none');
  }
  start = performance.now();
  requestAnimationFrame(frame);
  if (kind === 'shoot' && !reduce) scheduleFlash();
});

function scheduleFlash() {
  setTimeout(() => {
    const f = document.getElementById('flash');
    f.style.opacity = '0.9'; // one short flash, never repeated
    setTimeout(() => { f.style.transition = 'opacity .4s'; f.style.opacity = '0'; }, 90);
  }, FIRE_AT);
}

