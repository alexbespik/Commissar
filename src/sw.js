// Service worker: listens to the browser, runs the session state machine (core.js) and speaks.
// All listeners are registered at the top level; all state is in chrome.storage.local (store.js), so it does not
// matter when Chrome stops and restarts this worker.
import {
  driftStatus, classify, step, newSession, verdictOf, maySpeak, pickClip, sanitizePack, nextDueIn, hostOf, pageKey, pathKey,
  matchesList, TRIGGERS, subjectWords, punishmentFor,
} from './core.js';
import {
  serial, getSettings, saveSettings, getSession, setSession, getVerdicts, liveVerdicts, putVerdict, swapSnapshot,
  pushHistory,
} from './store.js';
import { playClip, speakText, stopAudio } from './audio.js';
import { askAbout } from './gemini.js';
import { showOverlay, removeOverlay } from './overlay.js';
import './answers.js'; // a plain script shared with the content script: sets globalThis.CommissarAnswers

const TICK = 'tick';
const ALL_URLS = '<all_urls>';

// ------------------------------------------------------------------ voice packs

let packsPromise = null;
async function loadPacks() {
  if (!packsPromise) {
    packsPromise = (async () => {
      const ids = await fetch(chrome.runtime.getURL('packs.json')).then((r) => r.json()).catch(() => []);
      const packs = [];
      for (const id of Array.isArray(ids) ? ids.slice(0, 30) : []) {
        if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,40}$/.test(id)) continue;
        try {
          const manifest = await fetch(chrome.runtime.getURL(`${id}/manifest.json`)).then((r) => r.json());
          const captions = await fetch(chrome.runtime.getURL(`captions/${id}.json`)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
          const pack = sanitizePack(id, manifest, captions);
          if (pack) packs.push(pack);
        } catch { /* a broken pack is skipped */ }
      }
      return packs;
    })();
  }
  return packsPromise;
}

// ------------------------------------------------------------------ output

const TONE = { abandon: 'warn', back: 'good', focusBlock: 'good', endGood: 'good', quizPass: 'good', allDone: 'good', start: 'info', stop: 'info' };


/**
 * Speaks one trigger: a clip from the chosen persona(s), the optional browser voice, and the banner on `tab`.
 * Returns {lastSpokenAt, lastFile} for the session, or null when nothing was said.
 */
async function speak(trigger, { settings, tab, lastFile = '', meta = '', fx = null, silent = false }) {
  const packs = await loadPacks();
  const clip = pickClip(packs, settings, trigger, Math.random, lastFile);
  const caption = clip?.caption || TRIGGERS[trigger]?.caption || '';
  // what happened is kept for the popup ("last reaction"), so a silent extension can be diagnosed at a glance
  if (silent) { // speech held back by the throttle: only the punishment's effects are shown
    if (fx?.effects?.length) present(tab, settings, { name: 'Commissar', caption: TRIGGERS[trigger]?.caption || '', tone: 'warn', meta, fx });
    return null;
  }
  const note = (voice) => chrome.storage.local.set({ lastReaction: { trigger, at: Date.now(), voice, persona: clip?.packName || '' } }).catch(() => {});
  if (clip) {
    playClip({ path: `${clip.packId}/${clip.file}`, rough: settings.rough[clip.packId] || 0, volume: settings.volume })
      .then(() => note('played'), (e) => {
        note(`voice failed: ${String(e?.message || e).slice(0, 120)}`);
        if (settings.ttsFallback) speakText(caption, settings.volume);
      });
  } else if (settings.ttsFallback || !packs.length) { // no voice packs installed at all: the browser voice speaks
    speakText(caption, settings.volume);
    note('browser voice');
  } else {
    note('no recorded line for this event');
  }
  present(tab, settings, { name: clip?.packName || 'Commissar', caption, tone: TONE[trigger] || 'warn', meta, fx });
  return clip || settings.ttsFallback || !packs.length ? { lastSpokenAt: Date.now(), lastFile: clip?.file || '' } : null;
}

/** The banner, with the punishment's effects, on `tab` (when banners are on and the page allows scripts). */
function present(tab, settings, { name, caption, tone, meta, fx }) {
  const effects = fx?.effects || [];
  if (!(settings.overlay || effects.length) || tab?.id == null || !/^https?:/i.test(tab.url || '')) return;
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: showOverlay,
    args: [{ name, caption, tone, meta, effects, countdownS: fx?.returnInS || 0, lockoutS: fx?.lockoutS || 0, penance: settings.penance }],
  }).catch(() => { /* no access to this site, or a page scripts cannot run on: voice only */ });
}

