// The link to the Mac helper (native/CommissarOverlay.swift, host "com.commissar.overlay"). Optional: it needs the
// "nativeMessaging" permission (asked for in Settings) and the helper installed with tools/install-overlay.mjs.
// While the port is open the service worker stays alive, and the helper keeps his watch panel on screen over every
// app and reports which app is in front. Everything degrades to the browser-only behaviour when it is not there.

export const HOST = 'com.commissar.overlay';
let port = null;
let ready = false;
let version = 0; // the helper's protocol: 2 draws his panel itself (no page, no WebKit)
let connecting = null;
let handlers = { app: () => {}, click: () => {} };
let lastApp = null; // {name, bundle, at}

// the state Settings shows, kept here and written whole (two quick notes cannot overwrite each other)
let state = { connected: false, error: '', app: '' };
const note = (patch) => {
  state = { ...state, ...patch, at: Date.now() };
  return chrome.storage.local.set({ nativeState: state }).catch(() => {});
};

/** Sets what to do when the helper reports the app in front ({name, bundle}) or a click on his panel (action). */
export function onNative(h) { handlers = { ...handlers, ...h }; }

export const nativeReady = () => Boolean(port && ready);
/** The connected helper's protocol version (0 when none). */
export const nativeVersion = () => (port && ready ? version : 0);
/** The app in front, as last reported (null when the helper is not running). */
export const frontApp = () => (port && ready ? lastApp : null);

/** Connects to the helper. Resolves true once it says it is ready, false when it is not installed or not allowed. */
export async function connectNative() {
  if (port && ready) return true;
  if (connecting) return connecting;
  connecting = (async () => {
    const allowed = await chrome.permissions?.contains({ permissions: ['nativeMessaging'] }).catch(() => false);
    if (!allowed || !chrome.runtime.connectNative) { await note({ connected: false, error: 'Not allowed yet: tick "Use the Mac helper" in Settings.' }); return false; }
    return new Promise((resolve) => {
      let p;
      try { p = chrome.runtime.connectNative(HOST); } catch (e) { note({ connected: false, error: String(e?.message || e) }); resolve(false); return; }
      port = p;
      ready = false;
      const timer = setTimeout(() => { // no 'ready' in 5 s: let this one go, so a retry does not start a second helper
        if (port === p) { port = null; ready = false; }
        try { p.disconnect(); } catch { /* gone */ }
        note({ connected: false, error: 'The helper did not answer.' });
        resolve(false);
      }, 5000);
      p.onMessage.addListener((msg) => {
        if (port !== p) return; // an old port that was let go
        if (msg?.type === 'ready') { ready = true; version = Number(msg.version) || 1; clearTimeout(timer); note({ connected: true, error: '' }); resolve(true); }
        else if (msg?.type === 'app') {
          if (lastApp && lastApp.name === String(msg.name || '').slice(0, 80) && lastApp.bundle === String(msg.bundle || '').slice(0, 120)) return; // same app again
          lastApp = { name: String(msg.name || '').slice(0, 80), bundle: String(msg.bundle || '').slice(0, 120), at: Date.now() };
          note({ app: lastApp.name });
          handlers.app(lastApp);
        } else if (msg?.type === 'click' && ['outsidePass', 'returnNow'].includes(msg.action)) handlers.click(msg.action);
      });
      p.onDisconnect.addListener(() => {
        const why = chrome.runtime.lastError?.message || 'The helper stopped.';
        if (port === p) { port = null; ready = false; lastApp = null; }
        clearTimeout(timer);
        note({ connected: false, app: '', error: /not found/i.test(why) ? 'Not installed: run the install command shown in Settings.' : why });
        resolve(false);
      });
    });
  })().finally(() => { connecting = null; });
  return connecting;
}

export function disconnectNative() {
  if (!port) return;
  try { port.postMessage({ type: 'hide' }); port.disconnect(); } catch { /* already gone */ }
  port = null;
  ready = false;
  lastApp = null;
  note({ connected: false, app: '', error: '' });
}

/** Sends one message to the helper; false when it is not connected. */
export function toNative(msg) {
  if (!port || !ready) return false;
  try { port.postMessage(msg); return true; } catch { return false; }
}
