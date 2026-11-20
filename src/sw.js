// Service worker: listens to the browser, runs the session state machine (core.js) and speaks.
// All listeners are registered at the top level; all state is in chrome.storage.local (store.js), so it does not
// matter when Chrome stops and restarts this worker.
import {
  localDay, driftStatus, classify, step, newSession, verdictOf, maySpeak, pickClip, sanitizePack, nextDueIn, hostOf, pageKey, pathKey,
  matchesList, TRIGGERS, subjectWords, punishmentFor, nextCheckIn, peekSpot, PASS_MINUTES, PASS_MAX_MINUTES, cameraStep, cameraBusy,
  classifyApp, modeCaps, trackKey, trackKind, rollDay, summarize, todayView,
} from './core.js';
import {
  serial, getSettings, saveSettings, getSession, setSession, getVerdicts, liveVerdicts, putVerdict, swapSnapshot,
  pushHistory, getTrackDays, mergeTrackDay,
} from './store.js';
import { playClip, playSfx, speakText, stopAudio, setCamera } from './audio.js';
import { MARCH, COLORS, BUST } from './pixelart.js';
import { askAbout, chatReply, chatStatus, makeQuiz, learnSite, getLearned, putLearned, LEARN_VERDICTS } from './gemini.js';
import { showOverlay, removeOverlay, showPeek } from './overlay.js';
import { connectNative, disconnectNative, toNative, onNative, frontApp, nativeReady, nativeVersion } from './native.js';
import { scareHtml } from './native-html.js';
import { FONT_FACES } from './fonts.js';
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


/** What the running session may do (a tracker one forces and says nothing); no session: everything, as before. */
const liveCaps = async () => { const s = await getSession(); return modeCaps(s?.active ? s : null); };

/**
 * Speaks one trigger: a clip from the chosen persona(s), the optional browser voice, and the banner on `tab`.
 * Returns {lastSpokenAt, lastFile} for the session, or null when nothing was said.
 */
async function speak(trigger, { settings, tab, lastFile = '', meta = '', fx = null, silent = false, force = false }) {
  if (!force && !(await liveCaps()).speak) return null; // force: a test from Settings
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
    args: [{
      name, caption, tone, meta, effects, countdownS: fx?.returnInS || 0, penanceTimes: fx?.penanceTimes || 0, penance: settings.penance,
      sprite: effects.includes('burn') ? { ...MARCH, colors: COLORS } : null, fonts: pageFonts(),
    }],
  }).catch(() => { /* no access to this site, or a page scripts cannot run on: voice only */ });
}

// the bundled font, for in-page overlays (web-accessible files) and the Mac helper (embedded: its pages load nothing)
const pageFonts = () => FONT_FACES.map((f) => ({ ...f, url: chrome.runtime.getURL(f.file) }));
let embeddedFontCss = null;
function fontCss() {
  if (!embeddedFontCss) {
    embeddedFontCss = (async () => {
      let css = '';
      for (const f of FONT_FACES) {
        const bytes = new Uint8Array(await (await fetch(chrome.runtime.getURL(f.file))).arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        css += `@font-face{font-family:'Commissar Mono';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');font-weight:${f.weight};font-style:${f.style};unicode-range:${f.unicodeRange}}`;
      }
      return css;
    })().catch(() => { embeddedFontCss = null; return ''; });
  }
  return embeddedFontCss;
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

/**
 * What classify() gets: {verdicts} (page verdicts: Gemini's, marked by hand) and {learned} (the sites Gemini sorted,
 * minus any site on one of your lists: your lists always decide those).
 */
async function allVerdicts(settings, now = Date.now()) {
  const learned = {};
  for (const [host, e] of Object.entries(await getLearned())) {
    if (!LEARN_VERDICTS.includes(e?.v)) continue;
    const u = `https://${host}/`;
    if (matchesList(u, settings.allowlist) || matchesList(u, settings.blocklist) || matchesList(u, settings.ambiguous)) continue;
    learned[host] = e.v;
  }
  return { verdicts: liveVerdicts(await getVerdicts(), now), learned };
}

// ------------------------------------------------------------------ learning every new site (Gemini, your own key)

const LEARN_DWELL_MS = 4000; // tab cycling past a site does not spend a call
const learnTimers = new Map(); // tabId -> timer
function scheduleLearn(tabId) {
  clearTimeout(learnTimers.get(tabId));
  learnTimers.set(tabId, setTimeout(() => { learnTimers.delete(tabId); maybeLearn(tabId).catch((e) => console.warn('learn', e)); }, LEARN_DWELL_MS));
}

async function maybeLearn(tabId) {
  const settings = await getSettings();
  const g = settings.gemini;
  if (!g.enabled || !g.learnSites) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active || tab.incognito || !/^https?:/i.test(tab.url || '')) return;
  if (!(await getSession())?.active) return; // only while you study: your browsing otherwise is not sent anywhere
  // your own lists already decide these: no call spent on them
  if (matchesList(tab.url, settings.allowlist) || matchesList(tab.url, settings.blocklist) || matchesList(tab.url, settings.ambiguous)) return;
  const entry = await learnSite({ url: tab.url, title: tab.title, settings, tabId: tab.id });
  if (entry) schedule(); // judge the page again with what was learned
}
const senseKey = (url) => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return ''; } };

