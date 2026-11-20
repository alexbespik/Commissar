// The Commissar's post. A click here opens his watch window with the Document Picture-in-Picture API: the one kind of
// window a browser can keep on top of other apps (macOS does not let a background app bring its windows forward).
// He stares from it while you study; when you stay out of the browser the service worker sends {target: 'post',
// type: 'scare'} and the pointing / shooting screamer plays in it. The window lives as long as this page does.
import { BUST, COLORS } from './pixelart.js';

// with the camera watch on, the camera runs here while his window is up: this page can ask for the camera, and the
// window is on screen, so it is never slowed down (the offscreen copy works only when the camera is allowed for good)
const cameraWanted = async () => Boolean((await chrome.storage.local.get('settings')).settings?.camera);
async function cameraHere(on) {
  const cam = await import('./camera.js');
  if (!on || !pip) { cam.stopCamera(); return { ok: true }; }
  return cam.startCamera({ source: 'post', win: pip });
}

const $ = (id) => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let pip = null;
let watchTimer = 0;
let ending = false;

/** His face on a 32x32 canvas; the eyes ('r') flicker on `win`'s timers (the PiP's own: this page is minimized and
 * its timers get throttled). Returns a stop function. */
function drawFace(canvas, win = window) {
  const g = canvas.getContext('2d');
  const eyes = [];
  BUST.forEach((row, y) => [...row].forEach((k, x) => {
    const c = COLORS[k];
    if (k === '.' || !c) return;
    if (k === 'r') eyes.push([x, y]);
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    g.fillRect(x, y, 1, 1);
  }));
  let alive = true;
  const eyesAt = (hot) => eyes.forEach(([x, y]) => { g.fillStyle = hot ? '#ffe08a' : '#ff281e'; g.fillRect(x, y, 1, 1); });
  // a burst of 3-4 quick flickers every 3-5 s, then rest (a repaint every 160 ms forever kept the CPU busy)
  const burst = (left) => {
    if (!alive || !canvas.isConnected) return;
    if (left <= 0) { eyesAt(false); win.setTimeout(() => burst(3 + Math.floor(Math.random() * 2)), 3000 + Math.random() * 2000); return; }
    eyesAt(Math.random() < 0.6);
    win.setTimeout(() => burst(left - 1), 160);
  };
  if (!reduce) win.setTimeout(() => burst(3), 3000 + Math.random() * 2000);
  return () => { alive = false; };
}
let stopPageFace = drawFace($('face')); // the hidden page's own copy, until his window opens
let stopPipFace = () => {};

// just his face, filling the small window (the outside-resources button is in the popup)
const PIP_CSS = `
  html,body{margin:0;height:100%;background:#070606;overflow:hidden}
  .watch{height:100%;display:flex;align-items:center;justify-content:center}
  .watch canvas{width:min(92vw,92vh);height:min(92vw,92vh);image-rendering:pixelated}
  iframe{position:fixed;inset:0;width:100%;height:100%;border:0}`;

function watch() {
  if (!pip) return;
  pip.clearTimeout(watchTimer);
  stopPipFace(); // a restart must not leave the old flicker loop running
  const d = pip.document;
  const box = d.createElement('div');
  box.className = 'watch';
  const c = d.createElement('canvas');
  c.width = 32; c.height = 32;
  c.title = 'The Commissar is watching you';
  box.append(c);
  d.body.replaceChildren(box);
  stopPageFace(); // the window is open: the page behind it need not animate
  stopPipFace = drawFace(c, pip);
}

function scare(kind, line) {
  if (!pip) return false;
  pip.clearTimeout(watchTimer);
  const d = pip.document;
  const f = d.createElement('iframe');
  const q = new URLSearchParams({ kind: kind === 'shoot' ? 'shoot' : 'point', line: String(line || '').slice(0, 160), embed: '1' });
  f.src = `${chrome.runtime.getURL('src/scare.html')}?${q}`;
  f.title = 'The Commissar';
  stopPipFace(); // the face is gone while the screamer plays
  d.body.replaceChildren(f);
  watchTimer = pip.setTimeout(watch, 16000); // then back on watch
  return true;
}

$('go').addEventListener('click', async () => {
  if (!('documentPictureInPicture' in window)) {
    $('state').textContent = 'This browser cannot keep a window on top. He will catch you when you come back.';
    return;
  }
  try {
    pip = pip || await documentPictureInPicture.requestWindow({ width: 150, height: 150 });
  } catch (e) {
    $('state').textContent = `Could not open his window: ${String(e?.message || e).slice(0, 120)}`;
    return;
  }
  const style = pip.document.createElement('style');
  style.textContent = PIP_CSS;
  pip.document.head.append(style);
  pip.document.title = 'Commissar';
  pip.addEventListener('pagehide', () => {
    pip = null;
    cameraHere(false);
    if (ending) return;
    $('state').textContent = 'He left his post. Put him back.';
    $('go').disabled = false;
    $('go').textContent = 'Post the Commissar';
    chrome.windows.getCurrent().then((w) => chrome.windows.update(w.id, { state: 'normal', focused: true })).catch(() => {});
  });
  watch();
  $('state').textContent = 'He is on watch.';
  $('go').textContent = 'He is on watch';
  $('go').disabled = true;
  if (await cameraWanted()) { // the camera prompt, if any, shows in this window: answer it before it hides
    $('state').textContent = 'He is on watch. Starting the camera…';
    const r = await cameraHere(true);
    $('state').textContent = r.ok ? 'He is on watch, through the camera too.' : `He is on watch. Camera: ${r.error}`;
  }
  // out of the way: the watch window stays up as long as this page lives
  setTimeout(() => chrome.windows.getCurrent().then((w) => chrome.windows.update(w.id, { state: 'minimized' })).catch(() => {}), 1200);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'post' || sender.id !== chrome.runtime.id || sender.tab) return undefined;
  if (msg.type === 'scare') { sendResponse({ shown: scare(msg.kind, msg.line) }); return undefined; }
  if (msg.type === 'end') { ending = true; cameraHere(false); pip?.close(); sendResponse({ ok: true }); setTimeout(() => window.close(), 50); }
  return undefined;
});
$('go').focus();

// the camera watch switched on or off in Settings while he is posted
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings || !pip) return;
  const was = Boolean(changes.settings.oldValue?.camera);
  const now = Boolean(changes.settings.newValue?.camera);
  if (was !== now) cameraHere(now);
});
