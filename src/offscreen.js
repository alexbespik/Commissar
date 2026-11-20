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

// an idle AudioContext still keeps the audio thread running: suspend it when nothing plays
let idleTimer = 0;
function idle(ms = 0) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!current && ctx?.state === 'running') ctx.suspend().catch(() => {}); }, ms);
}

function stop() {
  if (!current) return;
  try { current.pause(); current.src = ''; } catch { /* ignore */ }
  current = null;
  idle(500);
}

function play(url, rough, volume) {
  stop();
  clearTimeout(idleTimer); // about to play: do not suspend
  const audio = new Audio(url);
  current = audio;
  const p = ROUGH[rough];
  const vol = Math.min(1, Math.max(0, Number(volume) || 0));
  try {
    ctx = ctx || new AudioContext();
    ctx.resume().catch(() => {}); // also after a suspend still in flight (queued behind it)
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
  audio.addEventListener('ended', () => { if (current === audio) { current = null; idle(300); } }, { once: true });
  return audio.play();
}

/** A gunshot made from noise: a sharp crack, a low thump, a short tail. */
function gunshot(volume) {
  ctx = ctx || new AudioContext();
  ctx.resume().catch(() => {}); // also after a suspend still in flight (queued behind it)
  idle(1500); // the shot is 0.6 s long
  const now = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
  const src = ctx.createBufferSource(); src.buffer = buf;
  const crack = ctx.createBiquadFilter(); crack.type = 'highpass'; crack.frequency.value = 900;
  const body = ctx.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 2400;
  const gain = ctx.createGain(); gain.gain.setValueAtTime(Math.min(1, Math.max(0, Number(volume) || 0)), now);
  src.connect(body).connect(gain).connect(ctx.destination);
  src.connect(crack).connect(gain);
  const thump = ctx.createOscillator(); thump.type = 'sine';
  thump.frequency.setValueAtTime(110, now); thump.frequency.exponentialRampToValueAtTime(38, now + 0.25);
  const tg = ctx.createGain(); tg.gain.setValueAtTime(0.9 * (Number(volume) || 0), now); tg.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  thump.connect(tg).connect(ctx.destination);
  src.start(now); thump.start(now); thump.stop(now + 0.32);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // only the extension itself, never a content script (those always carry sender.tab). sender.url is not
  // checked: Chrome does not always fill it in for messages from the service worker.
  if (msg?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab) return undefined;
  if (msg.type === 'stop') { stop(); sendResponse({ ok: true }); return undefined; }
  if (msg.type === 'camera') { // the camera watch: loaded only when it is used (the vision files are optional)
    import('./camera.js')
      .then((cam) => (msg.on ? cam.startCamera() : (cam.stopCamera(), { ok: true })))
      .then((r) => sendResponse(r), (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === 'sfx') { try { if (msg.name === 'gunshot') gunshot(msg.volume); sendResponse({ ok: true }); } catch (e) { sendResponse({ ok: false, error: String(e) }); } return undefined; }
  if (msg.type === 'play' && typeof msg.url === 'string' && msg.url.startsWith(BASE)) {
    play(msg.url, msg.rough, msg.volume)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true; // answers asynchronously
  }
  return undefined;
});
