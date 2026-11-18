// Pure logic: no chrome.* calls, so it runs under node --test as well as in the extension.
// classify() decides what the current page is; step() is the session state machine that turns what you are doing
// into triggers; pickClip() turns a trigger into a voice clip from one of the persona packs.

export const SCHEMA_VERSION = 1;

export const DEFAULTS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  blocklist: [
    'reddit.com', 'x.com', 'twitter.com', 'tiktok.com', 'instagram.com', 'facebook.com', 'twitch.tv', 'netflix.com',
    'primevideo.com', 'disneyplus.com', 'hulu.com', '9gag.com', 'tumblr.com', 'pinterest.com', 'discord.com',
    'store.steampowered.com', 'steamcommunity.com', 'news.ycombinator.com', 'amazon.com', 'ebay.com',
    'aliexpress.com', 'vk.com', 'web.telegram.org', 'web.whatsapp.com', 'youtube.com/shorts',
  ],
  // sites where the page title decides: a lecture is study, anything else is distraction
  ambiguous: ['youtube.com', 'youtu.be', 'vimeo.com', 'medium.com'],
  allowlist: [
    'docs.google.com', 'scholar.google.com', 'classroom.google.com', 'wikipedia.org', 'khanacademy.org',
    'coursera.org', 'edx.org', 'quizlet.com', 'ankiweb.net', 'notion.so', 'overleaf.com', 'arxiv.org',
    'wolframalpha.com', 'desmos.com', 'brilliant.org', 'libretexts.org', 'stackoverflow.com',
    'developer.mozilla.org', 'instructure.com', 'moodle.org', 'blackboard.com', 'duolingo.com',
    'webassign.net', 'gradescope.com', 'mheducation.com', 'pearson.com', 'wileyplus.com', 'mastering.pearson.com',
  ],
  // words in a page's title or address that look like study material (the session subject's words count too)
  studyKeywords: [
    'lecture', 'lesson', 'course', 'tutorial', 'textbook', 'homework', 'assignment', 'exam', 'quiz', 'syllabus',
    'notes', 'study', 'chapter', 'exercise', 'problem set', 'worksheet', 'documentation', 'docs', 'reference',
    'theorem', 'proof', 'equation', 'grammar', 'vocabulary', 'university', 'college', '.edu', '.pdf',
  ],
  strictUnknown: false,        // pages on no list and without study words count as distraction
  punishOutsideBrowser: false, // the browser losing focus counts as distraction (you may be in a PDF reader or Anki)
  graceSeconds: 5,             // a distracting page must stay this long before it counts (tab cycling is free)
  desertSeconds: 60,           // still on a distracting page this long -> 'deserted'
  repeatSeconds: 120,          // and again this often while you stay
  focusMinutes: 25,            // a focused block this long -> 'focusBlock'
  idleMinutes: 5,              // no keyboard/mouse this long during a session -> 'idle'
  persona: 'commissar',        // a pack id, or 'squad': every line comes from a random squad pack
  squad: [],                   // pack ids in the squad (empty: all packs)
  rough: { commissar: 2 },     // pack id -> 0 (clean) .. 3 (gravel), the Web Audio chain from SciEdu
  volume: 0.9,
  overlay: true,               // on-screen banner (needs the optional "all sites" permission)
  ttsFallback: false,          // speak the caption with the browser voice when no pack has a clip for a trigger
  answersAlways: true,         // react to graded answers on homework pages even with no session running
  quizRules: [],               // site rules taught in options (src/answers.js has the shape and the built-in WebAssign one)
  autoDetect: false,           // with "all sites" allowed: look for right/wrong marks on every page with generic rules
  readPages: true,             // with "all sites" allowed: score each page's own text locally ("looks like study")
  gemini: { enabled: false, model: 'gemini-3.5-flash-lite', dailyCap: 40, sendSnippet: false, afterSeconds: 20 },
});

const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const strList = (v, d) => (Array.isArray(v) ? v.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean).slice(0, 500) : [...d]);

