import { DEFAULTS, normalizeSettings, TRIGGERS } from './core.js';
import { cssCandidates, domCandidates, structureCandidates, guessHost, mergeCandidates, validSelector } from './teach.js';
import { GEMINI_ORIGIN } from './gemini.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: String(e) }));
const ALL = { origins: ['<all_urls>'] };
let settings = normalizeSettings({});
let packs = [];

const LISTS = ['allowlist', 'blocklist', 'ambiguous', 'studyKeywords'];
const NUMS = ['graceSeconds', 'desertSeconds', 'repeatSeconds', 'focusMinutes', 'idleMinutes'];
const CHECKS = ['strictUnknown', 'punishOutsideBrowser', 'readPages', 'ttsFallback', 'overlay', 'answersAlways', 'autoDetect'];
const PREVIEW = ['start', 'distracted', 'deserted', 'back', 'focusBlock', 'idle', 'quizPass', 'quizFail', 'allDone', 'endGood', 'endBad', 'abandon'];

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

// ------------------------------------------------------------------ load / render

async function load() {
  const st = await send({ type: 'status' });
  packs = st?.packs || [];
  settings = normalizeSettings((await chrome.storage.local.get('settings')).settings);
  const { geminiKey = '' } = await chrome.storage.local.get('geminiKey');

  const sel = $('persona');
  sel.replaceChildren(...packs.map((p) => new Option(p.name, p.id)));
  if (packs.length > 1) sel.add(new Option('Squad (everyone takes turns)', 'squad'));
  sel.value = settings.persona;
  $('squad').replaceChildren(...packs.map((p) => el('label', { className: 'check' },
    el('input', { type: 'checkbox', value: p.id, checked: settings.squad.includes(p.id) }), ` ${p.name}`)));
  $('squadBox').hidden = settings.persona !== 'squad';
  $('rough').replaceChildren(...packs.map((p) => el('div', {},
    el('label', { htmlFor: `rough-${p.id}`, textContent: p.name }),
    el('input', { id: `rough-${p.id}`, type: 'range', min: 0, max: 3, step: 1, value: settings.rough[p.id] ?? 0, style: 'width:100%' }))));
  $('preview').replaceChildren(...PREVIEW.map((t) => el('button', {
    textContent: t, title: TRIGGERS[t]?.caption || '',
    onclick: () => send({ type: 'preview', trigger: t, persona: $('persona').value }),
  })));
  $('volume').value = settings.volume;
  for (const k of LISTS) $(k).value = settings[k].join('\n');
  for (const k of NUMS) $(k).value = settings[k];
  for (const k of CHECKS) $(k).checked = settings[k];
  $('gEnabled').checked = settings.gemini.enabled;
  $('gKey').value = geminiKey;
  $('gModel').value = settings.gemini.model;
  $('gCap').value = settings.gemini.dailyCap;
  $('gAfter').value = settings.gemini.afterSeconds;
  $('gSnippet').checked = settings.gemini.sendSnippet;
  renderRules();
  renderUsage();
  renderPerm();
}

function renderRules() {
  const A = globalThis.CommissarAnswers;
  const rows = A.BUILTIN.map((r) => el('div', { className: 'rule' },
    el('span', {}, el('b', { textContent: r.name }), el('span', { className: 'muted', textContent: ` · ${r.hosts.join(', ')} · built in` }))));
  settings.quizRules.forEach((r, i) => rows.push(el('div', { className: 'rule' },
    el('span', {}, el('b', { textContent: r.name }), el('span', { className: 'muted', textContent: ` · ${r.hosts.join(', ')} · taught` })),
    el('button', { textContent: 'Remove', onclick: async () => {
      settings.quizRules.splice(i, 1);
      await store();
      renderRules();
    } }))));
  $('rules').replaceChildren(...rows);
}

