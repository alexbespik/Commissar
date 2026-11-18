// Voice output. A service worker cannot play audio, so clips play in an offscreen document (src/offscreen.html).
// Chrome closes that document after ~30 s of silence, so it is (re)created before every clip. Kept behind
// playClip()/speakText() so a Firefox port can swap in its own player.

const OFFSCREEN = 'src/offscreen.html';
let creating = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN);
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (open.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Plays the persona voice lines during study sessions.',
    }).finally(() => { creating = null; });
  }
  await creating;
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