const RULE_KEYS = ['question', 'score', 'subs', 'correct', 'incorrect', 'partial'];
const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** Site rules from settings, shape-checked (selectors are checked against a real DOM in the options page). */
export function cleanRules(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list.slice(0, 30)) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.hosts)) continue;
    const hosts = r.hosts.map((h) => String(h || '').toLowerCase()).filter((h) => HOST_RE.test(h)).slice(0, 5);
    if (!hosts.length) continue;
    const rule = { id: `user-${hosts[0]}`, name: String(r.name || hosts[0]).slice(0, 60), hosts };
    for (const k of RULE_KEYS) if (typeof r[k] === 'string' && r[k].trim() && r[k].length <= 600) rule[k] = r[k].trim();
    if (rule.correct || rule.incorrect || rule.score) out.push(rule);
  }
  return out;
}

/** Stored settings merged over DEFAULTS, with every field type-checked and clamped. */
export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const g = r.gemini && typeof r.gemini === 'object' ? r.gemini : {};
  const d = DEFAULTS;
  const rough = {};
  const rr = r.rough && typeof r.rough === 'object' ? r.rough : d.rough;
  for (const [k, v] of Object.entries(rr)) if (ID_RE.test(k)) rough[k] = clampNum(v, 0, 3, 0) | 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    blocklist: strList(r.blocklist, d.blocklist),
    ambiguous: strList(r.ambiguous, d.ambiguous),
    allowlist: strList(r.allowlist, d.allowlist),
    studyKeywords: strList(r.studyKeywords, d.studyKeywords),
    strictUnknown: Boolean(r.strictUnknown ?? d.strictUnknown),
    punishOutsideBrowser: Boolean(r.punishOutsideBrowser ?? d.punishOutsideBrowser),
    graceSeconds: clampNum(r.graceSeconds, 0, 60, d.graceSeconds),
    desertSeconds: clampNum(r.desertSeconds, 15, 3600, d.desertSeconds),
    repeatSeconds: clampNum(r.repeatSeconds, 30, 3600, d.repeatSeconds),
    focusMinutes: clampNum(r.focusMinutes, 5, 180, d.focusMinutes),
    idleMinutes: clampNum(r.idleMinutes, 1, 60, d.idleMinutes),
    persona: typeof r.persona === 'string' && (r.persona === 'squad' || ID_RE.test(r.persona)) ? r.persona : d.persona,
    squad: Array.isArray(r.squad) ? r.squad.filter((x) => typeof x === 'string' && ID_RE.test(x)) : [],
    rough,
    volume: clampNum(r.volume, 0, 1, d.volume),
    overlay: Boolean(r.overlay ?? d.overlay),
    ttsFallback: Boolean(r.ttsFallback ?? d.ttsFallback),
    answersAlways: Boolean(r.answersAlways ?? d.answersAlways),
    quizRules: cleanRules(r.quizRules),
    autoDetect: Boolean(r.autoDetect ?? d.autoDetect),
    readPages: Boolean(r.readPages ?? d.readPages),
    gemini: {
      enabled: Boolean(g.enabled),
      model: typeof g.model === 'string' && /^[a-z0-9][a-z0-9.\-]{1,60}$/.test(g.model) ? g.model : d.gemini.model,
      dailyCap: clampNum(g.dailyCap, 0, 1000, d.gemini.dailyCap) | 0,
      sendSnippet: Boolean(g.sendSnippet),
      afterSeconds: clampNum(g.afterSeconds, 5, 600, d.gemini.afterSeconds),
    },
  };
}

