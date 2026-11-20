import { DEFAULTS, normalizeSettings, TRIGGERS } from './core.js';
import { cssCandidates, domCandidates, structureCandidates, guessHost, mergeCandidates, validSelector } from './teach.js';
import { GEMINI_ORIGIN } from './gemini.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: String(e) }));
const ALL = { origins: ['<all_urls>'] };
let settings = normalizeSettings({});
let packs = [];

const LISTS = ['allowlist', 'blocklist', 'ambiguous', 'studyKeywords', 'appStudy', 'appDistraction'];
const NUMS = ['graceSeconds', 'desertSeconds', 'repeatSeconds', 'focusMinutes', 'idleMinutes', 'driftMinutes',
  'countdownSeconds', 'awaySeconds', 'lockoutDesertions', 'penanceTimes', 'phoneSeconds', 'absentSeconds', 'lookAwaySeconds', 'lookDownSeconds', 'appDistractSeconds'];
const CHECKS = ['strictUnknown', 'punishOutsideBrowser', 'readPages', 'ttsFallback', 'overlay', 'answersAlways', 'autoDetect', 'effects', 'screamers', 'condemnTabs', 'camera', 'gaze', 'copybook', 'nativeOverlay'];
const PREVIEW = ['watch', 'start', 'distracted', 'deserted', 'lockout', 'back', 'away', 'awayPoint', 'awayShoot', 'returned', 'focusBlock', 'idle', 'quizPass', 'quizFail', 'allDone', 'endGood', 'endBad', 'abandon'];

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
  $('discipline').value = settings.discipline;
  $('penance').value = settings.penance;
  renderNotify();
  $('gEnabled').checked = settings.gemini.enabled;
  $('gKey').value = geminiKey;
  $('gModel').value = settings.gemini.model;
  $('gCap').value = settings.gemini.dailyCap;
  $('gAfter').value = settings.gemini.afterSeconds;
  $('gSnippet').checked = settings.gemini.sendSnippet;
  $('gChatCap').value = settings.gemini.chatCap;
  $('gReadAloud').checked = settings.gemini.readAloud;
  $('gLearn').checked = settings.gemini.learnSites;
  $('gLearnCap').value = settings.gemini.learnCap;
  renderLearned();
  renderCamera();
  renderNative();
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

