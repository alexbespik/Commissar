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
const sent = [];
const injected = [];
let currentTab = { id: 1, windowId: 1, active: true, url: 'https://en.wikipedia.org/wiki/Integral', title: 'Integral' };

globalThis.chrome = {
  runtime: {
    id: 'testid', getURL: (p) => EXT + p, onMessage: event(), onInstalled: event(), onStartup: event(),
    getContexts: async () => [],
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
  tabs: { query: async () => [currentTab], onActivated: event(), onUpdated: event(), update: async () => ({}) },
  windows: { getLastFocused: async () => ({ id: 1, focused: true }), onFocusChanged: event(), update: async () => ({}) },
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
globalThis.fetch = async (url) => {
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
  assert.deepEqual(fx, ['shake', 'grayscale', 'countdown']);
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
  assert.deepEqual(updates[0], [1, { active: true }]);
  assert.equal(store.session.pendingReturn, null);
  assert.ok(store.session.punishments >= 1);
});