const BADGE = { study: ['ON', '#2e7d32'], distraction: ['!', '#c0392b'], idle: ['zz', '#7f6a3a'], locked: ['', '#555'], away: ['ON', '#555'], neutral: ['ON', '#555'] };
function badge(session) {
  const [text, color] = session?.active ? BADGE[session.status] || BADGE.neutral : ['', '#555'];
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

// ------------------------------------------------------------------ the watch loop

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  return tab || null;
}

const DAY = 24 * 3600 * 1000;
const senseKey = (url) => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return ''; } };

async function pageSenseFor(url) {
  const { pageSense = {} } = await chrome.storage.local.get('pageSense');
  const e = pageSense[senseKey(url)];
  return e && Date.now() - e.at < DAY ? e.v : '';
}

/** Looks at what you are doing now, advances the session and says what it triggers. */
async function evaluate() {
  const session = await getSession();
  if (!session?.active) { badge(null); return; }
  const settings = await getSettings();
  const now = Date.now();
  const idle = await chrome.idle.queryState(Math.round(settings.idleMinutes * 60)).catch(() => 'active');
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const tab = await currentTab();
  let status;
  let verdict = '';
  // in another app: the browser's active tab is not what you are looking at (no effects or returns on it)
  const outside = idle !== 'locked' && idle !== 'idle' && !win?.focused;
  if (idle === 'locked') status = 'locked';
  else if (idle === 'idle') status = 'idle';
  else if (outside) status = settings.punishOutsideBrowser ? 'distraction' : 'away';
  else {
    const verdicts = liveVerdicts(await getVerdicts(), now);
    const sensed = tab?.url ? await pageSenseFor(tab.url) : '';
    verdict = classify(tab?.url || '', tab?.title || '', settings, session.subject, verdicts);
    if (verdict === 'unknown' && sensed) verdict = sensed;
    status = verdict === 'unknown' ? 'neutral' : verdict;
  }
  // a page nothing could judge: remember since when you are on it (drift to distraction, optional Gemini check)
  const pageNow = verdict === 'unknown' && tab?.url ? pathKey(tab.url) : '';
  const tracked = pageNow && session.unknownKey === pageNow ? session : { ...session, unknownKey: pageNow, unknownSince: pageNow ? now : 0, geminiAsked: false };
  if (pageNow) status = driftStatus(tracked, now, settings);
  const res = step(tracked, status, now, settings, hostOf(tab?.url || ''));
  const next = res.session;

  // optional Gemini check for a page the local rules could not decide, once you have stayed on it a while
  if (pageNow && settings.gemini.enabled && !next.geminiAsked) {
    const key = pageNow;
    if (now - next.unknownSince >= settings.gemini.afterSeconds * 1000) {
      const known = (await getVerdicts())[key];
      const expired = known && (known.v === 'unknown' ? known.until < now : now - known.at >= 7 * DAY);
      if (!known || expired) {
        next.geminiAsked = true; // once per visit
        askAbout({ url: tab.url, title: tab.title, subject: session.subject, settings, tabId: tab.id })
          .then((v) => { if (v) schedule(); }, (e) => console.warn('gemini', e));
      }
    }
  }

  // remember the last tab you studied on: it is where a forced return takes you
  if (status === 'study' && tab?.id != null) next.studyTab = { tabId: tab.id, url: tab.url };

  // a forced return that has come due (cancelled by step() if you went back on your own)
  if (next.pendingReturn && now >= next.pendingReturn.at) {
    const pr = next.pendingReturn;
    next.pendingReturn = null;
    if (status === 'distraction' && tab?.id === pr.fromTabId) await returnToStudy(next, settings);
  }

  let spoke = false;
  for (const trigger of res.triggers) {
    // our own switch back to the study tab is not something to praise
    if ((trigger === 'back' || trigger === 'returned') && now - (next.forcedReturnAt || 0) < 15_000) continue;
    const fx = punishmentFor(trigger, next, settings);
    if (outside) { fx.effects = []; fx.returnInS = 0; fx.lockoutS = 0; } // the active tab is not what you are looking at
    // one forced return (and one lockout) at a time: a repeated desertion must not push it back or renew the lockout
    if (next.pendingReturn) {
      fx.returnInS = 0;
      if (fx.effects.includes('lockout')) { fx.effects = fx.effects.filter((e) => e !== 'lockout'); fx.lockoutS = 0; fx.say = 'deserted'; }
    }
    const punished = fx.effects.length || fx.returnInS || fx.notify || fx.focusWindow;
    if (punished) next.punishments = (next.punishments || 0) + 1;
    if (fx.returnInS && tab?.id != null && next.studyTab && next.studyTab.tabId !== tab.id) {
      next.pendingReturn = { at: now + fx.returnInS * 1000, fromTabId: tab.id };
    }
    if (fx.effects.includes('lockout') && tab?.id != null) next.lockoutTabs = [...new Set([...(next.lockoutTabs || []), tab.id])].slice(-20);
    if (fx.notify) notify(fx.say, settings);
    if (fx.focusWindow) { next.focusedOnce = true; next.forcedReturnAt = now; bringBrowserForward(next); }
    const say = !spoke && maySpeak(fx.say, next.lastSpokenAt, now);
    const said = await speak(fx.say, { settings, tab, lastFile: next.lastFile, meta: metaFor(trigger, next), fx, silent: !say });
    if (said) { Object.assign(next, said); spoke = true; } // one line per look; effects still show
  }
  await setSession(next);
  badge(next);
  const due = nextDueIn(next, Date.now(), settings);
  if (due > 0 && due < 25_000) setTimeout(schedule, due + 300); // sooner than the next 30 s alarm
}

