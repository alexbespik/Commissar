// Reads graded answers off homework / quiz pages, with no AI. A site RULE says where the marks are: CSS selectors for
// correct / incorrect / partial marks and, optionally, a per-question container with its score and submission count.
// A page "snapshot" is those numbers; comparing two snapshots tells what was just graded.
// Also scores how much a page's own text looks like study material (pageSense), again locally.
// Plain script (no import/export) so it runs as a content script before src/watch.js and in the options page; it
// sets globalThis.CommissarAnswers. node --test loads it too.
(() => {
  /** The built-in rule (taught from a saved WebAssign homework page). User rules have the same shape. */
  const BUILTIN = [{
    id: 'webassign',
    name: 'WebAssign',
    hosts: ['webassign.net'],
    filePattern: 'webassign', // a saved page opened from disk, for testing
    question: '.waQBox[id^="question"]',
    score: '.columnRight .questionGrade', // the question's Total (the cells on the left are its parts)
    subs: '.submissions',                 // one per part: added up
    partScore: '.columnElastic .questionGrade', // each part's own score ("0.2/0.2"), in order
    partSubs: '.columnElastic .submissions',    // each part's own submission count ("2/5"), same order
    correct: '.waMark.mCorrect, .correctBord',
    incorrect: '.waMark.mIncorrect, .incorrectBord',
    partial: '.waMark.mPartial',
    grid: 'a[aria-label*="your score is" i]', // the newer points grid: "Question 3 out of 16, your score is 1 out of 1"
  }];

  /** Used with "auto-detect on every site": common class names, aria labels and data attributes. */
  const GENERIC = {
    id: 'generic',
    name: 'Auto-detect',
    hosts: [],
    correct: '.is-correct, .answer-correct, .correct-answer, .answer--correct, [data-correct="true"], [aria-label="Correct" i], [aria-label="Correct!" i], [aria-label="Your answer is correct" i]',
    incorrect: '.is-incorrect, .answer-incorrect, .incorrect-answer, .answer--incorrect, .is-wrong, [data-correct="false"], [aria-label="Incorrect" i], [aria-label="Wrong" i], [aria-label="Your answer is incorrect" i]',
    partial: '.is-partial, .partially-correct, [aria-label="Partially correct" i]',
  };

  /** The rule for a page: a user rule for its host, the built-in one, the generic one (auto mode) or null. */
  function ruleFor(loc, userRules = [], auto = false) {
    const host = String(loc.hostname || '').toLowerCase().replace(/^www\./, '');
    const hit = (r) => (r.hosts || []).some((h) => host === h || host.endsWith(`.${h}`));
    const user = (userRules || []).find(hit);
    if (user) return user;
    const built = BUILTIN.find(hit);
    if (built) return built;
    if (loc.protocol === 'file:') {
      const path = decodeURIComponent(loc.pathname || '').toLowerCase();
      const f = BUILTIN.find((r) => r.filePattern && path.includes(r.filePattern));
      if (f) return f;
    }
    return auto ? GENERIC : null;
  }

  // "–", "--", "none", "" -> null (not graded yet); "1", "0.5" -> number
  const num = (t) => {
    const s = String(t ?? '').trim().replace(',', '.');
    if (!s || /^[–—-]+$/.test(s) || /^none$/i.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  /** "1/5" or "– / 1" or "Score: 2/3" -> [a, b] (a may be null). */
  function frac(text) {
    const m = String(text || '').replace(/\s+/g, '').match(/([\d.,]*|[–—-]+)\/([\d.,]+)/);
    return m ? [num(m[1]), num(m[2])] : [null, null];
  }

  /** "Question 3 out of 16, your score is 1 out of 1" -> {n: 3, score: 1, max: 1}. */
  function parseGridLabel(label) {
    const m = String(label || '').match(/question\s+(\d+)\s+out of\s+\d+.*?score is\s+([\w.,–-]+)\s+out of\s+([\d.,]+)/i);
    return m ? { n: Number(m[1]), score: num(m[2]), max: num(m[3]) } : null;
  }

  const MAX_Q = 200; // a hostile page cannot make a snapshot (and the extension's storage) grow without bound
  const count = (root, sel) => { if (!sel) return 0; try { return root.querySelectorAll(sel).length; } catch { return 0; } };
  const first = (root, sel) => { if (!sel) return null; try { return root.querySelector(sel); } catch { return null; } };
  const all = (root, sel) => { if (!sel) return []; try { return [...root.querySelectorAll(sel)]; } catch { return []; } };

  /**
   * Snapshot of a page under `rule`: {questions: {id: {score, max, subs, c, i, p}}, marks: {c, i, p}}.
   * Only numbers: no answers or page text leave the page.
   */
  function readSnapshot(doc, rule) {
    const questions = {};
    if (rule.question) {
      all(doc, rule.question).slice(0, MAX_Q).forEach((box, n) => {
        const id = (box.id || `n${n + 1}`).slice(0, 64);
        const [score, max] = frac(first(box, rule.score)?.textContent);
        // a question in parts has a submission count per part: their sum moves whenever any part is submitted
        const counts = all(box, rule.subs).map((e) => frac(e.textContent)[0]).filter((n) => n != null);
        const subs = counts.length ? counts.reduce((a, b) => a + b, 0) : null;
        const q = { score, max, subs, c: count(box, rule.correct), i: count(box, rule.incorrect), p: count(box, rule.partial) };
        if (rule.partScore) {
          const ps = all(box, rule.partScore).slice(0, 30);
          const pn = all(box, rule.partSubs);
          if (ps.length) {
            q.parts = ps.map((e, k) => {
              const [s, m] = frac(e.textContent);
              return { score: s, max: m, subs: pn[k] ? frac(pn[k].textContent)[0] : null };
            });
          }
        }
        questions[id] = q;
      });
    }
    if (!Object.keys(questions).length && rule.grid) {
      for (const a of all(doc, rule.grid).slice(0, MAX_Q)) {
        const g = parseGridLabel(a.getAttribute('aria-label'));
        if (g) questions[`g${g.n}`] = { score: g.score, max: g.max, subs: null, c: 0, i: 0, p: 0 };
      }
    }
    return {
      questions,
      marks: { c: count(doc, rule.correct), i: count(doc, rule.incorrect), p: count(doc, rule.partial) },
    };
  }

  const full = (q) => q && q.score != null && q.max != null && q.max > 0 && q.score >= q.max;

  /**
   * What changed between two snapshots: {results: ['pass' | 'fail' | 'partial', ...], allDone}.
   * No previous snapshot (first visit) -> nothing: marks already on the page were graded before.
   */
  function diff(prev, cur) {
    const out = { results: [], allDone: false };
    if (!prev || !cur) return out;
    const pq = prev.questions || {}, cq = cur.questions || {};
    for (const [id, q] of Object.entries(cq)) {
      const p = pq[id];
      if (!p) continue;
      // a question in parts: judge each part that was just submitted on its own score (one right part of five is
      // "right", not "partial")
      if (Array.isArray(q.parts) && Array.isArray(p.parts) && q.parts.length === p.parts.length) {
        let judged = 0;
        q.parts.forEach((part, k) => {
          const was = p.parts[k];
          const submitted = part.subs != null && was.subs != null && part.subs > was.subs;
          const moved = part.score != null && part.score !== was.score;
          if (!submitted && !moved) return;
          judged += 1;
          if (full(part)) out.results.push('pass');
          else if (part.score != null && part.score > 0) out.results.push('partial');
          else if (part.score != null) out.results.push('fail');
          else judged -= 1; // submitted but not graded yet: the marks below decide
        });
        if (judged) continue;
        // the scores did not move (yet): new marks on the question decide
        const dc = q.c - p.c, di = q.i - p.i, dp = q.p - p.p;
        if (di > 0 && dc > 0) out.results.push('partial');
        else if (di > 0) out.results.push('fail');
        else if (dp > 0) out.results.push('partial');
        else if (dc > 0) out.results.push('pass');
        continue;
      }
      const moreSubs = q.subs != null && p.subs != null && q.subs > p.subs;
      const newMarks = (q.c - p.c) + (q.i - p.i) + (q.p - p.p) > 0;
      const scoreMoved = q.score != null && q.score !== p.score;
      if (!moreSubs && !newMarks && !scoreMoved) continue;
      if (full(q) || (q.score == null && q.c > p.c && q.i <= p.i && q.p <= p.p)) out.results.push('pass');
      else if ((q.score != null && q.score > 0) || q.p > p.p || (q.c > p.c && q.i > p.i)) out.results.push('partial');
      else out.results.push('fail');
    }
    // a page without per-question boxes: go by the page-wide mark counts
    if (!Object.keys(cq).length) {
      const pm = prev.marks || {}, cm = cur.marks || {};
      const dc = (cm.c || 0) - (pm.c || 0), di = (cm.i || 0) - (pm.i || 0), dp = (cm.p || 0) - (pm.p || 0);
      if (di > 0 && dc > 0) out.results.push('partial');
      else if (di > 0) out.results.push('fail');
      else if (dp > 0) out.results.push('partial');
      else if (dc > 0) out.results.push('pass');
    }
    const qs = Object.values(cq);
    out.allDone = qs.length > 1 && qs.every(full) && !Object.values(pq).every(full);
    return out;
  }

  /** The one trigger a batch of results speaks: all done, then any miss, then partial, then pass. */
  function triggerFor(change) {
    if (!change) return '';
    if (change.allDone) return 'allDone';
    const r = change.results || [];
    if (r.includes('fail')) return 'quizFail';
    if (r.includes('partial')) return 'quizPartial';
    if (r.includes('pass')) return 'quizPass';
    return '';
  }

  // ------------------------------------------------------------ does the page's own text look like study?
  const STUDY_TERMS = ['lecture', 'lesson', 'chapter', 'section', 'exercise', 'homework', 'assignment', 'quiz', 'exam',
    'theorem', 'definition', 'example', 'solution', 'problem', 'equation', 'formula', 'derivative', 'integral',
    'hypothesis', 'analysis', 'introduction', 'summary', 'references', 'abstract', 'syllabus', 'course', 'textbook',
    'question', 'answer', 'submit answer', 'practice', 'vocabulary', 'grammar', 'notes', 'tutorial', 'documentation'];
  const DISTRACT_TERMS = ['subscribe', 'trending', 'shorts', 'add to cart', 'buy now', 'sponsored', 'followers',
    'live now', 'watch next', 'for you', 'reels', 'stories', 'free shipping', 'deal of the day'];

  function hits(text, terms) {
    let n = 0;
    for (const t of terms) {
      const re = new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu');
      if (re.test(text)) n += 1;
    }
    return n;
  }

  /**
   * Local study score of a page: {score, verdict: 'study' | ''}. Never says 'distraction' (a wrong guess there would
   * punish you; the block list does that). `signals`: {math, answerForm, quizRule}.
   */
  function pageSense(text, title, subjectWords = [], signals = {}) {
    const body = String(text || '').slice(0, 20000);
    const t = `${title || ''}\n${body}`;
    let score = 0;
    score += Math.min(4, hits(t, STUDY_TERMS));
    score += 2 * Math.min(3, hits(t, subjectWords));
    if (signals.math) score += 2;
    if (signals.answerForm) score += 2;
    if (signals.quizRule) score += 3;
    score -= 2 * Math.min(3, hits(t, DISTRACT_TERMS));
    return { score, verdict: score >= 6 ? 'study' : '' };
  }

  globalThis.CommissarAnswers = { BUILTIN, GENERIC, ruleFor, frac, parseGridLabel, readSnapshot, diff, triggerFor, pageSense };
})();
