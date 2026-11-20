// Runs the real service worker (src/sw.js) against a fake chrome.* API: start a session, go to a distracting site,
// and check that a voice line is sent to the offscreen player. Catches wiring regressions the unit tests can't.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = 'chrome-extension://testid/';
const event = () => { const fns = []; return { fns, addListener: (f) => fns.push(f), fire: (...a) => fns.map((f) => f(...a)) }; };
const store = {};
// a stand-in for the Mac helper: answers 'ready', can report an app or a click, records what it was sent
const fakeHelper = {
  posted: [], port: null, version: 2,
  connect() {
    const ev = () => { const fns = []; return { fns, addListener: (f) => fns.push(f) }; };
    const port = { onMessage: ev(), onDisconnect: ev(), postMessage: (m) => fakeHelper.posted.push(m), disconnect: () => {} };
    fakeHelper.port = port;
    setTimeout(() => port.onMessage.fns.forEach((f) => f({ type: 'ready', version: fakeHelper.version })), 5);
    return port;
  },
  say(msg) { this.port.onMessage.fns.forEach((f) => f(msg)); },
};
const sent = [];
const injected = [];
const created = [];
let currentTab = { id: 1, windowId: 1, active: true, url: 'https://en.wikipedia.org/wiki/Integral', title: 'Integral' };

globalThis.chrome = {
  runtime: {
    id: 'testid', getURL: (p) => EXT + p, onMessage: event(), onInstalled: event(), onStartup: event(),
    getContexts: async () => [],
    connectNative: () => fakeHelper.connect(),
    sendMessage: async (msg) => { sent.push(msg); return { ok: true }; },
  },
  storage: { local: {
    get: async (keys) => {
      const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
    },
    set: async (obj) => { Object.assign(store, structuredClone(obj)); },
    setAccessLevel: async () => {},
  } },
  alarms: { create: async () => {}, get: async () => null, clear: async () => true, onAlarm: event() },
  tabs: { query: async (q) => (q?.url ? [] : [currentTab]), onActivated: event(), onUpdated: event(), update: async () => ({}), remove: async () => {} },
  windows: { getLastFocused: async () => ({ id: 1, focused: true }), onFocusChanged: event(), update: async () => ({}), create: async (o) => { created.push(o); return { id: 50 + created.length }; }, remove: async () => {}, get: async () => null },
  idle: { queryState: async () => 'active', setDetectionInterval: () => {}, onStateChanged: event() },
  offscreen: { createDocument: async () => {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  permissions: { contains: async () => true, onAdded: event(), onRemoved: event() },
  scripting: {
    executeScript: async (o) => { injected.push(o); return [{}]; },
    getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => {}, registerContentScripts: async () => {},
  },
  tts: { speak: () => {}, stop: () => {} },
  notifications: { create: async () => '', onClicked: event() },
};
// packs.json, manifests and captions come from disk; a missing pack (fresh clone) just 404s
let geminiAnswer = null; // what the fake Gemini says to the next generateContent call
const geminiCalls = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
    geminiCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiAnswer) }] } }] }) };
  }
  const path = String(url).replace(EXT, '');
  try {
    const text = await readFile(join(ROOT, path), 'utf8');
    return { ok: true, json: async () => JSON.parse(text), text: async () => text };
  } catch { return { ok: false, json: async () => { throw new Error('404'); }, text: async () => '' }; }
};

const settle = () => new Promise((r) => setTimeout(r, 60));
const ask = (msg, sender = { id: 'testid', url: `${EXT}src/popup.html` }) => new Promise((resolve) => {
  const keep = chrome.runtime.onMessage.fns.map((f) => f(msg, sender, resolve));
  if (!keep.some(Boolean)) resolve(undefined);
});

