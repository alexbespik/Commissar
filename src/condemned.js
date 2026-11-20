// The page a burned tab becomes: ashes, embers and the officer standing in them. Back (or "Restore the page") brings
// the original page back: nothing was closed.
import { MARCH, COLORS } from './pixelart.js';

const host = (new URLSearchParams(location.search).get('host') || 'This page').slice(0, 120);
document.getElementById('host').textContent = host;
document.title = `Condemned: ${host}`;
document.getElementById('back').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'returnNow' }).catch(() => {}));
document.getElementById('restore').addEventListener('click', () => history.back());
document.getElementById('back').focus();

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('ash');
const g = canvas.getContext('2d');
const PX = 6;
let W = 0, H = 0, embers = [];
function size() {
  W = Math.ceil(innerWidth / PX); H = Math.ceil(innerHeight / PX);
  canvas.width = W; canvas.height = H;
  embers = Array.from({ length: Math.round(W * H / 90) }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 0.05 + Math.random() * 0.25, h: Math.random() }));
}
size();
addEventListener('resize', size);

const FRAME_MS = 80; // about 12 frames a second is plenty for pixel art
let last = 0;
let raf = 0;
function frame(t) {
  raf = 0;
  if (document.hidden) return; // resumes on visibilitychange
  if (t - last >= FRAME_MS) { last = t; draw(); }
  raf = requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce && !raf) raf = requestAnimationFrame(frame); });

function draw() {
  g.fillStyle = '#120d0a';
  g.fillRect(0, 0, W, H);
  // charred ground with smouldering cracks
  for (let x = 0; x < W; x += 1) {
    const top = H - 10 - Math.round(3 * Math.sin(x / 7) + 2 * Math.sin(x / 3));
    g.fillStyle = '#1e1512'; g.fillRect(x, top, 1, H - top);
    if (Math.random() < 0.04) { g.fillStyle = '#ff6a1a'; g.fillRect(x, top + 1 + Math.floor(Math.random() * 6), 1, 1); }
  }
  // the officer, standing in the ashes
  const sx = Math.round(W * 0.78 - MARCH.rows[0].length / 2), sy = H - MARCH.rows.length - 8;
  MARCH.rows.forEach((row, y) => [...row].forEach((k, x) => {
    if (k === '.') return;
    const c = (k === 'r' || k === 'F') && Math.random() < 0.3 ? [255, 220, 120] : COLORS[k];
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    g.fillRect(sx + x, sy + y, 1, 1);
  }));
  // rising embers
  for (const e of embers) {
    g.fillStyle = e.h > 0.7 ? '#ffd27a' : e.h > 0.35 ? '#ff7a1a' : '#a8320f';
    g.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
    if (!reduce) { e.y -= e.v; e.x += Math.sin((e.y + e.h * 50) / 9) * 0.08; if (e.y < 0) { e.y = H; e.x = Math.random() * W; } }
  }
}
draw();
if (!reduce) raf = requestAnimationFrame(frame);
