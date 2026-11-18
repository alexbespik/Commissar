import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, step, newSession, verdictOf, maySpeak, pickClip, sanitizePack, matchesList, pageKey, normalizeSettings,
  nextDueIn, cleanRules, TRIGGERS,
} from '../src/core.js';

const S = normalizeSettings({});

test('lists, ambiguous sites and study words', () => {
  assert.equal(classify('https://www.reddit.com/r/all', 'reddit', S), 'distraction');
  assert.equal(classify('https://old.reddit.com/', '', S), 'distraction');
  assert.equal(classify('https://en.wikipedia.org/wiki/Integral', 'Integral', S), 'study');
  assert.equal(classify('https://www.webassign.net/web/Student/Assignment-Responses/last?dep=1', 'x', S), 'study');
  assert.equal(classify('https://www.youtube.com/watch?v=1', 'Funny cats compilation', S), 'distraction');
  assert.equal(classify('https://www.youtube.com/watch?v=2', 'Lecture 12: antiderivatives', S), 'study');
  assert.equal(classify('https://www.youtube.com/watch?v=3', 'Antiderivatives explained', S, 'antiderivatives'), 'study');
  assert.equal(classify('https://www.youtube.com/shorts/abc', 'Lecture', S), 'distraction');
  assert.equal(classify('https://example.com/blog', 'My trip', S), 'unknown');
  assert.equal(classify('https://example.com/blog', 'My trip', { ...S, strictUnknown: true }), 'distraction');
  assert.equal(classify('https://example.com/calc-notes', 'stuff', S), 'study');
  assert.equal(classify('chrome://newtab/', '', S), 'neutral');
  assert.equal(classify('file:///Users/me/book.pdf', '', S), 'study');
});

test('own lists beat cached verdicts; verdicts beat the title rules', () => {
  assert.equal(classify('https://reddit.com/r/calculus', 'x', S, '', { 'reddit.com/r': 'study' }), 'distraction');
  assert.equal(classify('https://example.com/a', 'x', S, '', { 'example.com/a': 'study' }), 'study');
  assert.equal(classify('https://example.com/a/b', 'x', S, '', { 'example.com': 'distraction' }), 'distraction');
});

test('matchesList and pageKey', () => {
  assert.ok(matchesList('https://m.youtube.com/shorts/x', ['youtube.com/shorts']));
  assert.ok(!matchesList('https://youtube.com/watch', ['youtube.com/shorts']));
  assert.ok(!matchesList('https://notreddit.com/', ['reddit.com']));
  assert.equal(pageKey('https://www.Example.com/Path/x?q=1#h'), 'example.com/path');
  assert.equal(pageKey('https://example.com/'), 'example.com');
  assert.equal(pageKey('about:blank'), '');
});

test('distraction needs the grace period, then deserts, then repeats; back only after a counted one', () => {
  const t0 = 1_000_000;
  let s = newSession(t0);
  let r = step(s, 'study', t0 + 1000, S); s = r.session;
  r = step(s, 'distraction', t0 + 2000, S); s = r.session;
  assert.deepEqual(r.triggers, []); // grace
  r = step(s, 'study', t0 + 4000, S); s = r.session;
  assert.deepEqual(r.triggers, []); // quick tab cycling: no warning, no "back"
  assert.equal(s.strikes, 0);
  r = step(s, 'distraction', t0 + 5000, S); s = r.session;
  r = step(s, 'distraction', t0 + 10_500, S); s = r.session;
  assert.deepEqual(r.triggers, ['distracted']);
  assert.equal(s.strikes, 1);
  r = step(s, 'distraction', t0 + 30_000, S); s = r.session;
  assert.deepEqual(r.triggers, []);
  r = step(s, 'distraction', t0 + 66_000, S); s = r.session;
  assert.deepEqual(r.triggers, ['deserted']);
  r = step(s, 'distraction', t0 + 90_000, S); s = r.session;
  assert.deepEqual(r.triggers, []);
  r = step(s, 'distraction', t0 + 150_000, S); s = r.session;
  assert.deepEqual(r.triggers, []);
  r = step(s, 'distraction', t0 + 187_000, S); s = r.session;
  assert.deepEqual(r.triggers, ['deserted']);
  r = step(s, 'study', t0 + 188_000, S); s = r.session;
  assert.deepEqual(r.triggers, ['back']);
  assert.ok(s.distractMs > 150_000);
});

test('time accounting, sleep gaps, focus blocks and idle', () => {
  const t0 = 0;
  let s = newSession(t0);
  s = step(s, 'study', t0, S).session;
  let at = t0;
  let fired = [];
  for (let i = 0; i < 52; i += 1) { at += 30_000; fired.push(...step(s, 'study', at, S).triggers); s = step(s, 'study', at, S).session; }
  assert.ok(fired.includes('focusBlock'));
  assert.equal(s.focusMs, 52 * 30_000);
  const before = s.focusMs;
  s = step(s, 'study', at + 3_600_000, S).session; // asleep for an hour
  assert.equal(s.focusMs, before);
  let r = step(s, 'idle', at + 3_610_000, S);
  assert.deepEqual(r.triggers, ['idle']);
  r = step(r.session, 'idle', at + 3_640_000, S);
  assert.deepEqual(r.triggers, []);
});