/** Switches to the tab you last studied on, if it still exists and still counts as study. Never opens or closes tabs. */
async function returnToStudy(session, settings) {
  const st = session.studyTab;
  if (!st) return false;
  const tab = await chrome.tabs.get(st.tabId).catch(() => null);
  if (!tab) { session.studyTab = null; return false; }
  let verdict = classify(tab.url || '', tab.title || '', settings, session.subject, liveVerdicts(await getVerdicts()));
  if (verdict === 'unknown') verdict = (await pageSenseFor(tab.url || '')) || verdict; // same rule as evaluate()
  if (verdict !== 'study') return false;
  await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  session.forcedReturnAt = Date.now();
  return true;
}

/** A system notification (optional permission; macOS Focus or notification settings may hide it). */
function notify(trigger, settings) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create(`commissar-${Date.now()}`, {
    type: 'basic', iconUrl: 'icons/icon128.png', title: 'Commissar Study Watch',
    message: TRIGGERS[trigger]?.caption || 'Return to your materials.', priority: 1,
  }).catch?.(() => {});
}

/** Harsh discipline only, once per time away: flash the browser, then try to bring it to the front (best effort). */
async function bringBrowserForward(session) {
  const st = session.studyTab && (await chrome.tabs.get(session.studyTab.tabId).catch(() => null));
  const win = st ? { id: st.windowId } : await chrome.windows.getLastFocused().catch(() => null);
  if (!win?.id) return;
  await chrome.windows.update(win.id, { drawAttention: true }).catch(() => {});
  await chrome.windows.update(win.id, { focused: true }).catch(() => {});
}

/** Takes every banner and lockout off the tabs that may have one (session end, discipline off). */
async function clearOverlays(session, { keepCurrent = false } = {}) {
  const ids = new Set([...(session?.lockoutTabs || [])]);
  const tab = await currentTab();
  if (tab?.id != null) { if (keepCurrent) ids.delete(tab.id); else ids.add(tab.id); }
  for (const id of ids) chrome.scripting.executeScript({ target: { tabId: id }, func: removeOverlay }).catch(() => {});
}

function metaFor(trigger, s) {
  if (trigger === 'distracted' || trigger === 'deserted' || trigger === 'lockout') return `${s.lastHost || 'this page'} · strike ${s.strikes}`;
  if (trigger === 'away') return `${Math.round((s.awayMs || 0) / 60000)} min away from the browser this session`;
  if (trigger === 'focusBlock') return `${Math.round(s.focusMs / 60000)} focused minutes this session`;
  return '';
}

const schedule = () => serial(evaluate).catch((e) => console.warn('evaluate', e));

// ------------------------------------------------------------------ session control

async function startSession(subject) {
  const settings = await getSettings();
  const session = newSession(Date.now(), subject);
  const said = await speak('start', { settings, tab: await currentTab() });
  if (said) Object.assign(session, said);
  await setSession(session);
  await chrome.alarms.create(TICK, { periodInMinutes: 0.5 });
  badge(session);
  await evaluate();
  return session;
}