test('a distracting site makes the persona speak and shows the banner', async () => {
  await import('../src/sw.js');
  store.settings = { graceSeconds: 0, persona: 'commissar' };
  const started = await ask({ type: 'start', subject: 'calculus' });
  assert.equal(started?.ok, true, JSON.stringify(started));
  // without the camera nothing of his stays on top of your apps: no post / picture-in-picture window
  assert.ok(!created.some((o) => /src\/post\.html$/.test(o.url)), 'the post window opened without the camera');
  await settle();
  const startLines = sent.filter((m) => m.target === 'offscreen' && m.type === 'play').length;

  currentTab = { id: 2, windowId: 1, active: true, url: 'https://www.reddit.com/r/funny', title: 'funny' };
  chrome.tabs.onActivated.fire({ tabId: 2 });
  await settle();
  const plays = sent.filter((m) => m.target === 'offscreen' && m.type === 'play');
  const packs = JSON.parse(await readFile(join(ROOT, 'packs.json'), 'utf8'));
  const havePack = await readFile(join(ROOT, 'commissar', 'manifest.json'), 'utf8').then(() => true, () => false);
  if (havePack) assert.ok(plays.length > startLines, `no voice line for the distraction (sent: ${JSON.stringify(sent)})`);
  assert.ok(packs.length);
  assert.ok(injected.some((o) => o.args?.[0]?.caption), 'no banner injected');
  assert.equal(store.session.strikes, 1);
  assert.equal(store.session.status, 'distraction');
});

test('the options page (which has a tab) is trusted; a web page is not', async () => {
  const fromOptions = await ask({ type: 'status' }, { id: 'testid', url: `${EXT}src/options.html`, tab: { id: 9, url: `${EXT}src/options.html` } });
  assert.equal(fromOptions?.ok, true);
  const fromPage = await ask({ type: 'stop' }, { id: 'testid', url: 'https://evil.example/', tab: { id: 3, url: 'https://evil.example/' } });
  assert.equal(fromPage, undefined);
  assert.equal(store.session.active, true);
});

test('staying on a distraction brings the countdown, then the return to the study tab', async () => {
  const updates = [];
  chrome.tabs.update = async (id, props) => { updates.push([id, props]); return {}; };
  chrome.tabs.get = async (id) => (id === 1 ? { id: 1, windowId: 1, url: 'https://en.wikipedia.org/wiki/Integral', title: 'Integral' } : null);
  // studying first, so the study tab is known
  currentTab = { id: 1, windowId: 1, active: true, url: 'https://en.wikipedia.org/wiki/Integral', title: 'Integral' };
  chrome.tabs.onActivated.fire({ tabId: 1 });
  await settle();
  assert.equal(store.session.studyTab?.tabId, 1);
  // a minute on reddit already
  currentTab = { id: 2, windowId: 1, active: true, url: 'https://www.reddit.com/r/funny', title: 'funny' };
  chrome.tabs.onActivated.fire({ tabId: 2 });
  await settle();
  Object.assign(store.session, { distractedSince: Date.now() - 70_000, warned: true, lastDesertAt: 0, strikes: 1 });
  injected.length = 0;
  chrome.tabs.onUpdated.fire(2, { title: 'funny' }, currentTab);
  await settle();
  const fx = injected.map((o) => o.args?.[0]?.effects).find((e) => e?.length);
  assert.deepEqual(fx, ['grayscale', 'burn', 'shake', 'countdown']);
  assert.ok(store.session.pendingReturn, 'no return scheduled');
  // another desertion while the return is pending must not push it back
  const due = store.session.pendingReturn.at;
  store.session.lastDesertAt = Date.now() - 200_000;
  chrome.tabs.onUpdated.fire(2, { title: 'funny' }, currentTab);
  await settle();
  assert.equal(store.session.pendingReturn.at, due);
  // the countdown runs out while still on reddit
  store.session.pendingReturn.at = Date.now() - 1;
  chrome.tabs.onUpdated.fire(2, { title: 'funny' }, currentTab);
  await settle();
  // the tab burns: it becomes the condemned page (Back restores it), then you are switched to the study tab
  assert.equal(updates[0][0], 2);
  assert.match(updates[0][1].url, /src\/condemned\.html\?host=reddit\.com$/);
  assert.deepEqual(updates[1], [1, { active: true }]);
  assert.deepEqual(store.session.condemned, ['reddit.com']);
  assert.equal(store.session.pendingReturn, null);
  assert.ok(store.session.punishments >= 1);
});