async function renderUsage() {
  const { geminiUsage } = await chrome.storage.local.get('geminiUsage');
  const has = await chrome.permissions.contains({ origins: [GEMINI_ORIGIN] });
  const parts = [`Today: ${geminiUsage?.count || 0} of ${settings.gemini.dailyCap} checks used.`];
  if (settings.gemini.enabled && !has) parts.push('Not allowed to reach Gemini yet: save to allow it.');
  $('gUsage').replaceChildren(el('span', { textContent: parts.join(' ') }),
    geminiUsage?.lastError ? el('div', { className: 'err', textContent: `Last error: ${geminiUsage.lastError}` }) : '');
}

async function renderPerm() {
  const all = await chrome.permissions.contains(ALL);
  $('perm').textContent = all
    ? 'Allowed on all sites: banners, page reading and taught sites work everywhere. Nothing leaves your browser except optional Gemini checks.'
    : 'Not allowed on all sites: banners show only on WebAssign and sites you taught; page reading is off.';
}

// ------------------------------------------------------------------ save

const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);

async function store() {
  settings = normalizeSettings(settings);
  await chrome.storage.local.set({ settings });
  await send({ type: 'settingsChanged' });
}

$('save').addEventListener('click', async () => {
  // permission prompts must start straight from the click
  // ask for all sites only when you just ticked something that needs it (the defaults alone never prompt)
  const newlyTicked = ['overlay', 'readPages', 'autoDetect'].some((k) => $(k).checked && !settings[k]);
  const wantAll = newlyTicked && !(await chrome.permissions.contains(ALL));
  const wantGemini = $('gEnabled').checked;
  const asks = [];
  if (wantAll) asks.push(...ALL.origins);
  if (wantGemini) asks.push(GEMINI_ORIGIN);
  if (asks.length) await chrome.permissions.request({ origins: asks }).catch(() => false);

  const next = { ...settings };
  next.persona = $('persona').value;
  next.squad = [...$('squad').querySelectorAll('input:checked')].map((i) => i.value);
  next.rough = Object.fromEntries(packs.map((p) => [p.id, Number($(`rough-${p.id}`).value)]));
  next.volume = Number($('volume').value);
  for (const k of LISTS) next[k] = lines($(k).value);
  for (const k of NUMS) next[k] = Number($(k).value);
  for (const k of CHECKS) next[k] = $(k).checked;
  next.gemini = {
    enabled: wantGemini, model: $('gModel').value.trim() || DEFAULTS.gemini.model, dailyCap: Number($('gCap').value),
    afterSeconds: Number($('gAfter').value), sendSnippet: $('gSnippet').checked,
  };
  settings = next;
  await chrome.storage.local.set({ geminiKey: $('gKey').value.trim() });
  await store();
  await load();
  $('saved').textContent = `Saved ${new Date().toLocaleTimeString()}`;
});

$('persona').addEventListener('change', () => { $('squadBox').hidden = $('persona').value !== 'squad'; });
$('grantAll').addEventListener('click', async () => { await chrome.permissions.request(ALL).catch(() => false); await send({ type: 'settingsChanged' }); renderPerm(); });
$('revokeAll').addEventListener('click', async () => { await chrome.permissions.remove(ALL).catch(() => false); await send({ type: 'settingsChanged' }); renderPerm(); });

// ------------------------------------------------------------------ teach a site

let teachDoc = null;
const KINDS = ['correct', 'incorrect', 'partial', 'ignore'];

const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(f); });

