// Everything the service worker keeps lives in chrome.storage.local (the worker can be stopped at any moment, and
// storage.session is wiped when the browser restarts). serial() runs read-modify-write steps one at a time, so two
// browser events arriving together cannot overwrite each other's changes.
import { normalizeSettings } from './core.js';

let chain = Promise.resolve();
/** Runs `fn` after every earlier serial() call has finished; resolves to its result. */
export function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings);
}

/** Merges `patch` into the stored settings (normalized) and returns the result. */
export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = normalizeSettings({ ...cur, ...patch, gemini: { ...cur.gemini, ...(patch?.gemini || {}) } });
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getSession() {
  const { session } = await chrome.storage.local.get('session');
  return session && typeof session === 'object' ? session : null;
}

export const setSession = (session) => chrome.storage.local.set({ session });

// verdicts: {pageKey or host: {v: 'study' | 'distraction' | 'unknown', at, until?, src: 'gemini'}}
const VERDICT_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_VERDICTS = 2000;

export async function getVerdicts() {
  const { verdicts } = await chrome.storage.local.get('verdicts');
  return verdicts && typeof verdicts === 'object' ? verdicts : {};
}

/** The verdicts classify() uses right now: {key: 'study' | 'distraction'} (expired and 'unknown' ones dropped). */
export function liveVerdicts(all, now = Date.now()) {
  const out = {};
  for (const [k, e] of Object.entries(all || {})) {
    if (e && (e.v === 'study' || e.v === 'distraction') && (!e.at || now - e.at < VERDICT_TTL_MS)) out[k] = e.v;
  }
  return out;
}

export async function putVerdict(key, entry) {
  const all = await getVerdicts();
  all[key] = entry;
  const keys = Object.keys(all);
  if (keys.length > MAX_VERDICTS) {
    keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - MAX_VERDICTS).forEach((k) => delete all[k]);
  }
  await chrome.storage.local.set({ verdicts: all });
}

// answer snapshots per homework page, so a reload after "Submit" can be compared with the page before it
const MAX_SNAPS = 60;
export async function swapSnapshot(key, snap, tabId = null) {
  const { answerSnaps = {} } = await chrome.storage.local.get('answerSnaps');
  const prev = answerSnaps[key] || null; // {snap, at}
  answerSnaps[key] = { snap, at: Date.now(), tabId };
  const keys = Object.keys(answerSnaps);
  if (keys.length > MAX_SNAPS) {
    keys.sort((a, b) => answerSnaps[a].at - answerSnaps[b].at).slice(0, keys.length - MAX_SNAPS).forEach((k) => delete answerSnaps[k]);
  }
  await chrome.storage.local.set({ answerSnaps });
  return prev;
}

export async function pushHistory(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift(entry);
  await chrome.storage.local.set({ history: history.slice(0, 50) });
}