test('the second desertion locks the page until the penance is written, even after a reload', async () => {
  const updates = [];
  chrome.tabs.update = async (id, props) => { updates.push([id, props]); return {}; };
  const yt = { id: 3, windowId: 1, active: true, url: 'https://www.youtube.com/watch?v=x', title: 'funny cats - YouTube' };
  chrome.tabs.get = async (id) => (id === 1 ? { id: 1, windowId: 1, url: 'https://en.wikipedia.org/wiki/Integral', title: 'Integral' } : id === 3 ? yt : null);
  Object.assign(store.session, { penance: null, lockoutTabs: [], pendingReturn: null, condemned: [], studyTab: { tabId: 1, url: '' } });
  currentTab = yt;
  chrome.tabs.onActivated.fire({ tabId: 3 });
  await settle();
  Object.assign(store.session, { distractedSince: Date.now() - 70_000, warned: true, lastDesertAt: 0, desertions: 1 });
  injected.length = 0;
  chrome.tabs.onUpdated.fire(3, { title: yt.title }, yt);
  await settle();
  const lock = injected.map((o) => o.args?.[0]).find((a) => a?.effects?.includes('lockout'));
  assert.ok(lock, `no lockout injected: ${JSON.stringify(injected.map((o) => o.args?.[0]?.effects))}`);
  assert.ok(lock.effects.includes('burn'), 'the page burns under the lockout');
  assert.equal(lock.penanceTimes, 3);
  assert.ok(store.session.penance, 'penance not owed');
  assert.equal(store.session.pendingReturn, null, 'a timed return would skip the penance');
  assert.deepEqual(store.session.lockoutTabs, [3]);

  // a reload wipes the page: the lockout is put back
  injected.length = 0;
  chrome.tabs.onUpdated.fire(3, { status: 'complete' }, yt);
  await settle();
  assert.ok(injected.some((o) => o.args?.[0]?.effects?.includes('lockout')), 'lockout not re-applied after reload');

  // the frame takes its line and count from the worker, never from its address; a site framing it gets nothing
  const frame = { id: 'testid', url: `${EXT}src/penance.html`, frameId: 4 };
  const cfg = await ask({ type: 'penanceConfig' }, { ...frame, tab: yt });
  assert.deepEqual([cfg.owed, cfg.times, cfg.line], [true, 3, 'I will not desert my studies.']);
  assert.equal((await ask({ type: 'penanceConfig' }, { ...frame, tab: { id: 9, url: 'https://evil.example/' } })).owed, false);
  assert.equal(await ask({ type: 'penanceConfig' }, { ...frame, frameId: 0, tab: yt }), undefined);
  assert.equal(await ask({ type: 'penanceConfig' }, { id: 'testid', url: 'https://evil.example/', frameId: 4, tab: yt }), undefined);

  // only the penance frame inside the locked tab can lift it
  assert.equal(await ask({ type: 'penanceDone' }), undefined);
  assert.equal(await ask({ type: 'penanceDone' }, { id: 'testid', url: `${EXT}src/penance.html?n=3`, frameId: 0, tab: yt }), undefined);
  const other = await ask({ type: 'penanceDone' }, { id: 'testid', url: `${EXT}src/penance.html?n=3`, frameId: 4, tab: { id: 9, url: 'https://x.example/' } });
  assert.equal(other?.done, false);
  assert.ok(store.session.penance);

  store.session.lockoutTabs = [3, 7]; // the penance followed you to another distracting tab too
  injected.length = 0;
  const res = await ask({ type: 'penanceDone' }, { id: 'testid', url: `${EXT}src/penance.html?n=3`, frameId: 4, tab: yt });
  assert.equal(res?.done, true, JSON.stringify(res));
  assert.equal(store.session.penance, null);
  assert.ok(injected.some((o) => o.func?.name === 'removeOverlay' && o.target.tabId === 3), 'lockout not removed');
  assert.ok(injected.some((o) => o.func?.name === 'removeOverlay' && o.target.tabId === 7), 'lockout left on the other tab');
  assert.deepEqual(store.session.lockoutTabs, []);
  assert.equal(updates[0][0], 3);
  assert.match(updates[0][1].url, /src\/condemned\.html\?host=youtube\.com$/);
  assert.ok(updates.some(([id, p]) => id === 1 && p.active), 'not sent back to the study tab');
});