async function pageSenseFor(url) {
  const { pageSense = {} } = await chrome.storage.local.get('pageSense');
  const e = pageSense[senseKey(url)];
  return e && Date.now() - e.at < DAY ? e.v : '';
}

/** Looks at what you are doing now, advances the session and says what it triggers. */
async function evaluate() {
  let session = await getSession();
  if (!session?.active) { badge(null); return; }
  const settings = await getSettings();
  const now = Date.now();
  const caps = modeCaps(session);
  const rolled = rollDay(session, now); // a new day: yesterday's part goes to the log
  if (rolled.flush) { // saved at once, so an interrupted tick cannot flush the same day twice
    await mergeTrackDay(rolled.flush.day, rolled.flush.apps).catch(() => {});
    await setSession(rolled.session);
  }
  session = rolled.session;
  const idle = await chrome.idle.queryState(Math.round(settings.idleMinutes * 60)).catch(() => 'active');
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const tab = await currentTab();
  let status;
  let verdict = '';
  let appKind = '';
  let app = null;
  // "I need outside resources": other apps and unjudged pages are allowed until passUntil (distraction sites are not)
  const onPass = now < (session.passUntil || 0);
  const known = await allVerdicts(settings, now);
  const judgeBy = onPass ? { ...settings, strictUnknown: false } : settings;
  // no keyboard or mouse, but the camera sees you at the desk and off your phone (reading, writing): not idle
  const busy = idle === 'idle' && cameraBusy(session, now, settings);
  // in another app: the browser's active tab is not what you are looking at (no effects or returns on it)
  const outside = idle !== 'locked' && (idle !== 'idle' || busy) && !win?.focused;
  if (idle === 'locked') status = 'locked';
  else if (idle === 'idle' && !busy) status = 'idle';
  else if (outside) {
    // the Mac helper says which app is in front: a study app (a PDF reader, Anki, notes) is studying; a distraction
    // app (Telegram, Discord, a game) brings the out-of-browser punishments after appDistractSeconds instead
    app = settings.nativeOverlay ? frontApp() : null;
    appKind = app ? classifyApp(app, settings) : '';
    if (app) session.lastApp = app.name;
    status = onPass ? 'excused' : appKind === 'study' ? 'study' : 'away';
  }
  else {
    const sensed = tab?.url ? await pageSenseFor(tab.url) : '';
    verdict = classify(tab?.url || '', tab?.title || '', judgeBy, session.subject, known.verdicts, known.learned);
    if (verdict === 'unknown' && sensed) verdict = sensed;
    status = verdict === 'unknown' ? 'neutral' : verdict;
  }
  // a page nothing could judge: remember since when you are on it (drift to distraction, optional Gemini check)
  const pageNow = verdict === 'unknown' && tab?.url ? pathKey(tab.url) : '';
  const tracked = pageNow && session.unknownKey === pageNow ? session : { ...session, unknownKey: pageNow, unknownSince: pageNow ? now : 0, geminiAsked: false };
  if (pageNow && !onPass) status = driftStatus(tracked, now, settings);
  // a site already burned this session: no patience left (desertion after 15 s)
  const host = hostOf(tab?.url || '');
  const strict = status === 'distraction' && host && (session.condemned || []).includes(host)
    ? { ...settings, desertSeconds: 15 } : settings;
  const stepWith = appKind === 'distraction' ? { ...strict, awaySeconds: settings.appDistractSeconds } : strict;
  // a different kind of app (a neutral one, then Telegram): the away clock starts over at its own pace, so the warning
  // steps are not skipped
  if (status === 'away' && tracked.awaySince && (session.awayKind || '') !== appKind) {
    tracked.awaySince = now;
    tracked.awayStage = 0;
  }
  tracked.awayKind = status === 'away' ? appKind : '';
  // what the time until the next look is booked under (a site or an app), whatever the mode
  const track = { key: trackKey({ idle: status === 'idle' || status === 'locked', outside, app, url: tab?.url || '', incognito: Boolean(tab?.incognito) }), kind: trackKind(status, appKind) };
  const res = step(tracked, status, now, stepWith, host, track);
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
  if (status === 'study' && !outside && tab?.id != null) next.studyTab = { tabId: tab.id, url: tab.url };

  // a forced return that has come due (cancelled by step() if you went back on your own)
  // (cancelled by step() only if you went back to study: hopping to another distraction or app does not save the tab)
  if (caps.punish && next.pendingReturn && now >= next.pendingReturn.at) {
    const pr = next.pendingReturn;
    next.pendingReturn = null;
    if (pr.condemn) {
      const from = tab?.id === pr.fromTabId ? tab : await chrome.tabs.get(pr.fromTabId).catch(() => null);
      const isDistraction = (t) => t && classify(t.url || '', t.title || '', settings, next.subject, known.verdicts, known.learned) === 'distraction';
      if (isDistraction(from)) await condemn(from, next, settings); // the tab you deserted on burns, wherever you are now
      if (status === 'distraction' && !outside && tab?.id != null && tab.id !== pr.fromTabId && isDistraction(tab)) await condemn(tab, next, settings);
    }
    await returnToStudy(next, settings);
  }

  // the outside-resources pass ran out
  if (session.passUntil && now >= session.passUntil) {
    next.passUntil = 0;
    if (caps.punish) res.triggers.push('passEnd');
  }

  // random check-ins, every 1 to 5 minutes while you are in the browser: he peeks in from an edge, "I am watching you"
  if (!caps.checkIn) next.nextCheckInAt = 0;
  else if ((status !== 'study' && status !== 'neutral') || outside) next.nextCheckInAt = nextCheckIn(now); // in the browser only; not right after you come back
  else {
    if (!next.nextCheckInAt) next.nextCheckInAt = nextCheckIn(now);
    else if (now >= next.nextCheckInAt && !res.triggers.length) {
      next.nextCheckInAt = nextCheckIn(now);
      const said = await checkIn(tab, settings, next);
      if (said) Object.assign(next, said);
    }
  }

  let spoke = false;
  for (const trigger of caps.punish ? res.triggers : []) { // a tracker session only records: no voice, no effects
    const fx = punishmentFor(trigger, next, settings);
    // our own switch back to the study tab is not something to praise (a screamer waiting for you still comes)
    // (and when our own pull-back is what brought you, the screamer you got while away was enough)
    if ((trigger === 'back' || trigger === 'returned') && now - (next.forcedReturnAt || 0) < 15_000) continue;
    if (outside) { fx.effects = []; fx.returnInS = 0; fx.penanceTimes = 0; } // the active tab is not what you are looking at
    // one forced return and one penance at a time: a repeated desertion must not push the return back or renew the penance
    if (next.pendingReturn) fx.returnInS = 0;
    if (fx.effects.includes('lockout')) {
      if (next.penance || tab?.id == null) { fx.effects = fx.effects.filter((e) => e !== 'lockout'); fx.penanceTimes = 0; fx.say = 'deserted'; }
      else next.penance = { times: fx.penanceTimes, at: now };
    }
    const punished = fx.effects.length || fx.returnInS || fx.notify || fx.focusWindow;
    if (punished) next.punishments = (next.punishments || 0) + 1;
    if (fx.returnInS && tab?.id != null && (fx.condemn || (next.studyTab && next.studyTab.tabId !== tab.id))) {
      next.pendingReturn = { at: now + fx.returnInS * 1000, fromTabId: tab.id, condemn: fx.condemn, host: hostOf(tab.url || '') };
    }
    if (fx.effects.includes('lockout') && tab?.id != null) next.lockoutTabs = [...new Set([...(next.lockoutTabs || []), tab.id])].slice(-20);
    if (fx.notify && now - (next.lastNotifyAt || 0) >= 30_000) { notify(fx.say, settings, next); next.lastNotifyAt = now; } // not every 10 s
    if (fx.focusWindow) { next.focusedOnce = true; next.forcedReturnAt = now; await pullBack(next, settings); }
    if (fx.screamer) next.scareWindowId = await openScare(fx.screamer, fx.say, next.scareWindowId, settings, { inBrowser: !outside });
    const say = !spoke && maySpeak(fx.say, next.lastSpokenAt, now);
    const said = await speak(fx.say, { settings, tab, lastFile: next.lastFile, meta: metaFor(trigger, next), fx, silent: !say });
    if (said) { Object.assign(next, said); spoke = true; } // one line per look; effects still show
  }
  // the camera watch went quiet (the offscreen document was closed, the camera was taken): start it again
  // (not after a problem retrying cannot fix: the camera blocked, no camera, the vision files missing)
  if (caps.camera && settings.camera && !next.camFatal && now - Math.max(next.camBeat || 0, next.camStartAt || 0) > 45_000 && now - (next.camRetryAt || 0) > 60_000) {
    next.camRetryAt = now;
    next.camSource = 'offscreen'; // the watch window went quiet (closed): back to the offscreen copy
    setCamera(true).catch(() => {});
  }

  // the Mac helper went away (the worker restarted, the helper was quit): connect again
  if (settings.nativeOverlay && !nativeReady() && now - (next.nativeRetryAt || 0) > 60_000) {
    next.nativeRetryAt = now;
    startNative(next).catch(() => {});
  }

  // the writing punishment is owed until it is written: every distracting page you open (or reload) is locked again
  if (caps.punish && next.penance && status === 'distraction' && !outside && tab?.id != null) await enforcePenance(tab, next, settings);
  await setSession(next);
  badge(next);
  const due = caps.punish ? nextDueIn(next, Date.now(), stepWith) : 0;
  if (due > 0 && due < 25_000) setTimeout(schedule, due + 300); // sooner than the next 30 s alarm
}

