// Voice output. A service worker cannot play audio, so clips play in an offscreen document (src/offscreen.html).
// Chrome closes that document after ~30 s of silence, so it is (re)created before every clip. Kept behind
// playClip()/speakText() so a Firefox port can swap in its own player.

const OFFSCREEN = 'src/offscreen.html';
let creating = null;

// The camera watch runs in the same document (one offscreen document per extension). With the camera on it is created
// for USER_MEDIA as well, which keeps it open through silence; whether it was is kept in session storage, because this
// worker can restart at any time.
async function cameraDoc() {
  try { return Boolean((await chrome.storage.session.get('offscreenCamera')).offscreenCamera); } catch { return false; }
}
const markCameraDoc = (v) => { try { chrome.storage.session.set({ offscreenCamera: v }).catch(() => {}); } catch { /* none */ } };

async function ensureOffscreen(camera = null) {
  const url = chrome.runtime.getURL(OFFSCREEN);
  const want = camera ?? (await cameraDoc());
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (open.length && (!want || (await cameraDoc()))) return;
  if (open.length) await chrome.offscreen.closeDocument().catch(() => {}); // made for audio only: again, for the camera too
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN,
      reasons: want ? ['AUDIO_PLAYBACK', 'USER_MEDIA'] : ['AUDIO_PLAYBACK'],
      justification: want ? 'Plays the persona voice lines and runs the on-device camera watch during study sessions.'
        : 'Plays the persona voice lines during study sessions.',
    }).then(() => markCameraDoc(want)).finally(() => { creating = null; });
  }
  await creating;
}

/** Turns the camera watch on or off in the offscreen document, one request at a time (an "off" sent while an "on" is
 * still starting waits for it, so the camera is never left running). Resolves to {ok, error?}. */
let cameraChain = Promise.resolve();
export function setCamera(on) {
  const run = cameraChain.then(() => applyCamera(on), () => applyCamera(on));
  cameraChain = run.catch(() => {});
  return run;
}

async function applyCamera(on) {
  if (!on) {
    const url = chrome.runtime.getURL(OFFSCREEN);
    const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (open.length) {
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'camera', on: false }).catch(() => {});
      if (await cameraDoc()) await chrome.offscreen.closeDocument().catch(() => {}); // the next voice line reopens it for audio only
    }
    markCameraDoc(false);
    return { ok: true };
  }
  await ensureOffscreen(true);
  return (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'camera', on: true }).catch((e) => ({ ok: false, error: String(e?.message || e) }))) || { ok: false };
}

/** Plays a packaged clip. `rough` 0..3 runs it through the gravel chain; `volume` 0..1. */
export async function playClip({ path, rough = 0, volume = 0.9 }) {
  const msg = { target: 'offscreen', type: 'play', url: chrome.runtime.getURL(path), rough, volume };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await ensureOffscreen();
      const r = await chrome.runtime.sendMessage(msg);
      if (r && r.ok === false) throw new Error(r.error || 'clip failed');
      return r;
    } catch (e) {
      // the document closed between the check and the message ("Receiving end does not exist"): once more
      if (attempt || !/receiving end|message port/i.test(String(e?.message))) throw e;
    }
  }
  return null;
}

/** A synthesized sound effect (no file): 'gunshot'. */
export async function playSfx(name, volume = 0.9) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', type: 'sfx', name, volume });
}

export async function stopAudio() {
  chrome.tts?.stop();
  const url = chrome.runtime.getURL(OFFSCREEN);
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (open.length) await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
}

/** The browser's own voice, only for the optional fallback when no pack has a line. */
export function speakText(text, volume = 0.9) {
  if (!text || !chrome.tts) return;
  chrome.tts.speak(text, { rate: 0.92, pitch: 0.6, volume, enqueue: false });
}