test('out of the browser too long: switched to the study tab and the window pulled forward', async () => {
  const updates = [];
  const winUpdates = [];
  chrome.tabs.update = async (id, props) => { updates.push([id, props]); return {}; };
  chrome.windows.update = async (id, props) => { winUpdates.push([id, props]); return {}; };
  chrome.windows.getLastFocused = async () => ({ id: 1, focused: false });
  Object.assign(store.session, { status: 'away', awaySince: Date.now() - 11_000, awayStage: 0, awayWarned: false, lastAt: Date.now() - 1000 });
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.equal(store.session.awayStage, 1);
  assert.ok(updates.some(([id, p]) => id === 1 && p.active), `study tab not activated: ${JSON.stringify(updates)}`);
  assert.ok(winUpdates.some(([, p]) => p.focused), 'window not focused');
  assert.ok(winUpdates.some(([, p]) => p.drawAttention), 'window not flashed');
  chrome.windows.getLastFocused = async () => ({ id: 1, focused: true });
});

test('screamers play in the always-on-top watch window when it is up, else in a window of their own', async () => {
  chrome.windows.getLastFocused = async () => ({ id: 1, focused: false });
  let watching = true;
  chrome.runtime.sendMessage = async (msg) => { sent.push(msg); return msg.target === 'post' ? { shown: watching } : { ok: true }; };
  created.length = 0;
  sent.length = 0;
  Object.assign(store.session, { status: 'away', awaySince: Date.now() - 21_000, awayStage: 1, awayWarned: true, lastAt: Date.now() - 1000, scareWindowId: null });
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.equal(store.session.awayStage, 2);
  assert.ok(sent.some((m) => m.target === 'post' && m.type === 'scare' && m.kind === 'point'), 'not sent to the watch window');
  assert.ok(!created.some((o) => /scare\.html/.test(o.url)), 'a hidden window was opened as well');
  // no watch window: the old screamer window
  watching = false;
  Object.assign(store.session, { awaySince: Date.now() - 31_000, lastAt: Date.now() - 1000 });
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.ok(created.some((o) => /scare\.html\?kind=shoot/.test(o.url)), 'no fallback screamer window');
  // you come back (on your own, a while after his last pull): he meets you in the browser, where it cannot be missed
  created.length = 0;
  store.session.forcedReturnAt = Date.now() - 20_000;
  chrome.windows.getLastFocused = async () => ({ id: 1, focused: true });
  currentTab = { id: 1, windowId: 1, active: true, url: 'https://en.wikipedia.org/wiki/Integral', title: 'Integral' };
  chrome.windows.onFocusChanged.fire(1);
  await new Promise((r) => setTimeout(r, 1700));
  assert.ok(created.some((o) => /scare\.html\?kind=shoot/.test(o.url)), 'no screamer on return');
  chrome.runtime.sendMessage = async (msg) => { sent.push(msg); return { ok: true }; };
});

test('with a key, every new site is sorted once and the answer is kept', async () => {
  store.settings = { ...store.settings, gemini: { enabled: true, learnSites: true, learnCap: 5 } };
  store.geminiKey = 'test-key';
  geminiAnswer = { verdict: 'distraction', why: 'a celebrity gossip site' };
  const site = { id: 4, windowId: 1, active: true, url: 'https://gossip.example/today', title: 'Stars today' };
  chrome.tabs.get = async (id) => (id === 4 ? site : null);
  currentTab = site;
  chrome.tabs.onActivated.fire({ tabId: 4 });
  await new Promise((r) => setTimeout(r, 4300));
  assert.equal(geminiCalls.length, 1);
  assert.equal(store.learnedSites?.['gossip.example']?.v, 'distraction');
  assert.equal(store.learnedSites['gossip.example'].why, 'a celebrity gossip site');
  // a site on your own lists, or one already known, costs nothing
  chrome.tabs.onActivated.fire({ tabId: 4 });
  const listed = { ...site, id: 5, url: 'https://www.reddit.com/r/x' };
  chrome.tabs.get = async (id) => (id === 4 ? site : id === 5 ? listed : null);
  chrome.tabs.onActivated.fire({ tabId: 5 });
  await new Promise((r) => setTimeout(r, 4300));
  assert.equal(geminiCalls.length, 1);
  // Settings can read it, change it by hand, and load a saved file
  const got = await ask({ type: 'learned' });
  assert.equal(got.sites['gossip.example'].v, 'distraction');
  await ask({ type: 'setLearned', sites: { 'gossip.example': { v: 'neutral', why: 'set by you' } } });
  assert.deepEqual([store.learnedSites['gossip.example'].v, store.learnedSites['gossip.example'].src], ['neutral', 'hand']);
  const fromPage = await ask({ type: 'setLearned', sites: { 'evil.example': { v: 'study' } } }, { id: 'testid', url: 'https://evil.example/', tab: { id: 3, url: 'https://evil.example/' } });
  assert.equal(fromPage, undefined);
  assert.equal(store.learnedSites['evil.example'], undefined);
  store.settings.gemini = { enabled: false };
});