/**
 * Burns the tab: the distracting page is replaced by the condemned page (in the same tab, so Back restores it; nothing
 * is closed). The host is remembered for the session: going back there burns again after 15 s.
 */
async function condemn(tab, session, settings) {
  if (!modeCaps(session).punish) return;
  const host = hostOf(tab.url || '');
  if (!host || matchesList(tab.url, settings.allowlist)) return;
  const url = chrome.runtime.getURL(`src/condemned.html?host=${encodeURIComponent(host)}`);
  await chrome.tabs.update(tab.id, { url }).catch(() => {});
  session.condemned = [...new Set([...(session.condemned || []), host])].slice(-30);
  session.burned = (session.burned || 0) + 1;
}

/** The penance is lifted (written, session over, discipline lowered): the lockout comes off every tab that has one. */
async function liftPenance(session) {
  if (!session) return;
  const ids = session.lockoutTabs || [];
  session.penance = null;
  session.lockoutTabs = [];
  await Promise.all(ids.map((id) => chrome.scripting.executeScript({ target: { tabId: id }, func: removeOverlay }).catch(() => {})));
}

/** Puts the penance lockout on `tab` (kept as it is if already there). No access to the page: burn it and return now. */
async function enforcePenance(tab, session, settings) {
  const lvl = settings.discipline === 'standard' || settings.discipline === 'harsh';
  if (!lvl || !settings.effects) { await liftPenance(session); return; }
  const ok = /^https?:/i.test(tab.url || '') && await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: showOverlay,
    args: [{
      name: 'Commissar', caption: TRIGGERS.lockout.caption, tone: 'warn', effects: ['grayscale', 'lockout'],
      penanceTimes: session.penance.times, penance: settings.penance, fonts: pageFonts(),
    }],
  }).then(() => true, () => false);
  if (ok) {
    session.lockoutTabs = [...new Set([...(session.lockoutTabs || []), tab.id])].slice(-20);
    return;
  }
  // a page scripts cannot run on (or no site access): no lockout possible, so the tab burns at once instead
  await liftPenance(session);
  if (settings.condemnTabs) await condemn(tab, session, settings);
  await returnToStudy(session, settings);
}

