// Pure logic: no chrome.* calls, so it runs under node --test as well as in the extension.
// classify() decides what the current page is; step() is the session state machine that turns what you are doing
// into triggers; pickClip() turns a trigger into a voice clip from one of the persona packs.

export const SCHEMA_VERSION = 4;

export const DEFAULTS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  mode: 'overseer',            // overseer: voice, punishments, camera | tracker: only records work and slack by app
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
    'cengage.com',
  ],
  // words in a page's title or address that look like study material (the session subject's words count too)
  studyKeywords: [
    'lecture', 'lesson', 'course', 'tutorial', 'textbook', 'homework', 'assignment', 'exam', 'quiz', 'syllabus',
    'notes', 'study', 'chapter', 'exercise', 'problem set', 'worksheet', 'documentation', 'docs', 'reference',
    'theorem', 'proof', 'equation', 'grammar', 'vocabulary', 'university', 'college', '.edu', '.pdf',
  ],
  strictUnknown: false,        // pages on no list and without study words count as distraction at once
  driftMinutes: 5,             // ...or after this long on the same such page (0 = never)
  punishOutsideBrowser: false, // time out of the browser counts as distracted time (you may be in a PDF reader or Anki)
  graceSeconds: 5,             // a distracting page must stay this long before it counts (tab cycling is free)
  desertSeconds: 20,           // still on a distracting page this long -> 'deserted'
  repeatSeconds: 120,          // and again this often while you stay
  focusMinutes: 25,            // a focused block this long -> 'focusBlock'
  idleMinutes: 5,              // no keyboard/mouse this long during a session -> 'idle'
  persona: 'commissar',        // a pack id, or 'squad': every line comes from a random squad pack
  squad: [],                   // pack ids in the squad (empty: all packs)
  rough: { commissar: 2 },     // pack id -> 0 (clean) .. 3 (gravel), the Web Audio chain from SciEdu
  volume: 0.9,
  overlay: true,               // on-screen banner (needs the optional "all sites" permission)
  ttsFallback: false,          // speak the caption with the browser voice when no pack has a clip for a trigger
  discipline: 'standard',      // off | lenient | standard | harsh: how the persona punishes (PUNISHMENTS below)
  effects: true,               // on-screen effects (flash, shake, grey-out, lockout) on the distracting page
  countdownSeconds: 6,         // deserted: the officer burns the page for N s, then you are sent back to the study tab
  condemnTabs: true,           // ...and the burnt page is replaced by a 'condemned' page (Back restores it)
  lockoutDesertions: 2,        // from this desertion in a session on, it brings the writing punishment (harsh: from the 1st)
  penanceTimes: 3,             // the writing punishment: the penance line typed by hand this many times (no paste, no Esc)
  penance: 'I will not desert my studies.',
  awaySeconds: 10,             // the browser out of focus this long during a session -> 'away'; x2 -> pointing; x3 -> shot
  screamers: true,             // scare windows when you stay out of the browser (pointing, then the pistol)
  camera: false,               // the camera watch (on this computer only): a phone in your hands, an empty chair
  phoneSeconds: 3,             // a phone in view this long -> 'phone'; still there 30 s later -> 'phoneStill'
  absentSeconds: 90,           // nobody in front of the camera this long -> 'absent'
  gaze: true,                  // ...and which way you look: away from the screen, or down with your hands off the keys
  lookAwaySeconds: 8,          // looking away this long -> 'lookAway'; 3x as long -> 'lookAwayLong' (a strike)
  lookDownSeconds: 20,         // head down, no keyboard or mouse, this long -> 'lookDown' (a phone in your lap?); 3x -> strike
  copybook: false,             // copybook mode: looking down and to the right (a copybook beside the keyboard) is working
  // the Mac helper (native/, installed with tools/install-overlay.mjs): shows him over every app, fullscreen ones too,
  // and tells which app is in front, judged by these lists (a name or bundle id, any part of it, case ignored)
  nativeOverlay: false,
  appStudy: [
    'preview', 'acrobat', 'pdf expert', 'skim', 'pdf', 'anki', 'notion', 'obsidian', 'microsoft word', 'pages', 'numbers',
    'keynote', 'excel', 'powerpoint', 'onenote', 'goodnotes', 'notability', 'notes', 'calculator', 'grapher', 'mathematica',
    'matlab', 'geogebra', 'zotero', 'mendeley', 'xcode', 'visual studio code', 'com.microsoft.vscode', 'pycharm', 'intellij',
    'terminal', 'iterm', 'textedit', 'books', 'kindle', 'dictionary', 'quizlet', 'libreoffice',
  ],
  appDistraction: [
    'telegram', 'whatsapp', 'discord', 'messages', 'messenger', 'signal', 'slack', 'steam', 'epic games', 'battle.net',
    'minecraft', 'roblox', 'spotify', 'music', 'tv', 'netflix', 'youtube', 'tiktok', 'instagram', 'facebook', 'twitter',
    'photo booth', 'facetime', 'vk', 'viber', 'skype', 'zoom.us', 'twitch', 'vlc', 'iina', 'infuse', 'plex',
  ],
  appDistractSeconds: 3,       // a distraction app in front this long -> the out-of-browser punishments (else awaySeconds)
  answersAlways: true,         // react to graded answers on homework pages even with no session running
  quizRules: [],               // site rules taught in options (src/answers.js has the shape and the built-in WebAssign one)
  autoDetect: false,           // with "all sites" allowed: look for right/wrong marks on every page with generic rules
  readPages: true,             // with "all sites" allowed: score each page's own text locally ("looks like study")
  // learnSites: with a key, Gemini sorts every new site you open (study / distraction / neutral), once per site, up to
  // learnCap a day; the result is kept as your learned-sites file (Settings → Sites the AI learned)
  gemini: { enabled: false, model: 'gemini-3.5-flash-lite', dailyCap: 40, sendSnippet: false, afterSeconds: 20, chatCap: 60, readAloud: false, learnSites: true, learnCap: 100 },
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