test('outside resources: other apps are excused until the pass runs out', async () => {
  chrome.windows.getLastFocused = async () => ({ id: 1, focused: false });
  Object.assign(store.session, { status: 'study', awaySince: 0, awayStage: 0, awayWarned: false, lastAt: Date.now() - 1000, passUntil: 0, penance: null, lockoutTabs: [] });
  const r = await ask({ type: 'outsidePass' });
  assert.ok(r.passUntil > Date.now() + 9 * 60_000 && r.passUntil <= Date.now() + 10 * 60_000 + 1000);
  const r2 = await ask({ type: 'outsidePass' });
  assert.ok(r2.passUntil > r.passUntil, 'a second press adds time');
  for (let i = 0; i < 3; i += 1) await ask({ type: 'outsidePass' });
  assert.ok(store.session.passUntil <= Date.now() + 30 * 60_000 + 1000, 'never more than 30 minutes ahead');
  store.session.awaySince = 0;
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.equal(store.session.status, 'excused');
  assert.equal(store.session.awaySince, 0);
  // the pass runs out: he says so, and the away clock starts
  sent.length = 0;
  store.session.passUntil = Date.now() - 1;
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.equal(store.session.passUntil, 0);
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.equal(store.session.status, 'away');
  assert.ok(store.session.awaySince > 0);
  const end = await ask({ type: 'outsidePass', end: true });
  assert.equal(end.passUntil, 0);
  chrome.windows.getLastFocused = async () => ({ id: 1, focused: true });
});

test('hopping to another distracting tab does not save the one you deserted on', async () => {
  await settle(); // let the previous test's queued look finish before setting the scene
  const updates = [];
  chrome.tabs.update = async (id, props) => { updates.push([id, props]); return {}; };
  const first = { id: 6, windowId: 1, active: false, url: 'https://www.reddit.com/r/a', title: 'a' };
  const second = { id: 7, windowId: 1, active: true, url: 'https://www.tiktok.com/@x', title: 'x' };
  chrome.tabs.get = async (id) => (id === 1 ? { id: 1, windowId: 1, url: 'https://en.wikipedia.org/wiki/Integral', title: 'Integral' } : id === 6 ? first : id === 7 ? second : null);
  Object.assign(store.session, { status: 'distraction', distractedSince: Date.now() - 40_000, lastDistractAt: Date.now() - 1000, warned: true, lastDesertAt: Date.now() - 30_000,
    pendingReturn: { at: Date.now() - 1, fromTabId: 6, condemn: true, host: 'reddit.com' }, penance: null, lockoutTabs: [], passUntil: 0, lastAt: Date.now() - 1000, studyTab: { tabId: 1, url: '' } });
  currentTab = second;
  chrome.tabs.onActivated.fire({ tabId: 7 });
  await settle();
  const burned = updates.filter(([, p]) => /condemned\.html/.test(p.url || '')).map(([id]) => id).sort();
  assert.deepEqual(burned, [6, 7], `both distracting tabs burn: ${JSON.stringify(updates)}`);
  assert.ok(updates.some(([id, p]) => id === 1 && p.active), 'sent back to study');
});

test('the camera sees a phone: a strike and a screamer; the watch is never fed by a web page', async () => {
  await settle();
  store.settings = { ...store.settings, camera: true };
  Object.assign(store.session, { camPhoneSince: 0, camPhoneWarned: false, strikes: 0, penance: null, lockoutTabs: [] });
  const offscreen = { id: 'testid', url: `${EXT}src/offscreen.html` };
  created.length = 0;
  await ask({ type: 'camera', phone: true, person: true }, offscreen);
  await settle();
  store.session.camPhoneSince = Date.now() - 5000; // it has been in view a while
  await ask({ type: 'camera', phone: true, person: true }, offscreen);
  await settle();
  assert.equal(store.session.strikes, 1);
  assert.equal(store.session.camPhoneWarned, true);
  assert.ok(created.some((o) => /scare\.html\?kind=point/.test(o.url)), 'no screamer for the phone');
  assert.deepEqual([store.cameraState.phone, store.cameraState.person], [true, true]);
  // a web page cannot pretend to be the camera
  await ask({ type: 'camera', phone: true, person: true }, { id: 'testid', url: 'https://evil.example/', tab: { id: 3, url: 'https://evil.example/' } });
  await settle();
  assert.equal(store.session.strikes, 1);
  store.settings.camera = false;
});

