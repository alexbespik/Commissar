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

    if (cfg.readPages) {
      const signals = {
        math: Boolean(document.querySelector('math, .MathJax, mjx-container, .katex, .latex-source')),
        answerForm: [...document.querySelectorAll('input[type=submit], button')].slice(0, 300).some((b) => /submit answer|check answer|check my answer/i.test(b.value || b.textContent || '')),
        quizRule: Boolean(rule && rule.id !== 'generic'),
      };
      const sense = A.pageSense(document.body?.innerText || '', document.title, cfg.subjectWords || [], signals);
      if (sense.verdict) send({ type: 'pageSense', verdict: sense.verdict });
    }

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
    soon(1500);
    const obs = new MutationObserver(() => { if (!mine() || !chrome.runtime?.id) { obs.disconnect(); return; } soon(700); });
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-label', 'data-correct'] });
  });
})();
