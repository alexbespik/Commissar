// Plays one clip at a time for the service worker. The "rough" chain is ported from SciEdu-Studio commissar.js:
// slowed with pitch preservation off (deeper), soft-clipped, bass and "bark" boosted, compressed like a shout.

const ROUGH = {
  1: { rate: 0.93, drive: 4, low: 4, bark: 2 },
  2: { rate: 0.87, drive: 12, low: 7, bark: 4 },
  3: { rate: 0.8, drive: 30, low: 9, bark: 6 },
};
const BASE = chrome.runtime.getURL('');

let ctx = null;
let current = null;
const curves = new Map();

function clipCurve(k) {
  if (!curves.has(k)) {
    const n = 2048;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i += 1) { const x = (i * 2) / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    curves.set(k, c);
  }
  return curves.get(k);
}

function stop() {
  if (!current) return;
  try { current.pause(); current.src = ''; } catch { /* ignore */ }
  current = null;
}

function play(url, rough, volume) {
  stop();
  const audio = new Audio(url);
  current = audio;
  const p = ROUGH[rough];
  const vol = Math.min(1, Math.max(0, Number(volume) || 0));
  try {
    ctx = ctx || new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const src = ctx.createMediaElementSource(audio);
    const out = ctx.createGain();
    if (p) {
      audio.preservesPitch = false;
      audio.playbackRate = p.rate;
      const shaper = ctx.createWaveShaper(); shaper.curve = clipCurve(p.drive); shaper.oversample = '4x';
      const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 180; low.gain.value = p.low;
      const bark = ctx.createBiquadFilter(); bark.type = 'peaking'; bark.frequency.value = 2200; bark.Q.value = 1.1; bark.gain.value = p.bark;
      const top = ctx.createBiquadFilter(); top.type = 'lowpass'; top.frequency.value = 6500;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -26; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
      out.gain.value = 0.8 * vol; // the clipper adds level: keep it near the clean volume
      src.connect(shaper).connect(low).connect(bark).connect(top).connect(comp).connect(out).connect(ctx.destination);
    } else {
      out.gain.value = vol;
      src.connect(out).connect(ctx.destination);
    }
  } catch {
    audio.volume = vol; // no Web Audio: plain playback
  }
  audio.addEventListener('ended', () => { if (current === audio) current = null; }, { once: true });
  return audio.play();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // only the extension's own service worker (no tab, extension URL) may play or stop
  if (msg?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab || !String(sender.url || '').startsWith(BASE)) return undefined;
  if (msg.type === 'stop') { stop(); sendResponse({ ok: true }); return undefined; }
  if (msg.type === 'play' && typeof msg.url === 'string' && msg.url.startsWith(BASE)) {
    play(msg.url, msg.rough, msg.volume)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true; // answers asynchronously
  }
  return undefined;
});
