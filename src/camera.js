// The camera watch loop. About once a second a frame is checked on this computer for a phone, a person, and which way
// the face points (at the screen, down at paper, or away); the service worker hears {type: 'camera', phone, person,
// look, source} on a change, every look while something needs timing (a phone, looking away or down), and every 15 s
// as a heartbeat. Nothing is recorded, stored or sent anywhere.
// It runs in one of two places:
//   - 'offscreen': the offscreen document (no window; works only when the camera is allowed for good)
//   - 'post': his always-on-top watch window (src/post.js), which can ask for the camera itself and is never
//     throttled, because it is on screen. `win` is the window whose timers and document it uses.
import { createDetector, createFace, lookAt, gazeTracker, smoother, PHONE } from './vision.js';

const EVERY_MS = 1000;
const CALM_MS = 2000; // nothing to see: look half as often
const ALERT_LOOKS = 10; // after anything unusual, this many looks at the fast pace
const BEAT_MS = 15_000;
let stream = null;
let video = null;
let detector = null;
let face = null;
let timer = 0;
let timerWin = null;
let last = null;
let lastSent = 0;
let running = false;
/**
 * How long until the next look. `state`: {look (smoothed), phone (smoothed), raw (the unsmoothed frame's boxes),
 * alertLeft (looks left at the fast pace)}. Returns {delay, alertLeft}. Calm = looking at the screen, no phone, and
 * no whole-frame phone candidate at 0.3 or more; anything else keeps the fast pace for the next 10 looks.
 */
export function nextDelay({ look, phone, raw = [], alertLeft = 0 }) {
  const calm = look === 'screen' && !phone && !raw.some((b) => b.label === PHONE && b.score >= 0.3);
  const left = calm ? Math.max(0, alertLeft - 1) : ALERT_LOOKS;
  return { delay: calm && alertLeft <= 0 ? CALM_MS : EVERY_MS, alertLeft: left };
}

let generation = 0; // a stop during a slow start makes that start stand down

export async function startCamera({ source = 'offscreen', win = window } = {}) {
  if (running) return { ok: true };
  running = true;
  const mine = ++generation;
  const report = (msg) => chrome.runtime.sendMessage({ type: 'camera', source, ...msg }).catch(() => {});
  try {
    detector = detector || await createDetector();
    face = face || await createFace().catch(() => null); // older vision files: phone and person only
    if (mine !== generation) return { ok: false, error: 'stopped' };
    const got = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 5, max: 10 }, facingMode: 'user' }, audio: false });
    if (mine !== generation) { got.getTracks().forEach((t) => t.stop()); return { ok: false, error: 'stopped' }; }
    stream = got;
    video = win.document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    timerWin = win;
    const smooth = smoother();
    const gaze = gazeTracker(); // learns where your face usually points, so the camera's position does not matter
    let errors = 0;
    let alertLeft = ALERT_LOOKS;
    let delay = EVERY_MS;
    const tick = () => {
      if (!running || mine !== generation) return;
      try {
        if (video.readyState >= 2) {
          const objects = lookAt(detector, video);
          const look = face && objects.person ? gaze(face.detect(video)).look : 'none';
          const now = smooth({ ...objects, look });
          const changed = !last || now.phone !== last.phone || now.person !== last.person || now.look !== last.look;
          const timing = now.phone || now.look === 'away' || now.look === 'down' || now.look === 'downRight' || (now.look === 'none' && now.person);
          if (changed || timing || Date.now() - lastSent >= BEAT_MS) {
            last = now;
            lastSent = Date.now();
            report({ phone: now.phone, person: now.person, look: face ? now.look : '' });
          }
          ({ delay, alertLeft } = nextDelay({ look: face ? now.look : (now.person ? 'screen' : 'none'), phone: now.phone, raw: objects.boxes, alertLeft }));
          errors = 0;
        }
      } catch (e) {
        errors += 1;
        if (errors >= 5) { // broken for good: one report, and the camera goes off (the worker can fall back)
          stopCamera();
          report({ error: `Camera watch stopped: ${String(e?.message || e).slice(0, 160)}`, fatal: true });
          return;
        }
      }
      timer = win.setTimeout(tick, delay);
    };
    tick();
    return { ok: true };
  } catch (e) {
    if (mine === generation) stopCamera();
    const why = e?.name === 'NotAllowedError' ? 'Camera not allowed: Settings → Camera watch → Allow the camera.'
      : e?.name === 'NotFoundError' ? 'No camera found.' : String(e?.message || e).slice(0, 200);
    // problems a retry cannot fix: the service worker stops trying until you change the setting
    const fatal = ['NotAllowedError', 'NotFoundError', 'SecurityError'].includes(e?.name) || /vision files are missing/.test(why);
    report({ error: why, fatal });
    return { ok: false, error: why };
  }
}

export function stopCamera() {
  running = false;
  generation += 1;
  try { timerWin?.clearTimeout(timer); } catch { /* that window is gone */ }
  stream?.getTracks().forEach((t) => t.stop()); // the camera light goes off
  stream = null;
  if (video) { video.srcObject = null; video = null; }
  last = null;
  lastSent = 0;
  // free the models' memory; startCamera makes them again when needed
  try { detector?.close(); } catch { /* already closed */ }
  try { face?.close(); } catch { /* already closed */ }
  detector = null;
  face = null;
}

export const cameraRunning = () => running;