/** The penance was written in the frame on `tab`: lift the lockout, burn the tab and send you back to your post. */
async function penanceDone(tab) {
  const session = await getSession();
  if (!session?.active || !session.penance) { // nothing owed any more (session ended): just take the leftover frame off
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: removeOverlay }).catch(() => {});
    return false;
  }
  if (!(session.lockoutTabs || []).includes(tab.id)) return false;
  const settings = await getSettings();
  await liftPenance(session); // every locked tab, not just this one
  const live = await chrome.tabs.get(tab.id).catch(() => null);
  const known = await allVerdicts(settings);
  if (live && settings.condemnTabs && classify(live.url || '', live.title || '', settings, session.subject, known.verdicts, known.learned) !== 'study') {
    await condemn(live, session, settings);
  }
  await returnToStudy(session, settings);
  await setSession(session);
  return true;
}

/** A tab that counts as study: the one you last studied on, else the most recently used open one. */
async function findStudyTab(session, settings) {
  const known = await allVerdicts(settings);
  const { pageSense = {} } = await chrome.storage.local.get('pageSense');
  const isStudy = (t) => {
    let v = classify(t.url || '', t.title || '', settings, session.subject, known.verdicts, known.learned);
    if (v === 'unknown') { const e = pageSense[senseKey(t.url || '')]; if (e && Date.now() - e.at < DAY) v = e.v; } // as evaluate()
    return v === 'study';
  };
  if (session.studyTab) {
    const t = await chrome.tabs.get(session.studyTab.tabId).catch(() => null);
    if (!t) session.studyTab = null;
    else if (isStudy(t)) return t;
  }
  const all = (await chrome.tabs.query({}).catch(() => [])) || [];
  all.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return all.slice(0, 200).find(isStudy) || null;
}

/** Switches to a study tab (see findStudyTab) and brings its window forward. Never opens or closes tabs. */
async function returnToStudy(session, settings) {
  if (!modeCaps(session).punish) return false; // a tracker session never moves you
  const tab = await findStudyTab(session, settings);
  if (!tab) return false;
  session.studyTab = { tabId: tab.id, url: tab.url };
  await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  session.forcedReturnAt = Date.now();
  return true;
}

/** A system notification (optional permission; macOS Focus or notification settings may hide it). */
function notify(trigger, settings, session) {
  if (!chrome.notifications?.create || !modeCaps(session).punish) return;
  chrome.notifications.create(`commissar-${Date.now()}`, {
    type: 'basic', iconUrl: 'icons/icon128.png', title: 'Commissar Study Watch',
    message: TRIGGERS[trigger]?.caption || 'Return to your materials.', priority: 1,
  }).catch?.(() => {});
}

/** You are in another app: switch the browser to a study tab, flash it and pull it to the front (best effort). */
async function pullBack(session, settings) {
  if (!modeCaps(session).punish) return;
  const back = await returnToStudy(session, settings); // focuses the study tab's window
  await bringBrowserForward(session, { focus: !back });
  // macOS 14+ ignores a background browser asking to come forward; the Mac helper can do it
  if (nativeVersion() >= 2) toNative({ type: 'focus' });
}

/** Flashes the browser window, then tries to bring it to the front (best effort: the OS may refuse). */
async function bringBrowserForward(session, { focus = true } = {}) {
  const st = session.studyTab && (await chrome.tabs.get(session.studyTab.tabId).catch(() => null));
  const win = st ? { id: st.windowId } : await chrome.windows.getLastFocused().catch(() => null);
  if (!win?.id) return;
  await chrome.windows.update(win.id, { drawAttention: true }).catch(() => {});
  if (focus) await chrome.windows.update(win.id, { focused: true }).catch(() => {});
}