async function stopSession() {
  const session = await getSession();
  if (!session?.active) return null;
  const settings = await getSettings();
  const { session: done } = step(session, 'locked', Date.now(), settings); // count up to now
  done.active = false;
  done.pendingReturn = null;
  await clearOverlays(done, { keepCurrent: true }); // the end banner replaces whatever is on the current tab
  const result = verdictOf(done);
  await speak(result, {
    settings, tab: await currentTab(),
    meta: `${Math.round(done.focusMs / 60000)} min focused · ${Math.round(done.distractMs / 60000)} min distracted · ${done.strikes} strikes`,
  });
  await setSession(done);
  await chrome.alarms.clear(TICK);
  await pushHistory({
    startedAt: done.startedAt, endedAt: Date.now(), subject: done.subject, focusMs: done.focusMs,
    distractMs: done.distractMs, strikes: done.strikes, answers: done.answers, punishments: done.punishments || 0,
    awayMs: done.awayMs || 0, result,
  });
  badge(null);
  return done;
}

// ------------------------------------------------------------------ answers read off quiz pages

// When a page is first loaded, its grades are compared with the stored snapshot only if that is from the same
// sitting: the same tab within 3 hours (a reload after Submit), or any tab within 10 minutes. Otherwise (coming back
// to an old assignment) they are a silent baseline. Later reports from an open page always compare.
const FRESH_MS = 10 * 60_000;
const SAME_TAB_MS = 3 * 3600_000;
const ANSWER_GAP_MS = 4000;     // at most one answer reaction per tab this often
const lastAnswerAt = new Map(); // tabId -> time (memory only: losing it when the worker sleeps is harmless)

/** How much grading a snapshot shows: submissions, scored questions and marks. It never drops for real. */
function gradedness(snap) {
  let n = 0;
  for (const q of Object.values(snap.questions || {})) n += (q.subs || 0) + (q.score != null ? 1 : 0) + (q.c || 0) + (q.i || 0) + (q.p || 0);
  const m = snap.marks || {};
  return n + (m.c || 0) + (m.i || 0) + (m.p || 0);
}

async function onAnswers(msg, tab) {
  if (typeof msg.key !== 'string' || msg.key.length > 200 || !msg.snap || typeof msg.snap !== 'object') return;
  if (JSON.stringify(msg.snap).length > 40_000) return; // a hostile page cannot fill the extension's storage
  const A = globalThis.CommissarAnswers;
  const { answerSnaps = {} } = await chrome.storage.local.get('answerSnaps');
  const stored = answerSnaps[msg.key];
  // a page still drawing (or re-drawing) shows less than before: neither store it nor compare with it
  const sameSitting = (e) => e && (!msg.first || Date.now() - e.at < FRESH_MS || (e.tabId === tab?.id && Date.now() - e.at < SAME_TAB_MS));
  if (sameSitting(stored) && gradedness(msg.snap) < gradedness(stored.snap)) return;
  const prevEntry = await swapSnapshot(msg.key, msg.snap, tab?.id);
  const prev = sameSitting(prevEntry) ? prevEntry.snap : null; // otherwise: a new, silent baseline
  const change = A.diff(prev, msg.snap);
  const trigger = A.triggerFor(change);
  if (!trigger) return;
  const now = Date.now();
  if (tab?.id != null && now - (lastAnswerAt.get(tab.id) || 0) < ANSWER_GAP_MS) return;
  if (tab?.id != null) lastAnswerAt.set(tab.id, now);
  const settings = await getSettings();
  const session = await getSession();
  const live = session?.active;
  if (!live && !settings.answersAlways) return;
  const n = change.results.slice(0, 50);
  const meta = n.length > 1 ? `${n.filter((r) => r === 'pass').length} right · ${n.filter((r) => r !== 'pass').length} not` : '';
  const said = await speak(trigger, { settings, tab, lastFile: session?.lastFile || '', meta });
  if (live) {
    const next = { ...session, answers: { ...(session.answers || { pass: 0, fail: 0, partial: 0 }) } };
    for (const r of n) next.answers[r] = (next.answers[r] || 0) + 1;
    if (said) Object.assign(next, said);
    await setSession(next);
  }
}