$('teachFiles').addEventListener('change', async (e) => {
  const files = [...e.target.files].slice(0, 200);
  const htmlFile = files.find((f) => /\.html?$/i.test(f.name));
  if (!htmlFile) { $('tResult').textContent = 'Pick the saved .html page.'; $('teach').hidden = false; return; }
  if (htmlFile.size > 15 * 1024 * 1024) { $('tResult').textContent = 'That page is over 15 MB.'; $('teach').hidden = false; return; }
  const html = await readFile(htmlFile);
  let css = '';
  for (const f of files.filter((x) => /\.css$/i.test(x.name) && x.size < 2 * 1024 * 1024)) {
    if (css.length > 1_000_000) break; // enough to find the marks; keeps a hostile file from hanging this page
    css += `\n${await readFile(f)}`;
  }
  teachDoc = new DOMParser().parseFromString(html, 'text/html'); // scripts in it never run
  for (const s of teachDoc.querySelectorAll('style')) css += `\n${s.textContent}`;

  const cands = mergeCandidates(cssCandidates(css), domCandidates(teachDoc));
  const count = (sel) => { try { return teachDoc.querySelectorAll(sel).length; } catch { return 0; } };
  $('tMarks').replaceChildren(...(cands.length ? cands.map((c) => {
    const select = el('select', { dataset: { selector: c.selector } }, ...KINDS.map((k) => new Option(k === 'ignore' ? 'ignore' : k, k)));
    select.value = c.kind;
    return el('tr', {},
      el('td', {}, el('code', { textContent: c.selector })),
      el('td', { textContent: String(count(c.selector)) }),
      el('td', {}, select));
  }) : [el('tr', {}, el('td', { colSpan: 3, className: 'muted', textContent: 'No right/wrong marks found. Save a page that already shows graded answers, include its .css files, or type selectors into the boxes below.' }))]));

  const st = structureCandidates(teachDoc);
  $('tQuestion').value = st.question[0]?.selector || '';
  $('tScore').value = st.score[0]?.selector || '';
  $('tSubs').value = st.subs[0]?.selector || '';
  const host = guessHost(teachDoc);
  $('tHost').value = host;
  $('tName').value = (teachDoc.title || host).split(/[|·–-]/).pop().trim().slice(0, 60) || host;
  $('tResult').textContent = '';
  $('teach').hidden = false;
});

function ruleFromForm() {
  const pick = (kind) => [...$('tMarks').querySelectorAll('select')].filter((s) => s.value === kind).map((s) => s.dataset.selector);
  const rule = {
    name: $('tName').value.trim(),
    hosts: [$('tHost').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')],
    correct: pick('correct').join(', '), incorrect: pick('incorrect').join(', '), partial: pick('partial').join(', '),
    question: $('tQuestion').value.trim(), score: $('tScore').value.trim(), subs: $('tSubs').value.trim(),
  };
  for (const k of ['correct', 'incorrect', 'partial', 'question', 'score', 'subs']) {
    if (rule[k] && !validSelector(rule[k])) return { error: `"${k}" is not a valid CSS selector.` };
    if (!rule[k]) delete rule[k];
  }
  return { rule };
}

$('tTest').addEventListener('click', () => {
  if (!teachDoc) return;
  const { rule, error } = ruleFromForm();
  if (error) { $('tResult').textContent = error; return; }
  const snap = globalThis.CommissarAnswers.readSnapshot(teachDoc, rule);
  const qs = Object.values(snap.questions);
  const scored = qs.filter((q) => q.max != null).length;
  $('tResult').textContent = `${qs.length} question boxes, ${scored} with a readable score, ${qs.filter((q) => q.subs != null).length} with a submission count. Marks now: ${snap.marks.c} right, ${snap.marks.i} wrong, ${snap.marks.p} partial.`;
});

$('tSave').addEventListener('click', async () => {
  const { rule, error } = ruleFromForm();
  if (error) { $('tResult').textContent = error; return; }
  const host = rule.hosts[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) { $('tResult').textContent = 'Type the site, e.g. quizsite.com'; return; }
  if (!rule.correct && !rule.incorrect && !rule.score) { $('tResult').textContent = 'Choose at least one right or wrong mark, or a score.'; return; }
  const ok = await chrome.permissions.request({ origins: [`*://${host}/*`, `*://*.${host}/*`] }).catch(() => false);
  settings.quizRules = [...settings.quizRules.filter((r) => r.hosts[0] !== host), rule];
  await store();
  renderRules();
  $('tResult').textContent = ok ? `Saved. Answers on ${host} are now read (reload its open tabs).` : `Saved, but access to ${host} was not allowed, so it cannot be read yet.`;
});

load();