async function renderNotify() {
  const ok = await chrome.permissions.contains({ permissions: ['notifications'] });
  $('notifyState').textContent = ok ? 'Allowed.' : 'Not allowed: away warnings are voice only.';
  $('grantNotify').hidden = ok;
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

/**
 * Saves everything on the page (the Gemini key too). Runs by itself a moment after any change (see autosave below),
 * and from the Save button. `quiet`: no permission prompts and no re-render (closing the page).
 */
let saving = Promise.resolve();
function saveAll(opts = {}) {
  saving = saving.then(() => doSave(opts), () => doSave(opts));
  return saving;
}

async function doSave({ quiet = false, rerender = false } = {}) {
  // permission prompts start from your own change or click (the defaults alone never prompt)
  // ask for all sites only when you just ticked something that needs it
  const newlyTicked = ['overlay', 'readPages', 'autoDetect', 'effects'].some((k) => $(k).checked && !settings[k]);
  const wantAll = !quiet && newlyTicked && !(await chrome.permissions.contains(ALL));
  const wantGemini = $('gEnabled').checked;
  if (!quiet && $('camera').checked && !settings.camera && !(await allowCamera())) $('camera').checked = false;
  // the Mac helper needs the native messaging permission (asked once, from your tick)
  if ($('nativeOverlay').checked && !(await chrome.permissions.contains({ permissions: ['nativeMessaging'] }))) {
    const ok = !quiet && await chrome.permissions.request({ permissions: ['nativeMessaging'] }).catch(() => false);
    if (!ok) $('nativeOverlay').checked = false;
  }
  const asks = [];
  if (wantAll) asks.push(...ALL.origins);
  if (wantGemini && !quiet && !(await chrome.permissions.contains({ origins: [GEMINI_ORIGIN] }))) asks.push(GEMINI_ORIGIN);
  if (asks.length) await chrome.permissions.request({ origins: asks }).catch(() => false);

  const next = { ...settings };
  next.persona = $('persona').value;
  next.discipline = $('discipline').value;
  next.penance = $('penance').value;
  next.squad = [...$('squad').querySelectorAll('input:checked')].map((i) => i.value);
  next.rough = Object.fromEntries(packs.map((p) => [p.id, Number($(`rough-${p.id}`).value)]));
  next.volume = Number($('volume').value);
  for (const k of LISTS) next[k] = lines($(k).value);
  for (const k of NUMS) next[k] = Number($(k).value);
  for (const k of CHECKS) next[k] = $(k).checked;
  next.gemini = {
    enabled: wantGemini, model: $('gModel').value.trim() || DEFAULTS.gemini.model, dailyCap: Number($('gCap').value),
    afterSeconds: Number($('gAfter').value), sendSnippet: $('gSnippet').checked,
    chatCap: Number($('gChatCap').value), readAloud: $('gReadAloud').checked,
    learnSites: $('gLearn').checked, learnCap: Number($('gLearnCap').value),
  };
  settings = next;
  await chrome.storage.local.set({ geminiKey: $('gKey').value.trim() });
  await store();
  if (rerender) await load(); // not while you type: it would reset the field you are in
  $('saved').textContent = `Saved automatically ${new Date().toLocaleTimeString()}`;
}

$('save').addEventListener('click', () => saveAll({ rerender: true }));

// autosave: every setting is kept a moment after you change it (typing: after a short pause). Not the controls that
// are not settings: the learned-sites search and file, the teach-a-site files and table.
const NOT_SETTINGS = (el) => !el?.id || ['learnFilter', 'learnFile', 'teachFiles'].includes(el.id) || el.closest('#teach, #learned, #camBox');
let autoTimer = 0;
const autosave = (e, wait) => {
  if (NOT_SETTINGS(e.target) && !e.target?.closest?.('#squad')) return;
  $('saved').textContent = 'Saving…';
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => { autoTimer = 0; saveAll(); }, wait);
};
document.addEventListener('change', (e) => autosave(e, 150));
document.addEventListener('input', (e) => { if (e.target.matches?.('input[type=text], input[type=password], input[type=number], input[type=search], textarea')) autosave(e, 900); });
// leaving the page with a change still waiting: keep it (no prompts possible now)
addEventListener('pagehide', () => { if (autoTimer) { clearTimeout(autoTimer); saveAll({ quiet: true }); } });

$('grantNotify').addEventListener('click', async () => {
  await chrome.permissions.request({ permissions: ['notifications'] }).catch(() => false);
  renderNotify();
});
$('persona').addEventListener('change', () => { $('squadBox').hidden = $('persona').value !== 'squad'; });
$('grantAll').addEventListener('click', async () => { await chrome.permissions.request(ALL).catch(() => false); await send({ type: 'settingsChanged' }); renderPerm(); });
$('revokeAll').addEventListener('click', async () => { await chrome.permissions.remove(ALL).catch(() => false); await send({ type: 'settingsChanged' }); renderPerm(); });

// ------------------------------------------------------------------ Mac helper

async function renderNative() {
  $('overlayCmd').textContent = `node tools/install-overlay.mjs ${chrome.runtime.id}`;
  const { nativeState } = await chrome.storage.local.get('nativeState');
  const st = nativeState || {};
  $('nativeState').textContent = st.connected ? `Connected.${st.app ? ` App in front: ${st.app}.` : ''}`
    : st.error ? `Not connected: ${st.error}` : 'Not connected (it connects when a session starts).';
}
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.nativeState) renderNative(); });
$('nativeTest').addEventListener('click', async () => {
  if (!(await chrome.permissions.contains({ permissions: ['nativeMessaging'] }))) {
    const ok = await chrome.permissions.request({ permissions: ['nativeMessaging'] }).catch(() => false);
    if (!ok) { $('nativeState').textContent = 'Not allowed: the browser needs the "talk to the helper" permission for this.'; return; }
  }
  $('nativeState').textContent = 'Starting the helper…';
  const r = await chrome.runtime.sendMessage({ type: 'testNative' }).catch(() => null);
  if (r?.ok) $('nativeState').textContent = 'Connected: he should have appeared over your screen for 3 seconds.';
  else renderNative(); // shows why it could not connect
});