async function onPageSense(msg, tab) {
  const key = senseKey(tab?.url || '');
  if (msg.verdict !== 'study' || !key || !/^https?:/.test(key)) return;
  const settings = await getSettings();
  if (matchesList(tab.url, settings.blocklist)) return; // your block list wins over the page's text
  const { pageSense = {} } = await chrome.storage.local.get('pageSense');
  const now = Date.now();
  for (const k of Object.keys(pageSense)) if (now - pageSense[k].at >= DAY) delete pageSense[k];
  pageSense[key] = { v: 'study', at: now };
  const keys = Object.keys(pageSense);
  if (keys.length > 300) keys.sort((a, b) => pageSense[a].at - pageSense[b].at).slice(0, keys.length - 300).forEach((k) => delete pageSense[k]);
  await chrome.storage.local.set({ pageSense });
  schedule();
}

// ------------------------------------------------------------------ content scripts for taught sites / all sites

let syncChain = Promise.resolve();
function syncContentScripts() {
  syncChain = syncChain.then(doSync, doSync).catch((e) => console.warn('sync', e));
  return syncChain;
}

async function doSync() {
  const settings = await getSettings();
  const have = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  if (have.length) await chrome.scripting.unregisterContentScripts({ ids: have.map((s) => s.id) }).catch(() => {});
  const all = await chrome.permissions.contains({ origins: [ALL_URLS] });
  const scripts = [];
  const base = { js: ['src/answers.js', 'src/watch.js'], runAt: 'document_idle', persistAcrossSessions: true };
  if (all && (settings.autoDetect || settings.readPages || settings.quizRules.length)) {
    scripts.push({ ...base, id: 'all-sites', matches: ['http://*/*', 'https://*/*'] });
  } else {
    for (const rule of settings.quizRules) {
      const origins = rule.hosts.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]);
      if (await chrome.permissions.contains({ origins })) scripts.push({ ...base, id: `rule-${rule.hosts[0]}`, matches: origins });
    }
  }
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts).catch((e) => console.warn('register', e));
}

// ------------------------------------------------------------------ listeners (top level, registered every start)

async function init() {
  // content scripts may not read storage (the Gemini key, history): they ask the worker for what they need
  try { await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }); } catch { /* older browser: not fatal */ }
  const settings = await getSettings();
  chrome.idle.setDetectionInterval(Math.max(15, Math.round(settings.idleMinutes * 60)));
  const session = await getSession();
  if (session?.active) {
    if (!(await chrome.alarms.get(TICK))) await chrome.alarms.create(TICK, { periodInMinutes: 0.5 });
  }
  badge(session);
}

// after an install, update or reload, pages that were already open still have the old, disconnected page script:
// put a fresh one into the open WebAssign tabs (and every tab when all-sites access is on)
async function reattach() {
  const s = await getSettings();
  const all = (await chrome.permissions.contains({ origins: [ALL_URLS] }).catch(() => false))
    && (s.autoDetect || s.readPages || s.quizRules.length > 0); // the same condition as the all-sites registration
  const tabs = await chrome.tabs.query(all ? { url: ['http://*/*', 'https://*/*'] } : { url: ['*://*.webassign.net/*'] }).catch(() => []);
  for (const t of tabs.slice(0, 100)) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['src/answers.js', 'src/watch.js'] }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => { init(); syncContentScripts(); reattach(); });