/** Your own check-in picture (custom/peek.*, else custom/scare-point.*, custom/scare.*) as a data: URL, or ''. */
async function customPeekImage() {
  for (const n of ['peek', 'scare-point', 'scare']) {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      const res = await fetch(chrome.runtime.getURL(`custom/${n}.${ext}`)).catch(() => null);
      if (!res?.ok) continue;
      const blob = await res.blob();
      if (blob.size > 3 * 1024 * 1024) continue; // too big to hand to a page
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return `data:${blob.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`};base64,${btoa(bin)}`;
    }
  }
  return '';
}

/** A random check-in on the current tab: voice line + the officer peeking in (voice only where pages can't be drawn on). */
async function checkIn(tab, settings, session) {
  const packs = await loadPacks();
  const clip = pickClip(packs, settings, 'watch', Math.random, session.lastFile);
  const caption = clip?.caption || TRIGGERS.watch.caption;
  if (clip) playClip({ path: `${clip.packId}/${clip.file}`, rough: settings.rough[clip.packId] || 0, volume: settings.volume }).catch(() => {});
  else if (settings.ttsFallback || !packs.length) speakText(caption, settings.volume);
  if (tab?.id != null && /^https?:/i.test(tab.url || '')) {
    const spot = peekSpot();
    const image = await customPeekImage();
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showPeek,
      args: [{ ...spot, caption, image, sprite: image ? null : { rows: BUST, colors: COLORS }, fonts: pageFonts() }],
    }).catch(() => {});
  }
  return { lastSpokenAt: Date.now(), lastFile: clip?.file || '' };
}

/**
 * A screamer: a small window of our own over whatever app you are in (the only way to reach you outside the browser),
 * with the officer pointing at you or firing. Replaces the previous one; it closes itself after 15 s.
 */
async function openScare(kind, trigger, previousId, settings, { inBrowser = false } = {}) {
  if (!(await liveCaps()).punish) return null;
  await removeOwnWindow(previousId, 'src/scare.html');
  const line = TRIGGERS[trigger]?.caption || '';
  // out of the browser: macOS keeps a background app's new windows behind the app you are in. The Mac helper shows
  // him over every app, fullscreen ones too; else his always-on-top watch window (picture-in-picture) when it is up
  if (!inBrowser && nativeReady() && toNative({ type: 'scare', html: scareHtml(kind, line, await fontCss()), width: 460, height: 560, ms: 12_000 })) {
    if (kind === 'shoot') setTimeout(() => playSfx('gunshot', settings.volume).catch(() => {}), 1300);
    return null;
  }
  if (!inBrowser) {
    const r = await chrome.runtime.sendMessage({ target: 'post', type: 'scare', kind, line }).catch(() => null);
    if (r?.shown) {
      if (kind === 'shoot') setTimeout(() => playSfx('gunshot', settings.volume).catch(() => {}), 1300);
      return null;
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`src/scare.html?kind=${kind}&line=${encodeURIComponent(line)}`),
    type: 'popup', width: 560, height: 640, focused: true,
  }).catch(() => null);
  if (kind === 'shoot') setTimeout(() => playSfx('gunshot', settings.volume).catch(() => {}), 1300);
  return win?.id ?? null;
}

/**
 * The Commissar's post: a small window of ours, opened when a session starts. One click there puts him in an
 * always-on-top picture-in-picture window, the only thing that stays visible over other apps; the post then
 * minimizes itself. Replaces a post left from an earlier session.
 */
async function openPost(session) {
  await closePost(session);
  if (!modeCaps(session).camera) return;
  const win = await chrome.windows.create({ url: chrome.runtime.getURL('src/post.html'), type: 'popup', width: 380, height: 420, focused: true }).catch(() => null);
  session.postWindowId = win?.id ?? null;
}

async function closePost(session) {
  await chrome.runtime.sendMessage({ target: 'post', type: 'end' }).catch(() => {});
  // found by its address, never by a stored window id (ids start over after a browser restart)
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('src/post.html') }).catch(() => []);
  for (const t of tabs || []) await chrome.tabs.remove(t.id).catch(() => {});
  if (session) session.postWindowId = null;
}

/** Closes window `id` only if it is still one of our own pages (`page`, e.g. 'src/scare.html'). */
async function removeOwnWindow(id, page) {
  if (id == null) return;
  const win = await chrome.windows.get(id, { populate: true }).catch(() => null);
  const ours = win?.tabs?.length && win.tabs.every((t) => String(t.url || t.pendingUrl || '').startsWith(chrome.runtime.getURL(page)));
  if (ours) await chrome.windows.remove(id).catch(() => {});
}

/** Takes every banner and lockout off the tabs that may have one (session end, discipline off). */
async function clearOverlays(session, { keepCurrent = false } = {}) {
  const ids = new Set([...(session?.lockoutTabs || [])]);
  const tab = await currentTab();
  if (tab?.id != null) { if (keepCurrent) ids.delete(tab.id); else ids.add(tab.id); }
  for (const id of ids) chrome.scripting.executeScript({ target: { tabId: id }, func: removeOverlay }).catch(() => {});
}


/** Connects the Mac helper (when it is allowed and installed). */
async function startNative(session) {
  // the helper shows nothing of its own between screamers (nothing of his stays on top of your apps)
  return connectNative();
}

/** "I need outside resources": +PASS_MINUTES each time, never more than PASS_MAX_MINUTES ahead; `end` ends it. */
async function grantPass({ end = false } = {}) {
  const session = await getSession();
  if (!session?.active || !modeCaps(session).punish) return { passUntil: 0 }; // a tracker session has nothing to excuse
  const now = Date.now();
  const settings = await getSettings();
  if (end) {
    session.passUntil = 0;
  } else {
    const from = Math.max(now, session.passUntil || 0);
    session.passUntil = Math.min(now + PASS_MAX_MINUTES * 60_000, from + PASS_MINUTES * 60_000);
    session.passes = (session.passes || 0) + 1;
    const said = await speak('passStart', { settings, tab: null, lastFile: session.lastFile, meta: `until ${new Date(session.passUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` });
    if (said) Object.assign(session, said);
  }
  await setSession(session);
  schedule();
  return { passUntil: session.passUntil };
}

// the helper reports a new app in front (look again now) or a click (from an older helper's panel)
onNative({
  app: () => schedule(),
  // (both are no-ops in a tracker session: grantPass and returnToStudy check the mode)
  click: (action) => {
    if (action === 'outsidePass') serial(() => grantPass()).catch(() => {});
    else serial(async () => { const s = await getSession(); if (s?.active && (await returnToStudy(s, await getSettings()))) { await setSession(s); toNative({ type: 'focus' }); } }).catch(() => {});
  },
});

let lastCam = { key: '', at: 0 };

/** What the camera saw (from the offscreen watcher): advance the camera rules and carry out what they trigger. */
async function onCamera(msg) {
  const now = Date.now();
  const source = msg.source === 'post' ? 'post' : 'offscreen';
  const look = ['screen', 'down', 'downRight', 'away', 'none'].includes(msg.look) ? msg.look : '';
  // what Settings shows: written when it changes, else every 10 s (not on every look)
  const cam = { at: now, source, phone: Boolean(msg.phone), person: Boolean(msg.person), look, error: msg.error ? String(msg.error).slice(0, 200) : '' };
  const camKey = `${source}|${cam.phone}|${cam.person}|${look}|${cam.error}`;
  if (camKey !== lastCam.key || now - lastCam.at >= 10_000) {
    lastCam = { key: camKey, at: now };
    await chrome.storage.local.set({ cameraState: cam });
  }
  const session = await getSession();
  const settings = await getSettings();
  if (!session?.active || !settings.camera || !modeCaps(session).camera) return;
  if (msg.error) {
    // the watch window failing does not stop the offscreen one, and the other way round
    if (msg.fatal && source === 'offscreen' && !session.camFatal) await setSession({ ...session, camFatal: true }); // no retrying every minute
    // the watch window's camera gave up: the background copy may take over again (the watchdog starts it)
    if (msg.fatal && source === 'post' && session.camSource === 'post') await setSession({ ...session, camSource: 'offscreen', camBeat: 0 });
    return;
  }
  const calm = (x) => JSON.stringify({ ...x, camBeat: 0, camPersonAt: 0 }); // fields that change on every look
  const before = calm(session);
  if (source === 'post' && session.camSource !== 'post') {
    session.camSource = 'post'; // the watch window has the camera now: the offscreen copy stands down
    session.camFatal = false;
    setCamera(false).catch(() => {});
  }
  // keyboard or mouse in the last 15 s: head down while typing is working, not a phone in your lap
  const input = (await chrome.idle.queryState(15).catch(() => 'active')) === 'active';
  const { session: next, triggers } = cameraStep(session, { phone: Boolean(msg.phone), person: Boolean(msg.person), look, input }, now, settings);
  const win = await chrome.windows.getLastFocused().catch(() => null);
  const outside = !win?.focused;
  const tab = outside ? null : await currentTab();
  let spoke = false;
  for (const trigger of triggers) {
    const fx = punishmentFor(trigger, next, settings);
    if (outside) fx.effects = [];
    if (fx.effects.length || fx.notify || fx.screamer) next.punishments = (next.punishments || 0) + 1;
    if (fx.notify && now - (next.lastNotifyAt || 0) >= 30_000) { notify(fx.say, settings, next); next.lastNotifyAt = now; }
    if (fx.screamer) next.scareWindowId = await openScare(fx.screamer, fx.say, next.scareWindowId, settings, { inBrowser: !outside });
    const said = await speak(fx.say, { settings, tab, lastFile: next.lastFile, meta: metaFor(trigger, next), fx, silent: spoke || !maySpeak(fx.say, next.lastSpokenAt, now) });
    if (said) { Object.assign(next, said); spoke = true; }
  }
  // a calm look changes nothing but the heartbeat: store it only now and then (the watchdog allows 45 s)
  if (triggers.length || calm(next) !== before || now - (session.camBeat || 0) >= 15_000) await setSession(next);
}

function metaFor(trigger, s) {
  if (trigger === 'phone' || trigger === 'phoneStill') return `phone seen by the camera · strike ${s.strikes}`;
  if (trigger === 'lookAwayLong' || trigger === 'lookDownLong') return `seen by the camera · strike ${s.strikes}`;
  if (trigger === 'distracted' || trigger === 'deserted' || trigger === 'lockout') return `${s.lastHost || 'this page'} · strike ${s.strikes}`;
  if (trigger === 'away' || trigger === 'awayPoint' || trigger === 'awayShoot') return `${s.lastApp ? `in ${s.lastApp} · ` : ''}${Math.round((s.awayMs || 0) / 60000)} min away from the browser this session`;
  if (trigger === 'focusBlock') return `${Math.round(s.focusMs / 60000)} focused minutes this session`;
  return '';
}

const schedule = () => serial(evaluate).catch((e) => console.warn('evaluate', e));

// ------------------------------------------------------------------ session control

async function startSession(subject, mode) {
  const settings = await getSettings();
  mode = ['overseer', 'tracker'].includes(mode) ? mode : settings.mode;
  const session = newSession(Date.now(), subject, mode);
  const caps = modeCaps(session);
  // the camera first: its offscreen document replaces the audio-only one, which would cut the opening line short
  if (caps.camera && settings.camera) await setCamera(true).catch(() => {});
  // (a tracker session says nothing: speak() needs the stored session to know that, and it is not stored yet)
  const said = caps.speak ? await speak('start', { settings, tab: await currentTab() }) : null;
  if (said) Object.assign(session, said);
  // his post window only hosts the camera now (its picture-in-picture keeps the camera running); without the camera
  // nothing of his stays on top of your apps: screamers come from the Mac helper, or meet you back in the browser
  if ((settings.discipline === 'standard' || settings.discipline === 'harsh') && caps.camera && settings.camera) await openPost(session);
  if (caps.camera && settings.camera) session.camStartAt = Date.now();
  if (settings.nativeOverlay) await startNative(session).catch(() => false);
  await setSession(session);
  await chrome.alarms.create(TICK, { periodInMinutes: 0.5 });
  badge(session);
  await evaluate();
  // pages opened before the session only watch lightly: tell them it has started (a tab without our script ignores it)
  const words = subjectWords(session.subject);
  for (const t of (await chrome.tabs.query({}).catch(() => [])) || []) {
    if (/^https?:/.test(t.url || '')) chrome.tabs.sendMessage?.(t.id, { type: 'sessionActive', subjectWords: words })?.catch?.(() => {});
  }
  return session;
}

async function stopSession() {
  const session = await getSession();
  if (!session?.active) return null;
  const settings = await getSettings();
  const { session: done } = step(session, 'locked', Date.now(), settings); // count up to now
  await mergeTrackDay(done.day || localDay(), done.dayApps).catch(() => {}); // today's part of the work/slack log
  done.dayApps = {};
  await setSession(done); // the flushed part is gone from the session before anything else can fail
  done.active = false;
  done.pendingReturn = null;
  await liftPenance(done); // before the end banner, which would not replace a lockout
  await closePost(done);
  await setCamera(false).catch(() => {}); // the camera light goes off
  disconnectNative(); // the helper hides his panel and quits
  await clearOverlays(done, { keepCurrent: true }); // the end banner replaces whatever is on the current tab
  const result = verdictOf(done);
  if (modeCaps(done).speak) {
    await speak(result, {
      settings, tab: await currentTab(), force: true, // the session is no longer live, but its mode decides
      meta: `${Math.round(done.focusMs / 60000)} min focused · ${Math.round(done.distractMs / 60000)} min distracted · ${done.strikes} strikes`,
    });
  }
  await setSession(done);
  await chrome.alarms.clear(TICK);
  await pushHistory({
    startedAt: done.startedAt, endedAt: Date.now(), subject: done.subject, focusMs: done.focusMs,
    distractMs: done.distractMs, strikes: done.strikes, answers: done.answers, punishments: done.punishments || 0,
    awayMs: done.awayMs || 0, result, mode: done.mode || 'overseer', apps: summarize(done.apps, 20).rows,
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
  const said = await speak(trigger, { settings, tab, lastFile: session?.lastFile || '', meta }); // (silent in a tracker session)
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
chrome.tabs.onActivated.addListener(({ tabId }) => { schedule(); scheduleLearn(tabId); });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (tab.active && (info.url || info.title || info.status === 'complete')) schedule();
  if (tab.active && info.status === 'complete') scheduleLearn(tabId);
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
        return { ok: true, active: Boolean(session?.active), quizRules: s.quizRules, autoDetect: s.autoDetect, readPages: s.readPages, subjectWords: session?.active ? subjectWords(session.subject) : [] };
      })().then(sendResponse, () => sendResponse({ ok: false }));
      return true;
    }
    return undefined;
  }
  const reply = (p) => p.then((v) => sendResponse({ ok: true, ...v }), (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  switch (msg.type) {
    case 'camera':
      // from the offscreen watcher: what the camera sees now (never a picture)
      serial(() => onCamera(msg)).catch((e) => console.warn('camera', e));
      return undefined;
    case 'outsidePass':
      reply(serial(() => grantPass({ end: Boolean(msg.end) })));
      return true;
    case 'learned':
      reply((async () => {
        const { geminiLearn } = await chrome.storage.local.get('geminiLearn');
        return { sites: await getLearned(), usage: geminiLearn || null };
      })());
      return true;
    case 'setLearned': {
      // from Settings: {host: {v, why} | null}; set by hand means never asked about again
      const patch = {};
      for (const [host, e] of Object.entries(msg.sites && typeof msg.sites === 'object' ? msg.sites : {}).slice(0, 5000)) {
        patch[String(host).toLowerCase()] = e == null ? null : { v: e.v, why: e.why, at: e.at, src: msg.keepSource ? e.src : 'hand' }; // a loaded file keeps who decided each site
      }
      reply((async () => {
        if (msg.replace) await chrome.storage.local.set({ learnedSites: {} });
        const sites = await putLearned(patch);
        schedule();
        return { sites };
      })());
      return true;
    }
    case 'penanceConfig':
    case 'penanceDone': {
      // only from the penance frame itself, inside a tab. Any site can load that frame (it is web-accessible), so its
      // text comes from here, never from its address: a site cannot dress it up with words of its own.
      if (!String(sender.url || '').startsWith(chrome.runtime.getURL('src/penance.html')) || !(sender.frameId > 0) || sender.tab?.id == null) return undefined;
      if (msg.type === 'penanceDone') { reply(serial(() => penanceDone(sender.tab)).then((done) => ({ done }))); return true; }
      reply(serial(async () => { // after the evaluate() that locked this tab has stored it
        const session = await getSession();
        const owed = Boolean(session?.active && session.penance && (session.lockoutTabs || []).includes(sender.tab.id));
        const settings = await getSettings();
        return { owed, line: settings.penance, times: owed ? session.penance.times : 0, why: TRIGGERS.lockout.caption };
      }));
      return true;
    }
    case 'status':
      reply((async () => {
        await serial(evaluate).catch(() => {});
        const tab = await currentTab();
        const settings = await getSettings();
        const known = await allVerdicts(settings);
        const session = await getSession();
        let page = classify(tab?.url || '', tab?.title || '', settings, session?.subject || '', known.verdicts, known.learned);
        if (page === 'unknown' && tab?.url && (await pageSenseFor(tab.url))) page = 'study';
        const packs = (await loadPacks()).map((p) => ({ id: p.id, name: p.name, events: Object.keys(p.events) }));
        const history = (await chrome.storage.local.get('history')).history || [];
        return {
          session, settings, packs, page, host: hostOf(tab?.url || ''), today: todayView(await getTrackDays(), session, Date.now()),
          last: history[0] || null, helper: nativeReady(),
        };
      })());
      return true;
    case 'start': reply(serial(() => startSession(String(msg.subject || ''), msg.mode)).then((session) => ({ session }))); return true;
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
        if (msg.trigger === 'watch') { await checkIn(await currentTab(), s, {}); return {}; }
        await speak(String(msg.trigger || 'start'), { settings: s, tab: await currentTab(), force: true });
        return {};
      })());
      return true;
    case 'testNative': // Settings → Mac helper → Test: connect and flash a short screamer over whatever app is in front
      reply((async () => {
        if (!(await connectNative())) return { ok: false };
        toNative({ type: 'scare', html: scareHtml('point', 'The Mac helper works. This goes away in 3 seconds.', await fontCss()), width: 460, height: 560, ms: 3000 });
        const live = await getSession();
        if (!live?.active) setTimeout(() => { getSession().then((s) => { if (!s?.active) disconnectNative(); }); }, 4000); // not kept running outside a session
        return { ok: true };
      })());
      return true;
    case 'settingsChanged':
      reply((async () => {
        packsPromise = null;
        await init();
        await syncContentScripts();
        const now = await getSettings();
        const live = await getSession();
        if (live?.active) { // the Mac helper turned on or off mid-session
          if (now.nativeOverlay) await startNative(live).catch(() => false); else disconnectNative();
        }
        if (live?.active && modeCaps(live).camera) { // the camera watch turned on or off mid-session (and a new try after a problem)
          // while his watch window has the camera, a settings save must not start a second one in the background
          if (!now.camera || live.camSource !== 'post') await setCamera(now.camera).catch(() => {});
          await serial(async () => {
            const s = await getSession();
            if (s?.active) await setSession({ ...s, camFatal: false, camStartAt: Date.now(), ...(now.camera ? {} : { camSource: 'offscreen' }) });
          });
        }
        const lvl = now.discipline;
        if (lvl === 'off' || lvl === 'lenient') {
          await serial(async () => {
            const s = await getSession();
            await clearOverlays(s);
            if (s?.penance || s?.lockoutTabs?.length) { await liftPenance(s); await setSession(s); }
          });
        }
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
    case 'chatStatus':
      reply((async () => ({ ...(await chatStatus(await getSettings())), subject: (await getSession())?.subject || '' }))());
      return true;
    case 'chat':
      reply((async () => {
        const settings = await getSettings();
        const history = Array.isArray(msg.history) ? msg.history.filter((m) => m && typeof m.text === 'string').slice(-12) : [];
        const text = await chatReply(settings, { subject: (await getSession())?.subject || '', history });
        if (settings.gemini.readAloud) speakText(text.slice(0, 400), settings.volume);
        return { text };
      })());
      return true;
    case 'quiz':
      reply((async () => ({ quiz: await makeQuiz(await getSettings(), {
        topic: String(msg.topic || ''), subject: (await getSession())?.subject || '',
        avoid: Array.isArray(msg.avoid) ? msg.avoid.map(String).slice(-8) : [],
      }) }))());
      return true;
    case 'quizAnswer':
      // a chat quiz answered: the persona reacts like to a homework answer, and a running session counts it
      reply(serial(async () => {
        const settings = await getSettings();
        const session = await getSession();
        const trigger = msg.correct ? 'quizPass' : 'quizFail';
        const said = await speak(trigger, { settings, tab: null, lastFile: session?.lastFile || '' });
        if (session?.active) {
          const next = { ...session, answers: { ...(session.answers || { pass: 0, fail: 0, partial: 0 }) } };
          next.answers[msg.correct ? 'pass' : 'fail'] += 1;
          if (said) Object.assign(next, said);
          await setSession(next);
        }
        return {};
      }));
      return true;
    case 'openChat':
      reply(chrome.windows.create({ url: chrome.runtime.getURL('src/chat.html'), type: 'popup', width: 460, height: 700 }).then(() => ({})));
      return true;
    case 'setMode': reply(serial(() => saveSettings({ mode: String(msg.mode || '') })).then(() => ({}))); return true;
    case 'setPersona': reply(serial(() => saveSettings({ persona: String(msg.persona || '') })).then(() => ({}))); return true;
    case 'silence': reply(stopAudio().then(() => ({}))); return true;
    default: return undefined;
  }
});

init();