// One row per trigger. fallbacks: pack events to try in order (a pack may record lines under the trigger's own name,
// see tools/lines/; older packs answer with the SciEdu event names they have). throttle: false = never held back.
export const TRIGGERS = Object.freeze({
  start: { fallbacks: ['start', 'quizStart', 'on'], throttle: false, caption: 'Session started. Eyes on your materials.' },
  stop: { fallbacks: ['stop', 'off'], throttle: false, caption: 'Session stopped.' },
  // ended early without a real block of work: desertion (the Helldiver pack calls it treason)
  abandon: { fallbacks: ['abandon', 'desert', 'quizLose', 'off'], throttle: false, caption: 'Leaving your post already? Noted.' },
  endGood: { fallbacks: ['endGood', 'quizWin', 'streak', 'off'], throttle: false, caption: 'Session complete. A clean record.' },
  endBad: { fallbacks: ['endBad', 'quizLose', 'quizFail', 'off'], throttle: false, caption: 'Session over. Too much of it went elsewhere.' },
  distracted: { fallbacks: ['distracted', 'tab'], throttle: false, overlay: true, caption: 'That is not your study material.' },
  deserted: { fallbacks: ['deserted', 'desert'], throttle: false, overlay: true, caption: 'Still here? Return to your work.' },
  back: { fallbacks: ['back', 'reward', 'quizPass'], throttle: true, caption: 'Back at your post. Good.' },
  focusBlock: { fallbacks: ['focusBlock', 'streak'], throttle: true, caption: 'A full block of focus. Take a short break.' },
  idle: { fallbacks: ['idle', 'streakRisk'], throttle: true, caption: 'Your hands have stopped. Has your mind?' },
  // read off a homework / quiz page by src/answers.js (no AI): an answer was graded
  quizPass: { fallbacks: ['quizPass', 'reward'], throttle: false, caption: 'Correct. Continue.' },
  quizFail: { fallbacks: ['quizFail', 'quizLose'], throttle: false, caption: 'Wrong. Find out why, then try again.' },
  quizPartial: { fallbacks: ['quizPartial', 'quizFail'], throttle: false, caption: 'Partly right. Partly is not enough.' },
  allDone: { fallbacks: ['allDone', 'quizWin', 'streak', 'reward'], throttle: false, caption: 'Every question answered correctly. Well fought.' },
});

export const THROTTLE_MS = 8000;
const PAUSE_GAP_MS = 90_000; // a gap longer than this (asleep, or the browser was closed) counts as nothing

// ---------------------------------------------------------------- pages

/** Lowercased host without a leading www., or '' for anything that is not http(s). */
export function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return ''; }
}

/** "host/first-path-segment": the key that verdicts (marked by hand or from Gemini) are cached under. */
export function pageKey(url) {
  const host = hostOf(url);
  if (!host) return '';
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg ? `${host}/${seg.toLowerCase()}` : host;
  } catch { return host; }
}

/** "host/full/path" without query or hash: Gemini's verdicts are kept per page, so one page cannot judge its siblings. */
export function pathKey(url) {
  const host = hostOf(url);
  if (!host) return '';
  try { return `${host}${new URL(url).pathname.replace(/\/+$/, '').toLowerCase()}`; } catch { return host; }
}

/** A list entry is a host ("reddit.com" also matches old.reddit.com) or host/path-prefix ("youtube.com/shorts"). */
export function matchesList(url, patterns) {
  const host = hostOf(url);
  if (!host || !Array.isArray(patterns)) return false;
  let path = '/';
  try { path = new URL(url).pathname.toLowerCase(); } catch { /* keep / */ }
  return patterns.some((raw) => {
    const p = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (!p) return false;
    const slash = p.indexOf('/');
    const ph = slash < 0 ? p : p.slice(0, slash);
    const pp = slash < 0 ? '' : p.slice(slash);
    return (host === ph || host.endsWith(`.${ph}`)) && (!pp || path.startsWith(pp));
  });
}

/** Words of 4+ letters from the session subject ("Organic chemistry exam" -> organic, chemistry). */
export function subjectWords(subject) {
  return String(subject || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).slice(0, 12);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` holds one of `words` (whole words for plain words, substrings for ".edu", ".pdf" and the like). */
export function hasStudyWords(text, words) {
  const hay = String(text || '').toLowerCase();
  return words.some((w) => {
    const k = String(w || '').trim().toLowerCase();
    if (!k) return false;
    if (/^[\p{L}\p{N} ]+$/u.test(k)) return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(k)}($|[^\\p{L}\\p{N}])`, 'u').test(hay);
    return hay.includes(k);
  });
}

/**
 * What a page is: 'study' | 'distraction' | 'neutral' | 'unknown'.
 * 'unknown' is an ordinary web page on no list and without study words: neutral, unless strictUnknown is on or a
 * verdict was cached for it. `verdicts` is {pageKey or host: 'study' | 'distraction'} (Gemini's, or read off the page).
 */