test('no keyboard or mouse for a while: the look still runs and says idle', async () => {
  await settle();
  chrome.idle.queryState = async () => 'idle';
  Object.assign(store.session, { status: 'study', idleFired: false, lastAt: Date.now() - 1000, penance: null, lockoutTabs: [] });
  const before = store.session.lastAt;
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.equal(store.session.status, 'idle');
  assert.ok(store.session.lastAt > before, 'the look did not finish');
  assert.equal(store.session.idleFired, true);
  chrome.idle.queryState = async () => 'active';
});

test('the watch window takes over the camera; the background copy stands down', async () => {
  await settle();
  store.settings = { ...store.settings, camera: true };
  Object.assign(store.session, { camSource: 'offscreen', camFatal: true });
  sent.length = 0;
  await ask({ type: 'camera', source: 'post', phone: false, person: true, look: 'screen' }, { id: 'testid', url: `${EXT}src/post.html` });
  await settle();
  assert.equal(store.session.camSource, 'post');
  assert.equal(store.session.camFatal, false);
  assert.equal(store.cameraState.look, 'screen');
  assert.equal(store.cameraState.source, 'post');
  store.settings.camera = false;
});

test('the Mac helper: the app in front decides, screamers go to it, its button grants the pass', async () => {
  await settle();
  store.settings = { ...store.settings, nativeOverlay: true, camera: false, screamers: true, discipline: 'standard' };
  await ask({ type: 'settingsChanged' });
  await settle();
  // connected, but nothing of his stays on screen between screamers
  assert.ok(fakeHelper.port, 'the helper was not started');
  assert.ok(!fakeHelper.posted.some((m) => m.type === 'watch'), 'a watch panel was sent');
  chrome.windows.getLastFocused = async () => ({ id: 1, focused: false });
  Object.assign(store.session, { status: 'study', awaySince: 0, awayStage: 0, awayWarned: false, passUntil: 0, lastAt: Date.now() - 1000, penance: null, lockoutTabs: [] });
  // a study app in front: studying, no away clock
  fakeHelper.say({ type: 'app', name: 'Preview', bundle: 'com.apple.Preview' });
  await settle();
  assert.equal(store.session.status, 'study');
  assert.equal(store.session.awaySince, 0);
  // Telegram: the out-of-browser punishments after 3 s, the screamer on the helper
  fakeHelper.posted.length = 0;
  fakeHelper.say({ type: 'app', name: 'Telegram', bundle: 'ru.keepcoder.Telegram' });
  await settle();
  assert.equal(store.session.status, 'away');
  store.session.awaySince = Date.now() - 7_000; // 7 s in Telegram: past the 2nd stage at 3 s each
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.ok(store.session.awayStage >= 2, `stage ${store.session.awayStage}`);
  assert.ok(fakeHelper.posted.some((m) => m.type === 'scare' && /YOU\.|BANG\./.test(m.html)), 'no screamer on the helper');
  assert.ok(fakeHelper.posted.some((m) => m.type === 'focus'), 'the helper was not asked to bring the browser forward');
  assert.equal(store.session.lastApp, 'Telegram');
  // the panel's button
  fakeHelper.say({ type: 'click', action: 'outsidePass' });
  await settle();
  assert.ok(store.session.passUntil > Date.now());
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.equal(store.session.status, 'excused');
  chrome.windows.getLastFocused = async () => ({ id: 1, focused: true });
  store.settings.nativeOverlay = false;
  store.session.passUntil = 0;
});