chrome.runtime.onStartup.addListener(() => { init(); syncContentScripts(); });
chrome.permissions.onAdded.addListener(() => syncContentScripts());
chrome.permissions.onRemoved.addListener(() => syncContentScripts());
chrome.alarms.onAlarm.addListener((a) => { if (a.name === TICK) schedule(); });
chrome.tabs.onActivated.addListener(() => schedule());
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (tab.active && (info.url || info.title || info.status === 'complete')) schedule();
});
let focusTimer = 0;
chrome.windows.onFocusChanged.addListener(() => {
  clearTimeout(focusTimer); // focus flickers to "none" while switching windows: wait for it to settle
  focusTimer = setTimeout(schedule, 1500);
});
chrome.idle.onStateChanged.addListener(() => schedule());
chrome.tabs.onRemoved?.addListener((tabId) => serial(async () => {
  const s = await getSession();
  if (s?.studyTab?.tabId === tabId) await setSession({ ...s, studyTab: null });
}).catch(() => {}));
chrome.tabs.onReplaced?.addListener((added, removed) => serial(async () => {
  const s = await getSession();
  if (s?.studyTab?.tabId === removed) await setSession({ ...s, studyTab: { ...s.studyTab, tabId: added } });
}).catch(() => {}));
const onNotificationClick = () => serial(async () => {
  const s = await getSession();
  if (s?.active && (await returnToStudy(s, await getSettings()))) await setSession(s);
}).catch(() => {});
let clickHooked = false;
function hookNotificationClicks() {
  if (clickHooked || !chrome.notifications?.onClicked?.addListener) return;
  chrome.notifications.onClicked.addListener(onNotificationClick);
  clickHooked = true;
}
hookNotificationClicks();
chrome.permissions.onAdded.addListener(hookNotificationClicks); // the optional permission granted while running

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || msg.target === 'offscreen') return undefined;
  // extension pages (popup, options: the options page has a tab too) vs content scripts on web pages, by origin
  // content scripts always come with a tab whose page is a web page; extension pages (popup, options) do not,
  // or (options opened as a tab) their own URL is the extension's
  const extUrl = chrome.runtime.getURL('');
  const trusted = sender.origin === new URL(extUrl).origin || String(sender.url || '').startsWith(extUrl);
  if (!trusted) {
    if (msg.type === 'answers') serial(() => onAnswers(msg, sender.tab)).catch(() => {});
    else if (msg.type === 'pageSense') serial(() => onPageSense(msg, sender.tab)).catch(() => {});
    else if (msg.type === 'watchConfig') {
      (async () => {
        const s = await getSettings();
        const session = await getSession();
        return { ok: true, quizRules: s.quizRules, autoDetect: s.autoDetect, readPages: s.readPages, subjectWords: session?.active ? subjectWords(session.subject) : [] };
      })().then(sendResponse, () => sendResponse({ ok: false }));
      return true;
    }
    return undefined;
  }
  const reply = (p) => p.then((v) => sendResponse({ ok: true, ...v }), (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  switch (msg.type) {
    case 'status':
      reply((async () => {
        await serial(evaluate).catch(() => {});
        const tab = await currentTab();
        const settings = await getSettings();
        const verdicts = liveVerdicts(await getVerdicts());
        const session = await getSession();
        let page = classify(tab?.url || '', tab?.title || '', settings, session?.subject || '', verdicts);
        if (page === 'unknown' && tab?.url && (await pageSenseFor(tab.url))) page = 'study';
        const packs = (await loadPacks()).map((p) => ({ id: p.id, name: p.name, events: Object.keys(p.events) }));
        return { session, settings, packs, page, host: hostOf(tab?.url || '') };
      })());
      return true;
    case 'start': reply(serial(() => startSession(String(msg.subject || ''))).then((session) => ({ session }))); return true;
    case 'stop': reply(serial(stopSession).then((session) => ({ session }))); return true;
    case 'mark':
      reply(serial(async () => {
        const tab = await currentTab();
        const host = hostOf(tab?.url || '');
        if (!host || !['study', 'distraction'].includes(msg.verdict)) return {};
        const s = await getSettings();
        // drop every entry that covers this page (wikipedia.org for en.wikipedia.org too), then add the host
        const allow = s.allowlist.filter((h) => h !== host && !matchesList(tab.url, [h]));
        const block = s.blocklist.filter((h) => h !== host && !matchesList(tab.url, [h]));
        (msg.verdict === 'study' ? allow : block).push(host);
        await saveSettings({ allowlist: allow, blocklist: block });
        await putVerdict(pageKey(tab.url), { v: msg.verdict, at: Date.now(), src: 'hand' });
        schedule();
        return { host };
      }));
      return true;
    case 'preview':
      reply((async () => {
        const settings = await getSettings();
        const s = msg.persona ? { ...settings, persona: msg.persona } : settings;
        await speak(String(msg.trigger || 'start'), { settings: s, tab: await currentTab() });
        return {};
      })());
      return true;
    case 'settingsChanged':
      reply((async () => {
        packsPromise = null;
        await init();
        await syncContentScripts();
        if ((await getSettings()).discipline === 'off') await clearOverlays(await getSession());
        schedule();
        return {};
      })());
      return true;
    case 'returnNow':
      reply(serial(async () => {
        const s = await getSession();
        if (!s?.active) return { returned: false };
        const ok = await returnToStudy(s, await getSettings());
        await setSession(s);
        return { returned: ok };
      }));
      return true;
    case 'setPersona': reply(serial(() => saveSettings({ persona: String(msg.persona || '') })).then(() => ({}))); return true;
    case 'silence': reply(stopAudio().then(() => ({}))); return true;
    default: return undefined;
  }
});

init();