// the defaults older schemas shipped with: a stored value equal to one of them was never chosen by hand
const OLD_DEFAULTS = Object.freeze({
  1: { desertSeconds: [30, 60], countdownSeconds: [8, 10], awaySeconds: [120] },
  2: { awaySeconds: [60] },
  3: { lookAwaySeconds: [20] },
});

/** Stored settings merged over DEFAULTS, with every field type-checked and clamped. */
export function normalizeSettings(raw) {
  let r = raw && typeof raw === 'object' ? raw : {};
  const from = Number(r.schemaVersion);
  if (OLD_DEFAULTS[from]) { // older schemas saved their slower defaults explicitly: move those to the new ones
    r = { ...r };
    for (const [k, old] of Object.entries(OLD_DEFAULTS[from])) if (old.includes(Number(r[k]))) delete r[k];
  }
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
    driftMinutes: clampNum(r.driftMinutes, 0, 120, d.driftMinutes),
    punishOutsideBrowser: Boolean(r.punishOutsideBrowser ?? d.punishOutsideBrowser),
    graceSeconds: clampNum(r.graceSeconds, 0, 60, d.graceSeconds),
    desertSeconds: clampNum(r.desertSeconds, 15, 3600, d.desertSeconds),
    repeatSeconds: clampNum(r.repeatSeconds, 30, 3600, d.repeatSeconds),
    focusMinutes: clampNum(r.focusMinutes, 5, 180, d.focusMinutes),
    idleMinutes: clampNum(r.idleMinutes, 1, 60, d.idleMinutes),
    mode: ['overseer', 'tracker'].includes(r.mode) ? r.mode : d.mode,
    persona: typeof r.persona === 'string' && (r.persona === 'squad' || ID_RE.test(r.persona)) ? r.persona : d.persona,
    squad: Array.isArray(r.squad) ? r.squad.filter((x) => typeof x === 'string' && ID_RE.test(x)) : [],
    rough,
    volume: clampNum(r.volume, 0, 1, d.volume),
    overlay: Boolean(r.overlay ?? d.overlay),
    ttsFallback: Boolean(r.ttsFallback ?? d.ttsFallback),
    discipline: ['off', 'lenient', 'standard', 'harsh'].includes(r.discipline) ? r.discipline : d.discipline,
    effects: Boolean(r.effects ?? d.effects),
    countdownSeconds: clampNum(r.countdownSeconds, 3, 25, d.countdownSeconds),
    condemnTabs: Boolean(r.condemnTabs ?? d.condemnTabs),
    lockoutDesertions: clampNum(r.lockoutDesertions, 1, 10, d.lockoutDesertions) | 0,
    penanceTimes: clampNum(r.penanceTimes, 1, 10, d.penanceTimes) | 0,
    penance: typeof r.penance === 'string' && r.penance.trim() ? r.penance.trim().slice(0, 80) : d.penance,
    awaySeconds: clampNum(r.awaySeconds, 1, 1800, d.awaySeconds), // 1: a distraction app passes appDistractSeconds through here
    screamers: Boolean(r.screamers ?? d.screamers),
    camera: Boolean(r.camera ?? d.camera),
    phoneSeconds: clampNum(r.phoneSeconds, 1, 60, d.phoneSeconds),
    absentSeconds: clampNum(r.absentSeconds, 20, 1800, d.absentSeconds),
    gaze: Boolean(r.gaze ?? d.gaze),
    lookAwaySeconds: clampNum(r.lookAwaySeconds, 5, 600, d.lookAwaySeconds),
    lookDownSeconds: clampNum(r.lookDownSeconds, 10, 900, d.lookDownSeconds),
    copybook: Boolean(r.copybook ?? d.copybook),
    nativeOverlay: Boolean(r.nativeOverlay ?? d.nativeOverlay),
    appStudy: strList(r.appStudy, d.appStudy),
    appDistraction: strList(r.appDistraction, d.appDistraction),
    appDistractSeconds: clampNum(r.appDistractSeconds, 1, 120, d.appDistractSeconds),
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
      chatCap: clampNum(g.chatCap, 0, 1000, d.gemini.chatCap) | 0,
      readAloud: Boolean(g.readAloud),
      learnSites: Boolean(g.learnSites ?? d.gemini.learnSites),
      learnCap: clampNum(g.learnCap, 0, 1000, d.gemini.learnCap) | 0,
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
  // the browser lost your attention (another app in front) / you came back to it
  away: { fallbacks: ['away', 'streakRisk', 'tab'], throttle: false, caption: 'Your browser lost your attention. Return to your materials.' },
  returned: { fallbacks: ['returned', 'back', 'reward'], throttle: true, caption: 'You are back. Continue.' },
  watch: { fallbacks: ['watch', 'on', 'streak'], throttle: true, caption: 'I am watching you.' },
  awayPoint: { fallbacks: ['awayPoint', 'away', 'streakRisk', 'tab'], throttle: false, caption: 'You. Yes, you. Back to your desk. Now.' },
  awayShoot: { fallbacks: ['awayShoot', 'desert', 'quizFail'], throttle: false, caption: 'That was a warning shot. Back to your post.' },
  // the camera watch: a phone in your hands, still on it, nobody at the desk
  phone: { fallbacks: ['phone', 'distracted', 'tab'], throttle: false, overlay: true, caption: 'Put the phone down. Now.' },
  phoneStill: { fallbacks: ['phoneStill', 'deserted', 'desert'], throttle: false, overlay: true, caption: 'Still on that phone. You were warned.' },
  absent: { fallbacks: ['absent', 'away', 'streakRisk'], throttle: false, caption: 'An empty chair. Where is my soldier?' },
  lookAway: { fallbacks: ['lookAway', 'distracted', 'tab'], throttle: false, overlay: true, caption: 'Eyes front. Your work is not over there.' },
  lookAwayLong: { fallbacks: ['lookAwayLong', 'deserted', 'desert'], throttle: false, overlay: true, caption: 'Still staring at nothing. That is a strike.' },
  lookDown: { fallbacks: ['lookDown', 'phone', 'distracted'], throttle: false, overlay: true, caption: 'Head down, hands off the keys. A phone in your lap? Put it away. Paper? Take an outside-resources pass.' },
  lookDownLong: { fallbacks: ['lookDownLong', 'phoneStill', 'deserted'], throttle: false, overlay: true, caption: 'Still head down with your hands off the keys. That is a strike.' },
  // "I need outside resources": other apps and unjudged sites are allowed for a while (distraction sites are not)
  passStart: { fallbacks: ['passStart', 'watch', 'on'], throttle: false, caption: 'Outside resources. The clock is running, and I am counting every minute.' },
  passEnd: { fallbacks: ['passEnd', 'away', 'tab'], throttle: false, caption: 'Time is up. Back to your post.' },
  // repeated desertion: the page is locked until the penance is written
  lockout: { fallbacks: ['lockout', 'desert', 'quizFail'], throttle: false, overlay: true, caption: 'Repeated desertion. Write your penance.' },
  // read off a homework / quiz page by src/answers.js (no AI): an answer was graded
  quizPass: { fallbacks: ['quizPass', 'reward'], throttle: false, caption: 'Correct. Continue.' },
  quizFail: { fallbacks: ['quizFail', 'quizLose'], throttle: false, caption: 'Wrong. Find out why, then try again.' },
  quizPartial: { fallbacks: ['quizPartial', 'quizFail'], throttle: false, caption: 'Partly right. Partly is not enough.' },
  allDone: { fallbacks: ['allDone', 'quizWin', 'streak', 'reward'], throttle: false, caption: 'Every question answered correctly. Well fought.' },
});