test('tracker mode: records time by site and app, forces and says nothing', async () => {
  await settle();
  await ask({ type: 'stop' }); // the overseer session of the tests above
  await settle();
  delete store.trackDays;
  store.settings = { ...store.settings, camera: true, nativeOverlay: true, discipline: 'harsh', screamers: true, graceSeconds: 0, desertSeconds: 15 };
  const tabUpdates = [];
  const winUpdates = [];
  const notes = [];
  chrome.tabs.update = async (id, props) => { tabUpdates.push([id, props]); return {}; };
  chrome.windows.update = async (id, props) => { winUpdates.push([id, props]); return {}; };
  chrome.notifications.create = async (...a) => { notes.push(a); return ''; };
  const started = await ask({ type: 'start', subject: 'calculus', mode: 'tracker' });
  assert.equal(started?.ok, true, JSON.stringify(started));
  assert.equal(started.session.mode, 'tracker');
  await settle();
  const plays = () => sent.filter((m) => m.target === 'offscreen' || m.target === 'post').length;
  const base = { sent: plays(), injected: injected.length, created: created.length, posted: fakeHelper.posted.length };

  currentTab = { id: 2, windowId: 1, active: true, url: 'https://www.reddit.com/r/funny', title: 'funny' };
  chrome.tabs.onActivated.fire({ tabId: 2 });
  await settle();
  store.session.lastAt = Date.now() - 5000; // five seconds on reddit since the last look
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.ok(store.session.apps['reddit.com'].s >= 4000, JSON.stringify(store.session.apps));

  chrome.windows.getLastFocused = async () => ({ id: 1, focused: false });
  fakeHelper.say({ type: 'app', name: 'Telegram', bundle: 'ru.keepcoder.Telegram' });
  await settle();
  // long enough in Telegram for the warning, the pointing and the shot
  Object.assign(store.session, { awaySince: Date.now() - 60_000, lastAt: Date.now() - 4000 });
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.ok(store.session.apps.Telegram.s >= 3000, JSON.stringify(store.session.apps));
  await ask({ type: 'camera', phone: true, person: true }, { id: 'testid', url: `${EXT}src/offscreen.html` });
  await ask({ type: 'outsidePass' });
  await settle();

  assert.equal(plays(), base.sent, 'a message went to the player, the camera or the post window');
  assert.equal(injected.length, base.injected, 'something was injected into a page');
  assert.equal(created.length, base.created, 'a window was opened');
  assert.equal(fakeHelper.posted.length, base.posted, `the helper was sent: ${JSON.stringify(fakeHelper.posted.slice(base.posted).map((m) => m.type))}`);
  assert.deepEqual(notes, []);
  assert.deepEqual(tabUpdates, []);
  assert.deepEqual(winUpdates, []);
  assert.equal(store.session.penance ?? null, null);
  assert.equal(store.session.passUntil || 0, 0);

  chrome.windows.getLastFocused = async () => ({ id: 1, focused: true });
  const r = await ask({ type: 'stop' });
  assert.equal(r?.ok, true);
  const today = new Date().toLocaleDateString('en-CA');
  assert.ok(store.trackDays[today].apps['reddit.com'].s > 0);
  assert.ok(store.trackDays[today].apps.Telegram.s > 0);
  assert.equal(store.history[0].mode, 'tracker');
  assert.equal(store.history[0].result, 'tracked');
  assert.ok(store.history[0].apps.some((a) => a.key === 'Telegram'));
  const view = await ask({ type: 'status' });
  assert.ok(view.today.rows.some((a) => a.key === 'reddit.com'));
  assert.equal(view.last.mode, 'tracker');
  assert.equal(typeof view.helper, 'boolean');
  chrome.tabs.update = async () => ({});
  chrome.windows.update = async () => ({});
  store.settings = { ...store.settings, camera: false, nativeOverlay: false };
});

test('a new day: the old day goes to the log and the session starts a fresh one', async () => {
  await settle();
  await ask({ type: 'start', subject: '', mode: 'tracker' });
  await settle();
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA');
  Object.assign(store.session, { day: yesterday, dayApps: { 'old.example': { w: 1000, s: 0, n: 0 } } });
  chrome.alarms.onAlarm.fire({ name: 'tick' });
  await settle();
  assert.equal(store.trackDays[yesterday].apps['old.example'].w, 1000);
  assert.deepEqual([store.session.day === yesterday, 'old.example' in store.session.dayApps], [false, false]);
  await ask({ type: 'stop' });
});

test('ending the session stops everything (and lets this test run finish)', async () => {
  await settle();
  const r = await ask({ type: 'stop' });
  assert.equal(r?.ok, true);
  assert.equal(store.session.active, false);
});