test('nextDueIn points at the grace and desert deadlines', () => {
  let s = newSession(0);
  s = step(s, 'distraction', 1000, S).session;
  assert.equal(nextDueIn(s, 2000, S), 4000);
  s = step(s, 'distraction', 6000, S).session;
  assert.equal(nextDueIn(s, 6000, S), 55_000);
  assert.equal(nextDueIn(newSession(0), 0, S), 0);
});

test('verdictOf and the throttle', () => {
  const base = { startedAt: 0, focusMs: 0, distractMs: 0 };
  assert.equal(verdictOf(base, 60_000), 'stop');
  assert.equal(verdictOf(base, 10 * 60_000), 'abandon');
  assert.equal(verdictOf({ ...base, focusMs: 20 * 60_000, distractMs: 60_000 }, 30 * 60_000), 'endGood');
  assert.equal(verdictOf({ ...base, focusMs: 20 * 60_000, distractMs: 10 * 60_000 }, 30 * 60_000), 'endBad');
  assert.ok(maySpeak('back', 0, 5));
  assert.ok(!maySpeak('back', 1000, 5000));
  assert.ok(maySpeak('distracted', 1000, 1001)); // the first warning is never held back
  assert.ok(maySpeak('deserted', 1000, 1001));
  assert.ok(maySpeak('quizFail', 1000, 1001));
});

const commissar = sanitizePack('commissar', { name: 'Commissar', events: { on: ['on-1.mp3'], tab: ['tab-1.mp3', 'tab-2.mp3'], quizFail: ['f.mp3'], desert: ['d.mp3'] } }, { 'tab-1.mp3': 'Close it.' });
const helldiver = sanitizePack('helldiver', { name: 'Officer', events: { on: ['line01.mp3'], quizStart: ['line02.mp3'], quizWin: ['w.mp3'], quizLose: ['l.mp3'], desert: ['t.mp3'] } });

test('pickClip fallbacks: helldiver starters, victory, loss and treason', () => {
  const h = { ...S, persona: 'helldiver' };
  assert.equal(pickClip([commissar, helldiver], h, 'start', () => 0).event, 'quizStart');
  assert.equal(pickClip([commissar, helldiver], h, 'endGood', () => 0).event, 'quizWin');
  assert.equal(pickClip([commissar, helldiver], h, 'endBad', () => 0).event, 'quizLose');
  assert.equal(pickClip([commissar, helldiver], h, 'abandon', () => 0).event, 'desert');
  assert.equal(pickClip([commissar, helldiver], S, 'start', () => 0).event, 'on');
  assert.equal(pickClip([commissar, helldiver], S, 'endBad', () => 0).event, 'quizFail');
  const c = pickClip([commissar], S, 'distracted', () => 0);
  assert.equal(c.file, 'tab-1.mp3');
  assert.equal(c.caption, 'Close it.');
  assert.equal(pickClip([commissar], S, 'distracted', () => 0, 'tab-1.mp3').file, 'tab-2.mp3');
  assert.equal(pickClip([commissar], S, 'focusBlock', () => 0), null);
  assert.equal(pickClip([helldiver], S, 'quizPartial', () => 0), null);
  assert.ok(TRIGGERS.focusBlock.caption);
});

test('squad mode picks among packs that have a line', () => {
  const sq = { ...S, persona: 'squad' };
  const seen = new Set();
  for (const r of [0, 0.6]) seen.add(pickClip([commissar, helldiver], sq, 'start', () => r).packId);
  assert.deepEqual([...seen].sort(), ['commissar', 'helldiver']);
  assert.equal(pickClip([commissar, helldiver], sq, 'distracted', () => 0.9).packId, 'commissar');
});

test('pack aliases come first', () => {
  const p = sanitizePack('x', { events: { boo: ['b.mp3'], tab: ['t.mp3'] }, aliases: { distracted: ['boo', 'missing'] } });
  assert.equal(pickClip([p], { persona: 'x' }, 'distracted', () => 0).event, 'boo');
});

test('sanitizePack rejects unsafe names', () => {
  assert.equal(sanitizePack('../x', { events: { on: ['a.mp3'] } }), null);
  const p = sanitizePack('ok', { events: { on: ['../a.mp3', 'a/b.mp3', 'good.mp3', '.hidden.mp3', 'x.exe'], 'bad event': ['c.mp3'] } });
  assert.deepEqual(p.events, { on: ['good.mp3'] });
  assert.equal(sanitizePack('ok', { events: { on: ['x.exe'] } }), null);
});

test('settings are clamped and rules shape-checked', () => {
  const s = normalizeSettings({ desertSeconds: 1, volume: 7, persona: '../x', gemini: { model: 'bad model/../', dailyCap: -4 }, rough: { commissar: 9, 'Bad Id': 2 } });
  assert.equal(s.desertSeconds, 15);
  assert.equal(s.volume, 1);
  assert.equal(s.persona, 'commissar');
  assert.equal(s.gemini.model, 'gemini-3.5-flash-lite');
  assert.equal(s.gemini.dailyCap, 0);
  assert.deepEqual(s.rough, { commissar: 3 });
  assert.equal(s.gemini.enabled, false);
  const rules = cleanRules([{ hosts: ['quiz.com', 'not a host'], correct: '.ok', junk: 'x' }, { hosts: ['nothing.com'] }, 'str']);
  assert.deepEqual(rules, [{ id: 'user-quiz.com', name: 'quiz.com', hosts: ['quiz.com'], correct: '.ok' }]);
});