// ------------------------------------------------------------------ camera watch

/** Asks for the camera once, here (the offscreen watcher cannot ask). Resolves true when allowed. */
async function allowCamera() {
  try {
    const st = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    st.getTracks().forEach((t) => t.stop());
    return true;
  } catch (e) {
    $('camState').textContent = e?.name === 'NotAllowedError' ? 'Camera blocked. Allow it in the address bar (camera icon) or the browser settings for this extension.'
      : e?.name === 'NotFoundError' ? 'No camera found.' : `Camera: ${String(e?.message || e).slice(0, 120)}`;
    return false;
  }
}

async function renderCamera() {
  const perm = await navigator.permissions?.query({ name: 'camera' }).catch(() => null);
  const { cameraState } = await chrome.storage.local.get('cameraState');
  const seen = cameraState && Date.now() - cameraState.at < 60_000
    ? ` Last look (${cameraState.source === 'post' ? 'watch window' : 'background'}): ${cameraState.error ? cameraState.error : `phone ${cameraState.phone ? 'yes' : 'no'}, person ${cameraState.person ? 'yes' : 'no'}${cameraState.look ? `, looking ${cameraState.look}` : ''}`}.` : (cameraState?.error ? ` Last problem: ${cameraState.error}` : '');
  $('camState').textContent = `Camera ${perm?.state === 'granted' ? 'allowed' : perm?.state === 'denied' ? 'blocked' : 'not allowed yet'}.${seen}`;
}

$('camAllow').addEventListener('click', async () => { if (await allowCamera()) renderCamera(); });

let camTest = null;
$('camTest').addEventListener('click', async () => {
  if (camTest) { camTest.stop(); return; }
  if (!(await allowCamera())) return;
  $('camState').textContent = 'Loading the detector…';
  let detector;
  try {
    const { createDetector, createFace, lookAt, gazeTracker } = await import('./vision.js');
    detector = await createDetector();
    const face = await createFace().catch(() => null);
    const gaze = gazeTracker();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const v = $('camVideo');
    v.srcObject = stream;
    await v.play();
    $('camBox').hidden = false;
    $('camTest').textContent = 'Stop the test';
    const c = $('camDraw');
    const g = c.getContext('2d');
    let timer = 0;
    camTest = {
      stop() {
        clearTimeout(timer);
        stream.getTracks().forEach((t) => t.stop());
        v.srcObject = null;
        $('camBox').hidden = true;
        $('camTest').textContent = 'Test it';
        camTest = null;
        renderCamera();
      },
    };
    const tick = () => {
      if (!camTest) return;
      let f;
      try { f = lookAt(detector, v); } catch (e) { const t = camTest; t.stop(); $('camState').textContent = `Detector problem: ${String(e?.message || e).slice(0, 160)}`; return; }
      c.width = v.videoWidth; c.height = v.videoHeight;
      g.lineWidth = 3;
      g.font = "16px 'Commissar Mono', monospace";
      for (const b of f.boxes) {
        g.strokeStyle = b.label === 'cell phone' ? '#ff3b2f' : '#c9a227';
        g.strokeRect(b.x, b.y, b.w, b.h);
        g.save(); g.scale(-1, 1); g.fillStyle = g.strokeStyle; // the canvas is mirrored: unmirror the text
        g.fillText(`${b.label === 'cell phone' ? 'PHONE' : 'you'} ${Math.round(b.score * 100)}%`, -(b.x + b.w) + 4, b.y + 18);
        g.restore();
      }
      const look = face && f.person ? gaze(face.detect(v)) : null;
      const where = look ? ` Looking: ${look.look.toUpperCase()} (turned ${look.turn >= 0 ? '+' : ''}${look.turn}, tilted ${look.tilt >= 0 ? '+' : ''}${look.tilt} from your usual${look.learned ? '' : '; still learning your usual direction'}).` : '';
      $('camState').textContent = `Sees: ${f.phone ? 'a PHONE' : 'no phone'}, ${f.person ? 'you' : 'nobody'}.${where} (Test only: nothing is counted.)`;
      timer = setTimeout(tick, 500);
    };
    tick();
  } catch (e) {
    $('camState').textContent = String(e?.message || e).slice(0, 200);
    camTest?.stop();
  }
});

