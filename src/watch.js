// Content script (after src/answers.js). On a quiz page it sends the service worker a snapshot of the grades
// (numbers only) on load and whenever the page changes; where page reading is on it also sends the local
// "looks like study" score. Never sends page text. It cannot read the extension's storage (the service worker
// locks it to extension pages); what it needs comes from the service worker.
(() => {
  // after the extension reloads, the old copy on an open page is cut off; a newly injected copy takes over and the
  // old one stops when it sees a newer token
  const token = Math.random().toString(36).slice(2);
  globalThis.__commissarWatch = token;
  const mine = () => globalThis.__commissarWatch === token;
  const A = globalThis.CommissarAnswers;
  if (!A || !chrome?.runtime?.id) return;

  const send = (msg) => { try { return chrome.runtime.sendMessage(msg).catch(() => null); } catch { return Promise.resolve(null); } };
  // the page is remembered by a hash of its address, not the address (query strings can hold tokens)
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  // recomputed on every report: a single-page app moving to another exercise is another page
  const pageId = () => `${location.hostname}#${hash(location.origin + location.pathname + location.search)}`;

  send({ type: 'watchConfig' }).then((cfg) => {
    if (!cfg?.ok) return;
    const rule = A.ruleFor(location, cfg.quizRules || [], Boolean(cfg.autoDetect));

    let active = cfg.active !== false; // an older worker does not say: treat as active
    let subjectWords = cfg.subjectWords || [];
    let sensed = false;
    // reading the whole page text is skipped when no session is running; done once a session is on
    const senseOnce = () => {
      if (sensed || !cfg.readPages || !active) return;
      sensed = true;
      const signals = {
        math: Boolean(document.querySelector('math, .MathJax, mjx-container, .katex, .latex-source')),
        answerForm: [...document.querySelectorAll('input[type=submit], button')].slice(0, 300).some((b) => /submit answer|check answer|check my answer/i.test(b.value || b.textContent || '')),
        quizRule: Boolean(rule && rule.id !== 'generic'),
      };
      const sense = A.pageSense(document.body?.innerText || '', document.title, subjectWords, signals);
      if (sense.verdict) send({ type: 'pageSense', verdict: sense.verdict });
    };
    senseOnce();
    // a session started after this page loaded (only the extension can send this; a page cannot)
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== 'sessionActive' || active || !mine()) return;
      active = true;
      if (Array.isArray(msg.subjectWords)) subjectWords = msg.subjectWords.slice(0, 50).map(String);
      senseOnce();
      if (!rule) return; // nothing below was set up
      soon(500);
      if (rule.id === 'generic') setTimeout(recheck, 60_000);
    });

    if (!rule) return;
    let last = '';
    let timer = 0;
    let firstPending = 0;
    let sent = false;
    const report = () => {
      clearTimeout(timer);
      timer = 0;
      firstPending = 0;
      const snap = A.readSnapshot(document, rule);
      if (!obs && watching(snap)) observe();
      const json = JSON.stringify(snap);
      if (json === last) return;
      last = json; // unchanged numbers are never re-sent, so an ordinary page sends one snapshot
      send({ type: 'answers', key: pageId(), rule: rule.id, snap, first: !sent });
      sent = true;
    };
    // report once the page has been quiet for a moment (marks drawn late after a load would otherwise look new),
    // but at least every 3 s while it keeps changing
    const soon = (quietMs) => {
      clearTimeout(timer);
      if (!firstPending) firstPending = Date.now();
      timer = setTimeout(report, Date.now() - firstPending > 3000 ? 0 : quietMs);
    };
    // the page-wide observer is the costly part: the generic rule gets one only in a session and only once the page
    // showed grade marks or questions (a page that has none at first load is not a quiz)
    let obs = null;
    const watching = (snap) => rule.id !== 'generic' || (active && (snap.marks.c + snap.marks.i + snap.marks.p > 0 || Object.keys(snap.questions).length > 0));
    const observe = () => {
      obs = new MutationObserver(() => { if (!mine() || !chrome.runtime?.id) { obs.disconnect(); return; } soon(700); });
      obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-label', 'data-correct'] });
    };
    if (rule.id !== 'generic') observe();
    soon(1500);
    // a quiz app that draws its questions late: look again a few times (one snapshot each) before giving up
    // the generic rule without an observer: during a session, one snapshot a minute (marks appear after a submit;
    // quiz apps draw their questions late) until the page shows something to watch
    const recheck = () => {
      if (obs || !mine() || !chrome.runtime?.id) return;
      if (active) report();
      if (!obs && active) setTimeout(recheck, 60_000);
    };
    if (rule.id === 'generic') for (const ms of [6000, 20000]) setTimeout(() => { if (!obs && active && mine() && chrome.runtime?.id) report(); }, ms);
    if (rule.id === 'generic') setTimeout(recheck, 60_000);

  });
})();