export function classify(url, title, settings, subject = '', verdicts = {}) {
  const s = normalizeSettings(settings);
  if (/^file:/i.test(url || '')) return /\.pdf($|[?#])/i.test(url) ? 'study' : 'neutral';
  const host = hostOf(url);
  if (!host) return 'neutral'; // new tab, browser settings, extension pages
  // your own lists first, then remembered verdicts (Gemini's, or the page's own text), then the title and address
  if (matchesList(url, s.allowlist)) return 'study';
  if (matchesList(url, s.blocklist)) return 'distraction';
  const v = verdicts?.[pathKey(url)] || verdicts?.[pageKey(url)] || verdicts?.[host];
  if (v === 'study' || v === 'distraction') return v;
  const words = [...s.studyKeywords, ...subjectWords(subject)];
  if (matchesList(url, s.ambiguous)) return hasStudyWords(title, words) ? 'study' : 'distraction';
  let path = '';
  try { const u = new URL(url); path = decodeURIComponent(`${u.hostname}${u.pathname}`); } catch { /* none */ }
  if (hasStudyWords(`${title || ''} ${path}`, words)) return 'study';
  return s.strictUnknown ? 'distraction' : 'unknown';
}

// ---------------------------------------------------------------- session

export function newSession(now, subject = '') {
  return {
    active: true, subject: String(subject || '').slice(0, 120), startedAt: now, lastAt: now,
    status: 'neutral', focusMs: 0, distractMs: 0, otherMs: 0, focusRunMs: 0,
    strikes: 0, distractedSince: 0, warned: false, lastDesertAt: 0, idleFired: false,
    lastHost: '', lastSpokenAt: 0, lastFile: '', answers: { pass: 0, fail: 0, partial: 0 },
    unknownKey: '', unknownSince: 0,
  };
}

/**
 * Advances the session to `now`; returns { session, triggers }.
 * `status` is what is happening now: 'study' | 'distraction' | 'neutral' | 'away' (outside the browser) |
 * 'idle' (no input for idleMinutes) | 'locked' (screen locked: nothing counts).
 * Time since the last step counts under the previous status; a gap over 90 s counts as nothing.
 * Escalation compares timestamps, so it does not matter how often step() runs.
 */
export function step(session, status, now, settings = {}, host = '') {
  if (!session?.active) return { session, triggers: [] };
  const s = normalizeSettings(settings);
  const next = { ...session };
  const triggers = [];
  const dt = now - (session.lastAt ?? now);
  if (dt > 0 && dt <= PAUSE_GAP_MS) {
    if (session.status === 'study') { next.focusMs += dt; next.focusRunMs += dt; }
    else if (session.status === 'distraction') next.distractMs += dt;
    else if (session.status !== 'locked') next.otherMs += dt;
  }
  next.lastAt = Math.max(now, session.lastAt || 0);
  const prev = session.status;
  next.status = status;
  if (host) next.lastHost = host;

  if (status === 'distraction') {
    if (prev !== 'distraction' || !next.distractedSince) {
      next.distractedSince = now;
      next.warned = false;
      next.lastDesertAt = 0;
    }
    const on = now - next.distractedSince;
    if (!next.warned && on >= s.graceSeconds * 1000) {
      next.warned = true;
      next.strikes += 1;
      next.focusRunMs = 0; // a distraction breaks the focused block
      triggers.push('distracted');
    } else if (next.warned && on >= s.desertSeconds * 1000
      && (!next.lastDesertAt || now - next.lastDesertAt >= s.repeatSeconds * 1000)) {
      next.lastDesertAt = now;
      triggers.push('deserted');
    }
  } else if (prev === 'distraction') {
    if (next.warned && status === 'study') triggers.push('back'); // only after a distraction that counted
    next.distractedSince = 0;
    next.warned = false;
  }
  if (status === 'study' && next.focusRunMs >= s.focusMinutes * 60_000) {
    next.focusRunMs = 0;
    triggers.push('focusBlock');
  }
  if (status === 'idle' && !next.idleFired) { next.idleFired = true; triggers.push('idle'); }
  if (status !== 'idle' && status !== 'locked') next.idleFired = false;
  return { session: next, triggers };
}

/** Milliseconds until step() could fire something new without another browser event (for a short wake-up timer). */
export function nextDueIn(session, now, settings = {}) {
  if (!session?.active || session.status !== 'distraction' || !session.distractedSince) return 0;
  const s = normalizeSettings(settings);
  const due = session.warned ? session.distractedSince + s.desertSeconds * 1000 : session.distractedSince + s.graceSeconds * 1000;
  return Math.max(0, due - now);
}

/**
 * How a finished session is judged: 'stop' (ended within 2 minutes: a false start), 'abandon' (under 5 focused
 * minutes), 'endGood' (distracted at most 15% of the judged time) or 'endBad'.
 */
export function verdictOf(session, now = Date.now()) {
  if (!session || now - session.startedAt < 2 * 60_000) return 'stop';
  if (session.focusMs < 5 * 60_000) return 'abandon';
  return session.distractMs <= 0.15 * (session.focusMs + session.distractMs) ? 'endGood' : 'endBad';
}

/** Whether a trigger may speak now, given when the last line played. */
export function maySpeak(trigger, lastSpokenAt, now) {
  return TRIGGERS[trigger]?.throttle === false || !lastSpokenAt || now - lastSpokenAt >= THROTTLE_MS;
}

// ---------------------------------------------------------------- packs

export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
export const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(mp3|ogg|wav|m4a|webm)$/;
const EVENT_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const MAX_CLIPS = 200;

/**
 * A pack manifest reduced to what the extension uses: {id, name, events, aliases, captions}.
 * Optional manifest key "aliases": {trigger: [event, ...]} lets a pack say which of its events answer a trigger,
 * ahead of the built-in fallbacks. `captions` is {file: text} from captions/<id>.json.
 */
export function sanitizePack(id, manifest, captions = {}) {
  if (!ID_RE.test(String(id || '')) || !manifest || typeof manifest !== 'object') return null;
  const src = manifest.events;
  if (!src || typeof src !== 'object') return null;
  const events = {};
  for (const [event, files] of Object.entries(src)) {
    if (!EVENT_RE.test(event) || !Array.isArray(files)) continue;
    const ok = files.slice(0, MAX_CLIPS).filter((f) => typeof f === 'string' && FILE_RE.test(f) && !f.includes('..'));
    if (ok.length) events[event] = ok;
  }
  if (!Object.keys(events).length) return null;
  const aliases = {};
  if (manifest.aliases && typeof manifest.aliases === 'object') {
    for (const [t, list] of Object.entries(manifest.aliases)) {
      if (TRIGGERS[t] && Array.isArray(list)) aliases[t] = list.filter((e) => typeof e === 'string' && events[e]);
    }
  }
  const caps = {};
  if (captions && typeof captions === 'object') {
    for (const [f, t] of Object.entries(captions)) if (FILE_RE.test(f) && typeof t === 'string') caps[f] = t.slice(0, 300);
  }
  return { id, name: String(manifest.name || id).slice(0, 60), events, aliases, captions: caps };
}

/** The packs a trigger may speak from: the chosen persona, or the squad (all packs when the squad list is empty). */
export function voicesFor(packs, settings) {
  const s = normalizeSettings(settings);
  if (s.persona !== 'squad') {
    const one = packs.find((p) => p.id === s.persona);
    return one ? [one] : packs.slice(0, 1);
  }
  const squad = s.squad.length ? packs.filter((p) => s.squad.includes(p.id)) : packs;
  return squad.length ? squad : packs;
}

/**
 * One clip for `trigger`: {packId, packName, event, file, caption} or null when no pack has a line for it.
 * `rng` returns [0, 1). In squad mode a random pack that has a line answers; `avoid` (the last file played) is skipped
 * when there is another choice, so the same line does not play twice in a row.
 */
export function pickClip(packs, settings, trigger, rng = Math.random, avoid = '') {
  const builtIn = TRIGGERS[trigger]?.fallbacks || [trigger];
  const options = [];
  for (const pack of voicesFor(packs, settings)) {
    const order = [...(pack.aliases?.[trigger] || []), ...builtIn];
    const event = order.find((e) => pack.events[e]?.length);
    if (event) options.push({ pack, event });
  }
  if (!options.length) return null;
  const { pack, event } = options[Math.floor(rng() * options.length) % options.length];
  let files = pack.events[event];
  if (files.length > 1 && avoid) files = files.filter((f) => f !== avoid);
  const file = files[Math.floor(rng() * files.length) % files.length];
  return { packId: pack.id, packName: pack.name, event, file, caption: pack.captions?.[file] || TRIGGERS[trigger]?.caption || '' };
}

/** Local calendar day, for the Gemini daily cap. */
export function localDay(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