export const THROTTLE_MS = 8000;
export const CARRY_MS = 180_000; // off your post: the distraction clock survives hops (other tab, other app) this long
export const PASS_MINUTES = 10;  // "I need outside resources": one press buys this much
export const PASS_MAX_MINUTES = 30;
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
 * `learned` is {host: 'study' | 'distraction' | 'neutral'}: the sites Gemini sorted, used only when nothing else decides.
 */
/**
 * Homework platforms and the textbook publishers they open (WebAssign's eBook, videos, help and sign-in are on
 * cengage.com): always study, whatever Gemini said about one of their pages and even when a saved allowlist is
 * older than these. Only your block list overrides them.
 */
export const COURSEWARE = ['webassign.net', 'cengage.com', 'gradescope.com', 'mheducation.com', 'pearson.com', 'wileyplus.com'];

export function classify(url, title, settings, subject = '', verdicts = {}, learned = {}) {
  const s = normalizeSettings(settings);
  if (/^file:/i.test(url || '')) return /\.pdf($|[?#])/i.test(url) ? 'study' : 'neutral';
  const host = hostOf(url);
  if (!host) return 'neutral'; // new tab, browser settings, extension pages
  // your own lists first, then remembered verdicts (Gemini's, or the page's own text), then the title and address
  if (matchesList(url, s.allowlist)) return 'study';
  if (matchesList(url, s.blocklist)) return 'distraction';
  if (matchesList(url, COURSEWARE)) return 'study';
  const v = verdicts?.[pathKey(url)] || verdicts?.[pageKey(url)] || verdicts?.[host];
  if (v === 'study' || v === 'distraction') return v;
  const words = [...s.studyKeywords, ...subjectWords(subject)];
  if (matchesList(url, s.ambiguous)) return hasStudyWords(title, words) ? 'study' : 'distraction';
  let path = '';
  try { const u = new URL(url); path = decodeURIComponent(`${u.hostname}${u.pathname}`); } catch { /* none */ }
  if (hasStudyWords(`${title || ''} ${path}`, words)) return 'study';
  // last: what Gemini learned about the whole site (a learned neutral one never drifts or counts in strict mode)
  const l = learned?.[host];
  if (l === 'study' || l === 'distraction' || l === 'neutral') return l;
  return s.strictUnknown ? 'distraction' : 'unknown';
}

/**
 * What the app in front is (reported by the Mac helper): 'browser' | 'study' | 'distraction' | 'neutral'.
 * A list entry matches any part of the app's name or bundle id. Whole words for short entries ('tv', 'vk', 'notes'),
 * so 'tv' does not match 'Activity Monitor'. Your distraction list wins over the study list.
 */
export function classifyApp(app, settings = {}) {
  const s = normalizeSettings(settings);
  const name = String(app?.name || '').toLowerCase();
  const bundle = String(app?.bundle || '').toLowerCase();
  if (!name && !bundle) return 'neutral';
  if (/^(com\.google\.chrome|com\.brave\.browser|org\.chromium\.chromium|com\.microsoft\.edgemac|com\.vivaldi|com\.operasoftware|company\.thebrowser)/.test(bundle)) return 'browser';
  const hit = (list) => list.some((e) => {
    const k = String(e || '').trim().toLowerCase();
    if (!k) return false;
    if (k.includes('.') && bundle.includes(k)) return true;
    if (k.length <= 5) return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(k)}($|[^\\p{L}\\p{N}])`, 'u').test(name);
    return name.includes(k);
  });
  if (hit(s.appDistraction)) return 'distraction';
  if (hit(s.appStudy)) return 'study';
  return 'neutral';
}

// ---------------------------------------------------------------- session

export function newSession(now, subject = '', mode = 'overseer') {
  return {
    mode, apps: {}, dayApps: {}, day: localDay(now), trackKey: '', trackKind: '',
    active: true, subject: String(subject || '').slice(0, 120), startedAt: now, lastAt: now,
    status: 'neutral', focusMs: 0, distractMs: 0, otherMs: 0, focusRunMs: 0,
    strikes: 0, distractedSince: 0, warned: false, lastDesertAt: 0, idleFired: false,
    lastHost: '', lastSpokenAt: 0, lastFile: '', answers: { pass: 0, fail: 0, partial: 0 },
    unknownKey: '', unknownSince: 0,
    awayMs: 0, awaySince: 0, awayWarned: false, focusedOnce: false, desertions: 0, punishments: 0,
    pendingReturn: null, studyTab: null, forcedReturnAt: 0, lockoutTabs: [], nextCheckInAt: 0,
  };
}

/**
 * Advances the session to `now`; returns { session, triggers }.
 * `status` is what is happening now: 'study' | 'distraction' | 'neutral' | 'away' (outside the browser) |
 * 'excused' (outside the browser on an "outside resources" pass) | 'idle' (no input for idleMinutes) |
 * 'locked' (screen locked: nothing counts).
 * Time since the last step counts under the previous status; a gap over 90 s counts as nothing.
 * Escalation compares timestamps, so it does not matter how often step() runs.
 */
export function step(session, status, now, settings = {}, host = '', track = null) {
  if (!session?.active) return { session, triggers: [] };
  const s = normalizeSettings(settings);
  const next = { ...session };
  const triggers = [];
  const dt = now - (session.lastAt ?? now);
  if (dt > 0 && dt <= PAUSE_GAP_MS) {
    if (session.status === 'study') { next.focusMs += dt; next.focusRunMs += dt; }
    else if (session.status === 'distraction') next.distractMs += dt;
    else if (session.status === 'away') {
      next.awayMs = (next.awayMs || 0) + dt;
      if (s.punishOutsideBrowser) next.distractMs += dt;
    }
    else if (session.status !== 'locked') next.otherMs += dt;
    // the slice goes to what the previous look saw (the key), to the session's list and today's list alike
    if (session.trackKey && session.status !== 'locked') {
      next.apps = accrue(session.apps, session.trackKey, session.trackKind, dt);
      next.dayApps = accrue(session.dayApps, session.trackKey, session.trackKind, dt);
    }
  }
  next.trackKey = track?.key || '';
  next.trackKind = track?.key ? track.kind || 'n' : '';
  next.lastAt = Math.max(now, session.lastAt || 0);
  const prev = session.status;
  next.status = status;
  if (host) next.lastHost = host;

  if (status === 'distraction') {
    // hopping to another distracting tab, another app or a blank page and back does not reset the clock: only
    // going back to study does (or staying off distractions for CARRY_MS)
    const carried = next.distractedSince && now - (next.lastDistractAt || 0) <= CARRY_MS;
    if (!carried) {
      next.distractedSince = now;
      next.warned = false;
      next.lastDesertAt = 0;
    }
    next.lastDistractAt = now;
    const on = now - next.distractedSince;
    if (!next.warned && on >= s.graceSeconds * 1000) {
      next.warned = true;
      next.strikes += 1;
      next.focusRunMs = 0; // a distraction breaks the focused block
      triggers.push('distracted');
    } else if (next.warned && on >= s.desertSeconds * 1000
      && (!next.lastDesertAt || now - next.lastDesertAt >= s.repeatSeconds * 1000)) {
      next.lastDesertAt = now;
      next.desertions = (next.desertions || 0) + 1;
      triggers.push('deserted');
    }
  } else if (status === 'study' && next.distractedSince) {
    if (next.warned) triggers.push('back'); // only after a distraction that counted
    next.distractedSince = 0;
    next.warned = false;
  }
  if (status === 'study' && next.focusRunMs >= s.focusMinutes * 60_000) {
    next.focusRunMs = 0;
    triggers.push('focusBlock');
  }
  if (status === 'study') next.pendingReturn = null; // you went back on your own: no forced return (another tab or app does not cancel it)
  if (status === 'away') {
    if (!next.awaySince) next.awaySince = now;
    const gone = now - next.awaySince;
    // stage 1 'away', 2 'awayPoint', 3+ 'awayShoot' (he keeps firing every awaySeconds until you come back)
    // stages 1-3 come every awaySeconds; after that he fires again, but never more often than every 10 s
    const a = s.awaySeconds * 1000;
    const stage = gone < 3 * a ? Math.floor(gone / a) : 3 + Math.floor((gone - 3 * a) / Math.max(a, 10_000));
    if (stage > (next.awayStage || 0)) {
      next.awayStage = stage;
      next.awayWarned = true;
      triggers.push(['', 'away', 'awayPoint'][stage] || 'awayShoot');
    }
  } else if (status === 'study' || status === 'neutral' || status === 'excused') {
    // back in the browser on your work (a distracting tab keeps the away clock running)
    if (next.awayWarned) { next.cameBackFrom = next.awayStage || 0; triggers.push('returned'); }
    next.awaySince = 0;
    next.awayWarned = false;
    next.awayStage = 0;
    next.focusedOnce = false;
  }
  if (status === 'idle' && !next.idleFired) { next.idleFired = true; triggers.push('idle'); }
  if (status !== 'idle' && status !== 'locked') next.idleFired = false;
  return { session: next, triggers };
}

/**
 * The camera watch: what the camera sees now ({phone, person}, already smoothed over a few frames by the watcher)
 * advances the session; returns {session, triggers}. A phone in view for phoneSeconds is a strike ('phone'); still
 * there 30 s later is a desertion ('phoneStill'). Nobody in view for absentSeconds is 'absent' (once per absence).
 */
export function cameraStep(session, obs, now, settings = {}) {
  if (!session?.active) return { session, triggers: [] };
  const s = normalizeSettings(settings);
  const next = { ...session, camBeat: now };
  const triggers = [];
  if (obs?.phone) {
    next.camPhoneLastAt = now;
    if (!next.camPhoneSince) { next.camPhoneSince = now; next.camPhoneWarned = false; next.camPhoneShot = false; next.camPhoneShotAt = 0; }
    const on = now - next.camPhoneSince;
    if (!next.camPhoneWarned && on >= s.phoneSeconds * 1000) {
      next.camPhoneWarned = true;
      next.strikes = (next.strikes || 0) + 1;
      next.phones = (next.phones || 0) + 1;
      triggers.push('phone');
    } else if (next.camPhoneWarned && now - (next.camPhoneShotAt || next.camPhoneSince + s.phoneSeconds * 1000) >= 30_000) {
      // still on it: he fires every 30 s for as long as the phone stays in view, a strike and a desertion each time
      next.camPhoneShot = true;
      next.camPhoneShotAt = now;
      next.strikes = (next.strikes || 0) + 1;
      next.desertions = (next.desertions || 0) + 1;
      triggers.push('phoneStill');
    }
  } else if (next.camPhoneSince && now - (next.camPhoneLastAt || 0) > 4000) {
    // gone for a few seconds (a moment out of view is the same phone, not a new one)
    next.camPhoneSince = 0;
    next.camPhoneWarned = false;
    next.camPhoneShot = false;
    next.camPhoneShotAt = 0;
  }
  // which way you look (when the face model is there and the watch is on): not during an outside-resources pass
  // (not while a phone is in view: the phone rules already punish that, once)
  // down and to the right: working in copybook mode, else plain head down
  const seen = obs?.look === 'downRight' ? (s.copybook ? 'screen' : 'down') : obs?.look;
  const look = s.gaze && seen && !(session.passUntil > now) && !next.camPhoneSince ? seen : '';
  next.camLook = obs?.look || '';
  const awayNow = look === 'away' || (look === 'none' && obs?.person); // a person whose face cannot be seen: turned away
  const downNow = look === 'down' && !obs?.input; // head down with the keyboard and mouse untouched
  for (const [kind, on, after, first, second] of [
    ['Away', awayNow, s.lookAwaySeconds, 'lookAway', 'lookAwayLong'],
    ['Down', downNow, s.lookDownSeconds, 'lookDown', 'lookDownLong'],
  ]) {
    const since = `camLook${kind}Since`, okAt = `camLook${kind}OkAt`, stage = `camLook${kind}Stage`;
    if (on) {
      // a fresh start after 3 s back on your work (the camera reports rarely while nothing needs timing)
      if (!next[since] || (next[okAt] && now - next[okAt] >= 3000)) { next[since] = now; next[stage] = 0; }
      next[okAt] = 0;
      const t = now - next[since];
      if ((next[stage] || 0) < 1 && t >= after * 1000) { next[stage] = 1; triggers.push(first); }
      else if (next[stage] === 1 && t >= after * 3000) {
        next[stage] = 2;
        next.strikes = (next.strikes || 0) + 1;
        triggers.push(second);
      }
    } else if (next[since]) {
      if (!next[okAt]) next[okAt] = now;
      if (now - next[okAt] >= 3000) { next[since] = 0; next[stage] = 0; next[okAt] = 0; } // back for 3 s: a fresh start
    }
  }
  if (obs?.person) {
    next.camPersonAt = now;
    next.camAbsentSince = 0;
    next.camAbsentWarned = false;
  } else {
    if (!next.camAbsentSince) next.camAbsentSince = now;
    if (!next.camAbsentWarned && now - next.camAbsentSince >= s.absentSeconds * 1000) {
      next.camAbsentWarned = true;
      triggers.push('absent');
    }
  }
  return { session: next, triggers };
}

/** Whether the camera says you are at the desk and off your phone (reading, writing on paper): not idle. */
export function cameraBusy(session, now, settings = {}) {
  const s = normalizeSettings(settings);
  return Boolean(s.camera && session?.camPersonAt && now - session.camPersonAt < 30_000 && !session.camPhoneSince
    && session.camLook !== 'away' && session.camLook !== 'none' && now - (session.camBeat || 0) < 45_000);
}

/** Milliseconds until something is due without another browser event (for a short wake-up timer); 0 = nothing. */
export function nextDueIn(session, now, settings = {}) {
  if (!session?.active) return 0;
  const s = normalizeSettings(settings);
  const due = [];
  if (session.status === 'distraction' && session.distractedSince) {
    if (!session.warned) due.push(session.distractedSince + s.graceSeconds * 1000);
    else if (!session.lastDesertAt) due.push(session.distractedSince + s.desertSeconds * 1000);
    else due.push(session.lastDesertAt + s.repeatSeconds * 1000);
  }
  if (session.pendingReturn?.at) due.push(session.pendingReturn.at);
  if (session.passUntil > now) due.push(session.passUntil);
  if (session.status === 'away' && session.awaySince) {
    const a = s.awaySeconds * 1000, k = (session.awayStage || 0) + 1;
    due.push(session.awaySince + (k <= 3 ? a * k : 3 * a + (k - 3) * Math.max(a, 10_000)));
  }
  if (!due.length) return 0;
  return Math.max(1, Math.min(...due) - now);
}

/**
 * Status for a page nothing could judge ('unknown'): neutral at first, a distraction once you have stayed on the
 * same page (`session.unknownKey`, since `session.unknownSince`) for driftMinutes.
 */
export function driftStatus(session, now, settings = {}) {
  const s = normalizeSettings(settings);
  if (!s.driftMinutes || !session?.unknownSince) return 'neutral';
  return now - session.unknownSince >= s.driftMinutes * 60_000 ? 'distraction' : 'neutral';
}

/**
 * How a finished session is judged: 'stop' (ended within 2 minutes: a false start), 'abandon' (under 5 focused
 * minutes), 'endGood' (distracted at most 15% of the judged time) or 'endBad'.
 */
export function verdictOf(session, now = Date.now()) {
  if (session?.mode === 'tracker') return 'tracked';
  if (!session || now - session.startedAt < 2 * 60_000) return 'stop';
  if (session.focusMs < 5 * 60_000) return 'abandon';
  return session.distractMs <= 0.15 * (session.focusMs + session.distractMs) ? 'endGood' : 'endBad';
}

// ---------------------------------------------------------------- punishments

export const LEVELS = Object.freeze({ off: 0, lenient: 1, standard: 2, harsh: 3 });

/**
 * What the persona does about a trigger, as plain data the service worker carries out:
 * {say, effects: [...], returnInS, penanceTimes, notify, focusWindow, screamer, condemn}. `say` may differ from the
 * trigger (a desertion that earns the writing punishment says the 'lockout' line). Nothing here closes or opens a tab:
 * the browser control is burning the distracting tab (it becomes the condemned page; Back restores it), switching back
 * to a study tab and bringing the browser window forward.
 */
export function punishmentFor(trigger, session, settings = {}) {
  const s = normalizeSettings(settings);
  const lvl = LEVELS[s.discipline] ?? 2;
  const out = { say: trigger, effects: [], returnInS: 0, penanceTimes: 0, notify: false, focusWindow: false, screamer: '', condemn: false };
  if (!lvl) return out;
  const fx = (...names) => { if (s.effects) out.effects.push(...names); };
  if (trigger === 'distracted') fx('flash');
  if (trigger === 'deserted') {
    if (lvl === 1) { fx('flash', 'grayscale'); return out; }
    // every desertion: the officer marches in and torches the page while the countdown runs, then the tab burns
    // (becomes the condemned page) and you are sent back to your post
    fx('grayscale', 'burn', 'shake', 'countdown');
    out.returnInS = s.countdownSeconds;
    out.condemn = s.condemnTabs;
    const from = lvl >= 3 ? 1 : s.lockoutDesertions;
    if (s.effects && (session?.desertions || 0) >= from) {
      // the writing punishment on top: the burning page is locked until the penance is written N times
      out.say = 'lockout';
      out.effects = ['grayscale', 'burn', 'lockout'];
      out.penanceTimes = lvl >= 3 ? Math.max(s.penanceTimes, 5) : s.penanceTimes;
      out.returnInS = 0; // no timed return: writing it is what sends you back
    }
  }
  if (trigger === 'away' || trigger === 'awayPoint' || trigger === 'awayShoot') {
    out.notify = true;
    out.focusWindow = lvl >= 2; // switch to the study tab and pull the browser to the front, every stage
    if (trigger !== 'away' && lvl >= 2 && s.screamers) out.screamer = trigger === 'awayShoot' ? 'shoot' : 'point'; // a window over your other app
  }
  if (trigger === 'passEnd') out.notify = true; // you are probably in another app
  // the camera saw a phone: a strike and the flash; still on it 30 s later: he fires, and it counts as a desertion
  if (trigger === 'phone') {
    out.notify = true;
    fx('flash', 'shake');
    if (lvl >= 2 && s.screamers) out.screamer = 'point';
  }
  if (trigger === 'phoneStill') {
    out.notify = true;
    fx('flash', 'shake', 'grayscale');
    if (lvl >= 2 && s.screamers) out.screamer = 'shoot';
  }
  if (trigger === 'absent') out.notify = true;
  // where you look: a warning first, then a strike with the flash and his pointing finger
  if (trigger === 'lookAway' || trigger === 'lookDown') fx('flash');
  if (trigger === 'lookAwayLong' || trigger === 'lookDownLong') {
    out.notify = true;
    fx('flash', 'shake');
    if (lvl >= 2 && s.screamers) out.screamer = 'point';
  }
  // back in the browser after he pointed at you (or fired): the screamer meets you there, where it cannot be missed
  if (trigger === 'returned' && lvl >= 2 && s.screamers && (session?.cameBackFrom || 0) >= 2) {
    out.screamer = session.cameBackFrom >= 3 ? 'shoot' : 'point';
    out.say = session.cameBackFrom >= 3 ? 'awayShoot' : 'awayPoint';
  }
  return out;
}

export const CHECK_IN_MIN = 1; // minutes: he peeks in at random, between 1 and 5 minutes apart (not a setting)
export const CHECK_IN_MAX = 5;

/** When the next random check-in is due: 1 to 5 minutes from `now`. */
export function nextCheckIn(now, rng = Math.random) {
  return now + (CHECK_IN_MIN + rng() * (CHECK_IN_MAX - CHECK_IN_MIN)) * 60_000;
}

/** Where he peeks in from: {side: 'bottom' | 'left' | 'right', at: 0.12..0.88 along that edge}. */
export function peekSpot(rng = Math.random) {
  return { side: ['bottom', 'left', 'right'][Math.floor(rng() * 3) % 3], at: 0.12 + rng() * 0.76 };
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
  const aliasFiles = {};
  const allFiles = new Set(Object.values(events).flat());
  if (manifest.aliases && typeof manifest.aliases === 'object') {
    for (const [t, list] of Object.entries(manifest.aliases)) {
      if (!TRIGGERS[t] || !Array.isArray(list)) continue;
      // an entry is an event name, or one clip file from any event (pick just the lines that fit a moment)
      aliases[t] = list.filter((e) => typeof e === 'string' && events[e]);
      aliasFiles[t] = list.filter((e) => typeof e === 'string' && allFiles.has(e));
    }
  }
  const caps = {};
  if (captions && typeof captions === 'object') {
    for (const [f, t] of Object.entries(captions)) if (FILE_RE.test(f) && typeof t === 'string') caps[f] = t.slice(0, 300);
  }
  return { id, name: String(manifest.name || id).slice(0, 60), events, aliases, aliasFiles, captions: caps };
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
    // the pack's own lines for this trigger win; then the clips it picked for it; then the built-in fallbacks
    if (pack.events[trigger]?.length) { options.push({ pack, event: trigger }); continue; }
    if (pack.aliasFiles?.[trigger]?.length) { options.push({ pack, event: trigger, files: pack.aliasFiles[trigger] }); continue; }
    const order = [...(pack.aliases?.[trigger] || []), ...builtIn];
    const event = order.find((e) => pack.events[e]?.length);
    if (event) options.push({ pack, event });
  }
  if (!options.length) return null;
  const { pack, event, files: picked } = options[Math.floor(rng() * options.length) % options.length];
  let files = picked || pack.events[event];
  if (files.length > 1 && avoid) files = files.filter((f) => f !== avoid);
  const file = files[Math.floor(rng() * files.length) % files.length];
  return { packId: pack.id, packName: pack.name, event, file, caption: pack.captions?.[file] || TRIGGERS[trigger]?.caption || '' };
}

/** Local calendar day, for the Gemini daily cap. */
export function localDay(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- modes and the work/slack log

// overseer: he speaks, punishes, watches by camera, peeks in | tracker: nothing is forced, time is only recorded
export const MODES = Object.freeze({
  overseer: Object.freeze({ speak: true, punish: true, camera: true, checkIn: true }),
  tracker: Object.freeze({ speak: false, punish: false, camera: false, checkIn: false }),
});
/** What a session may do; a session saved before modes existed has none and is an overseer one. */
export const modeCaps = (session) => MODES[session?.mode === 'tracker' ? 'tracker' : 'overseer'];

export const TRACK_MAX_KEYS = 150; // distinct sites and apps kept per session and per day; the rest is '(other)'
export const TRACK_DAYS = 14;

/** What the time is booked under: a site's host, or an app's name; '' when nothing counts (idle, locked). */
export function trackKey({ idle = false, outside = false, app = null, url = '', incognito = false } = {}) {
  if (idle) return '';
  if (outside) return String(app?.name || '').trim().slice(0, 60) || 'Other apps';
  if (incognito) return '(private window)';
  if (/^file:/i.test(url)) return 'Local files';
  return hostOf(url) || '(browser pages)';
}

/** 'w' work, 's' slack, 'n' neither (unjudged pages, other apps), from the session status and the front app's kind. */
export function trackKind(status, appKind = '') {
  if (status === 'study') return 'w';
  if (status === 'distraction' || (status === 'away' && appKind === 'distraction')) return 's';
  return 'n';
}

/** apps + dt ms under `key` as a new map {key: {w, s, n}}; past TRACK_MAX_KEYS new keys go to '(other)'. */
export function accrue(apps, key, kind, dt) {
  const out = { ...(apps || {}) };
  const k = key in out || Object.keys(out).length < TRACK_MAX_KEYS ? key : '(other)';
  const cur = out[k] || { w: 0, s: 0, n: 0 };
  const f = kind === 'w' || kind === 's' ? kind : 'n';
  out[k] = { ...cur, [f]: cur[f] + Math.round(dt) };
  return out;
}

/** When the local day has changed: {session with a fresh day list, flush: the old day's {day, apps} or null}. */
export function rollDay(session, now) {
  const today = localDay(now);
  if (!session || session.day === today) return { session, flush: null };
  if (!session.day) return { session: { ...session, day: today, dayApps: {} }, flush: null };
  const has = Object.keys(session.dayApps || {}).length > 0;
  return { session: { ...session, day: today, dayApps: {} }, flush: has ? { day: session.day, apps: session.dayApps } : null };
}

/** Adds `apps` to days[day] ({apps, w, s, n}), keeps the newest `keep` days. Returns a new map. */
export function mergeDay(days, day, apps, keep = TRACK_DAYS) {
  const out = { ...(days || {}) };
  let merged = { ...(out[day]?.apps || {}) };
  for (const [k, v] of Object.entries(apps || {})) {
    for (const f of ['w', 's', 'n']) if (v?.[f] > 0) merged = accrue(merged, k, f, v[f]);
  }
  const t = { w: 0, s: 0, n: 0 };
  for (const v of Object.values(merged)) for (const f of ['w', 's', 'n']) t[f] += v[f];
  out[day] = { apps: merged, ...t };
  for (const d of Object.keys(out).sort().reverse().slice(keep)) delete out[d];
  return out;
}

/** The biggest `limit` rows by total time, and the totals over every key. */
export function summarize(apps, limit = Infinity) {
  const rows = Object.entries(apps || {}).map(([key, v]) => ({ key, w: v.w || 0, s: v.s || 0, n: v.n || 0, total: (v.w || 0) + (v.s || 0) + (v.n || 0) }));
  rows.sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : 1));
  const t = { w: 0, s: 0, n: 0 };
  for (const r of rows) { t.w += r.w; t.s += r.s; t.n += r.n; }
  return { rows: rows.slice(0, limit), ...t };
}

/** Today's time by app: what was saved for today plus the running session's part not yet saved. */
export function todayView(trackDays, session, now, limit = 8) {
  const today = localDay(now);
  const saved = trackDays?.[today]?.apps || {};
  const live = session?.day === today ? session.dayApps : {};
  return summarize(mergeDay({ [today]: { apps: saved } }, today, live, 1)[today].apps, limit);
}