// ------------------------------------------------------------------ sites the AI learned

let learned = {};
const VERDICTS = ['study', 'distraction', 'neutral'];

async function renderLearned() {
  const r = await send({ type: 'learned' });
  learned = r?.sites || {};
  const u = r?.usage;
  $('learnUsage').textContent = `${Object.keys(learned).length} sites known.`
    + (u ? ` Sorted on ${u.day}: ${u.count || 0}.` : '')
    + (u?.lastError ? ` Last problem: ${u.lastError}` : '');
  drawLearned();
}

function drawLearned() {
  const q = $('learnFilter').value.trim().toLowerCase();
  const rows = Object.entries(learned).filter(([h]) => !q || h.includes(q)).sort((a, b) => b[1].at - a[1].at).slice(0, 400);
  const head = el('tr', {}, ...['Site', 'Verdict', 'Why', 'When'].map((t) => el('th', { textContent: t, style: 'text-align:left;padding:4px 6px' })));
  $('learned').replaceChildren(head, ...rows.map(([host, e]) => {
    const sel = el('select', { 'aria-label': `Verdict for ${host}` }, ...VERDICTS.map((v) => new Option(v, v)), new Option('forget', ''));
    sel.value = e.v;
    sel.addEventListener('change', async () => {
      const r = await send({ type: 'setLearned', sites: { [host]: sel.value ? { v: sel.value, why: 'set by you' } : null } });
      learned = r?.sites || learned;
      drawLearned();
    });
    return el('tr', {},
      el('td', { textContent: host, style: 'padding:3px 6px;word-break:break-all' }),
      el('td', { style: 'padding:3px 6px' }, sel),
      el('td', { textContent: `${e.why || ''}${e.src === 'hand' ? ' (yours)' : ''}`, style: 'padding:3px 6px' }),
      el('td', { textContent: new Date(e.at).toLocaleDateString(), style: 'padding:3px 6px;white-space:nowrap' }));
  }));
  if (!rows.length) $('learned').append(el('tr', {}, el('td', { colSpan: 4, className: 'muted', textContent: q ? 'No site matches.' : 'Nothing learned yet.', style: 'padding:6px' })));
}

$('learnFilter').addEventListener('input', drawLearned);
$('learnSave').addEventListener('click', () => {
  const file = { app: 'Commissar Study Watch', kind: 'learned-sites', saved: new Date().toISOString(), sites: learned };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: `commissar-learned-sites-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
$('learnLoad').addEventListener('click', () => $('learnFile').click());
$('learnFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f || f.size > 2 * 1024 * 1024) return;
  try {
    const data = JSON.parse(await readFile(f));
    const sites = data?.sites && typeof data.sites === 'object' ? data.sites : data;
    const r = await send({ type: 'setLearned', sites, replace: false, keepSource: true });
    learned = r?.sites || learned;
    drawLearned();
    $('learnUsage').textContent = `Loaded. ${Object.keys(learned).length} sites known.`;
  } catch { $('learnUsage').textContent = 'That file could not be read.'; }
});
$('learnClear').addEventListener('click', async () => {
  if (!confirm('Forget every site the AI sorted (and the ones you set here)? Save a file first if you want to keep them.')) return;
  const r = await send({ type: 'setLearned', sites: {}, replace: true });
  learned = r?.sites || {};
  drawLearned();
});

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
