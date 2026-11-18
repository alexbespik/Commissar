// "Teach a site": finds likely right / wrong / partial marks, question boxes and score cells in a saved page (its HTML
// and, if given, its CSS files), so the options page can propose a rule for you to check by hand. No AI: just names.
// The HTML is parsed with DOMParser, which never runs the page's scripts.

const SKIP = /hint|button|btn|derivative|diff|override|icon-?font|toggle|tooltip|correction|incorrectly/i;

/** 'correct' | 'incorrect' | 'partial' | '' for a class name, aria label or attribute value. */
export function classifyToken(tok) {
  const t = String(tok || '');
  if (!t || t.length > 60 || SKIP.test(t)) return '';
  if (/partial/i.test(t)) return 'partial';
  if (/in-?correct|wrong|fail(ed|ure)?(?![a-z])/i.test(t)) return 'incorrect';
  if (/correct|passed/i.test(t)) return 'correct'; // not "right": that is mostly layout (text-right, float-right)
  return '';
}

/** The compound part of a CSS selector that holds `cls` (".waMark.mCorrect" out of "div .waMark.mCorrect:hover"). */
function compoundWith(selector, cls) {
  const parts = selector.split(/\s+|>|\+|~/).map((p) => p.trim()).filter(Boolean);
  const hit = parts.find((p) => p.split(/(?=[.#[:])/).includes(`.${cls}`));
  return hit ? hit.replace(/::?[a-z-]+(\([^)]*\))?/gi, '') : `.${cls}`;
}

const MAX_CSS = 1_000_000;

/** Removes /* comments *\/ in one pass (a hostile file with thousands of unclosed comments stays linear). */
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('/*', i);
    if (start < 0) { out += text.slice(i); break; }
    out += text.slice(i, start);
    const end = text.indexOf('*/', start + 2);
    if (end < 0) break;
    i = end + 2;
  }
  return out;
}

/** Candidate mark selectors from stylesheet text: [{selector, kind, source: 'css'}]. Reads at most 1 MB. */
export function cssCandidates(cssText) {
  const out = new Map();
  const text = stripComments(String(cssText || '').slice(0, MAX_CSS));
  let from = 0;
  // each selector list is the text between the previous brace and the next "{": one linear walk
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '}') { from = i + 1; continue; }
    if (ch !== '{') continue;
    const head = text.slice(from, i);
    from = i + 1;
    if (head.length > 2000) continue;
    for (const sel of head.split(',')) {
      const s = sel.trim();
      if (!s || s.startsWith('@') || s.length > 300) continue;
      for (const cls of s.match(/\.[A-Za-z_][\w-]*/g) || []) {
        const name = cls.slice(1);
        const kind = classifyToken(name);
        if (!kind) continue;
        const c = compoundWith(s, name);
        if (/^[.#\w[\]="'-]+$/.test(c) && !SKIP.test(c) && !out.has(c)) out.set(c, { selector: c, kind, source: 'css' });
      }
    }
  }
  return [...out.values()];
}

const cssEsc = (s) => (globalThis.CSS?.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, (ch) => `\\${ch}`));

/** Candidates found on elements of a parsed page: classes, aria labels, data-correct; with how many there are. */
export function domCandidates(doc) {
  const out = new Map();
  const add = (selector, kind, source) => {
    const e = out.get(selector) || { selector, kind, source, count: 0 };
    e.count += 1;
    out.set(selector, e);
  };
  for (const el of doc.body ? doc.body.querySelectorAll('*') : []) {
    for (const cls of el.classList) {
      const kind = classifyToken(cls);
      if (kind) add(`.${cssEsc(cls)}`, kind, 'page');
    }
    const label = el.getAttribute('aria-label');
    if (label && label.length < 40) {
      const kind = classifyToken(label);
      if (kind) add(`[aria-label="${label.replace(/"/g, '\\"')}" i]`, kind, 'page');
    }
    const dc = el.getAttribute('data-correct');
    if (dc === 'true' || dc === 'false') add(`[data-correct="${dc}"]`, dc === 'true' ? 'correct' : 'incorrect', 'page');
  }
  return [...out.values()];
}

/** Repeated per-question containers, score cells and submission cells: {question: [], score: [], subs: []}. */
export function structureCandidates(doc) {
  const res = { question: [], score: [], subs: [] };
  const tally = (list, selector) => { const e = list.find((x) => x.selector === selector); if (e) e.count += 1; else list.push({ selector, count: 1 }); };
  for (const el of doc.body ? doc.body.querySelectorAll('[id], [class]') : []) {
    const id = el.id || '';
    if (/^question[-_]?\d/i.test(id)) {
      const cls = [...el.classList].find((c) => !/^(container|initialized|qws|active|hide)$/i.test(c));
      tally(res.question, cls ? `.${cssEsc(cls)}[id^="${id.match(/^question[-_]?/i)[0]}"]` : `[id^="${id.match(/^question[-_]?/i)[0]}"]`);
    }
    const text = (el.childElementCount <= 2 ? el.textContent : '').replace(/\s+/g, '');
    if (!/^([\d.,]*|[–—-]+)\/[\d.,]+$/.test(text)) continue;
    for (const cls of el.classList) {
      if (/score|grade|points|mark/i.test(cls)) tally(res.score, `.${cssEsc(cls)}`);
      if (/submission|attempt|tries/i.test(cls)) tally(res.subs, `.${cssEsc(cls)}`);
    }
  }
  for (const k of Object.keys(res)) res[k] = res[k].filter((x) => x.count >= 2 || k !== 'question').sort((a, b) => b.count - a.count).slice(0, 6);
  return res;
}

const NOT_SITE = /(^|\.)(google|googleapis|gstatic|cloudflare|jsdelivr|unpkg|cdn|cloudfront|akamai|doubleclick|facebook|twitter|youtube|mathjax|fonts|w3|schema|cengage\.info)\./i;

/** The site a saved page came from: canonical / og:url / base, else the most common link host. */
export function guessHost(doc) {
  const pick = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
  for (const sel of ['link[rel=canonical]', 'meta[property="og:url"]', 'base[href]']) {
    const el = doc.querySelector(sel);
    const h = pick(el?.getAttribute('href') || el?.getAttribute('content') || '');
    if (h) return h;
  }
  const counts = {};
  for (const a of doc.querySelectorAll('a[href^="http"], form[action^="http"]')) {
    const h = pick(a.getAttribute('href') || a.getAttribute('action'));
    if (h && !NOT_SITE.test(`${h}.`)) counts[h] = (counts[h] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

/** Merges CSS and page candidates per selector, page counts kept. */
export function mergeCandidates(fromCss, fromDom) {
  const map = new Map();
  for (const c of [...fromDom, ...fromCss]) {
    const e = map.get(c.selector);
    if (e) e.source = e.source === c.source ? e.source : 'page+css';
    else map.set(c.selector, { count: 0, ...c });
  }
  return [...map.values()].sort((a, b) => (b.count - a.count) || a.kind.localeCompare(b.kind)).slice(0, 40);
}

/** Whether a selector string parses (needs a DOM). */
export function validSelector(sel, doc = globalThis.document) {
  try { doc.createDocumentFragment().querySelector(sel); return true; } catch { return false; }
}
