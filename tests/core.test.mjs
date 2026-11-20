import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, step, newSession, verdictOf, maySpeak, pickClip, sanitizePack, matchesList, pageKey, normalizeSettings,
  nextDueIn, cleanRules, TRIGGERS, modeCaps, trackKey, trackKind, accrue, rollDay, mergeDay, summarize, todayView,
  localDay, TRACK_MAX_KEYS,
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
  r = step(s, 'distraction', t0 + 20_000, S); s = r.session;
  assert.deepEqual(r.triggers, []);
  r = step(s, 'distraction', t0 + 36_000, S); s = r.session;
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

test('an unjudged page drifts into distraction after driftMinutes', async () => {
  const { driftStatus } = await import('../src/core.js');
  const s = { unknownSince: 1000 };
  assert.equal(driftStatus(s, 1000 + 4 * 60_000, S), 'neutral');
  assert.equal(driftStatus(s, 1000 + 5 * 60_000, S), 'distraction');
  assert.equal(driftStatus(s, 1000 + 99 * 60_000, { ...S, driftMinutes: 0 }), 'neutral');
});

test('punishments follow the discipline level', async () => {
  const { punishmentFor } = await import('../src/core.js');
  const sess = { strikes: 5, desertions: 1 }; // many strikes from tab hopping must not skip the burn
  assert.deepEqual(punishmentFor('distracted', sess, { discipline: 'standard' }).effects, ['flash']);
  const d = punishmentFor('deserted', sess, { discipline: 'standard' });
  assert.deepEqual(d.effects, ['grayscale', 'burn', 'shake', 'countdown']);
  assert.equal(d.say, 'deserted');
  assert.equal(d.returnInS, 6);
  assert.equal(d.condemn, true);
  assert.equal(punishmentFor('deserted', sess, { discipline: 'standard', condemnTabs: false }).condemn, false);
  // the second desertion brings the writing punishment on top of the burn, with no timed way out
  const lock = punishmentFor('deserted', { strikes: 1, desertions: 2 }, { discipline: 'standard' });
  assert.equal(lock.say, 'lockout');
  assert.deepEqual(lock.effects, ['grayscale', 'burn', 'lockout']);
  assert.equal(lock.penanceTimes, 3);
  assert.equal(lock.returnInS, 0);
  assert.equal(lock.condemn, true);
  const harsh = punishmentFor('deserted', { strikes: 1, desertions: 1 }, { discipline: 'harsh' });
  assert.equal(harsh.say, 'lockout');
  assert.ok(harsh.penanceTimes >= 5);
  assert.equal(punishmentFor('deserted', { desertions: 3 }, { discipline: 'standard', lockoutDesertions: 4 }).say, 'deserted');
  const lenient = punishmentFor('deserted', sess, { discipline: 'lenient' });
  assert.deepEqual([lenient.returnInS, lenient.condemn, lenient.effects.includes('burn')], [0, false, false]);
  const off = punishmentFor('deserted', { strikes: 9, desertions: 9 }, { discipline: 'off' });
  assert.deepEqual([off.effects, off.returnInS, off.notify], [[], 0, false]);
  // effects off: still sent back and burned, but no lockout that could not be shown
  const plain = punishmentFor('deserted', { desertions: 5 }, { discipline: 'standard', effects: false });
  assert.deepEqual([plain.effects, plain.say, plain.returnInS > 0], [[], 'deserted', true]);
  // the browser losing attention pulls you back at every stage from standard up
  for (const t of ['away', 'awayPoint', 'awayShoot']) {
    assert.equal(punishmentFor(t, { focusedOnce: true }, { discipline: 'standard' }).focusWindow, true, t);
    assert.equal(punishmentFor(t, {}, { discipline: 'lenient' }).focusWindow, false, t);
  }
  assert.equal(punishmentFor('away', {}, { discipline: 'standard' }).screamer, '');
  assert.equal(punishmentFor('awayPoint', {}, { discipline: 'standard' }).screamer, 'point');
  assert.equal(punishmentFor('awayShoot', {}, { discipline: 'standard' }).screamer, 'shoot');
  assert.equal(punishmentFor('awayShoot', {}, { discipline: 'lenient' }).screamer, '');
  assert.equal(punishmentFor('awayShoot', {}, { discipline: 'harsh', screamers: false }).screamer, '');
  // coming back after he pointed (or fired): the screamer meets you in the browser
  assert.deepEqual([punishmentFor('returned', { cameBackFrom: 2 }, { discipline: 'standard' }).screamer, punishmentFor('returned', { cameBackFrom: 2 }, { discipline: 'standard' }).say], ['point', 'awayPoint']);
  assert.equal(punishmentFor('returned', { cameBackFrom: 5 }, { discipline: 'standard' }).screamer, 'shoot');
  assert.equal(punishmentFor('returned', { cameBackFrom: 1 }, { discipline: 'standard' }).screamer, '');
  assert.equal(punishmentFor('returned', { cameBackFrom: 3 }, { discipline: 'lenient' }).screamer, '');
});

test('time out of the browser counts as distracted only when you ask for it', () => {
  let s = { ...newSession(0), status: 'away' };
  assert.equal(step(s, 'away', 30_000, S).session.distractMs, 0);
  const strict = normalizeSettings({ punishOutsideBrowser: true });
  s = step(s, 'away', 30_000, strict).session;
  assert.equal(s.distractMs, 30_000);
  assert.equal(s.awayMs, 30_000);
});

test('settings saved under schema 1 move off the old slow defaults, but keep chosen values', () => {
  const s = normalizeSettings({ schemaVersion: 1, desertSeconds: 30, countdownSeconds: 8, awaySeconds: 120 });
  assert.deepEqual([s.desertSeconds, s.countdownSeconds, s.awaySeconds], [20, 6, 10]);
  const mine = normalizeSettings({ schemaVersion: 1, desertSeconds: 45, awaySeconds: 300 });
  assert.deepEqual([mine.desertSeconds, mine.awaySeconds], [45, 300]);
  assert.equal(normalizeSettings({ schemaVersion: 1, desertSeconds: 60, countdownSeconds: 10 }).desertSeconds, 20);
  assert.equal(normalizeSettings({ schemaVersion: 2, desertSeconds: 30 }).desertSeconds, 30);
  assert.equal(normalizeSettings({ schemaVersion: 2, awaySeconds: 60 }).awaySeconds, 10); // 10 s out of the browser now
  assert.equal(normalizeSettings({ schemaVersion: 2, awaySeconds: 45 }).awaySeconds, 45);
  assert.equal(normalizeSettings({ schemaVersion: 3, awaySeconds: 60 }).awaySeconds, 60);
});

test('the browser losing attention: away after awaySeconds, returned when back, return cancelled', () => {
  const S = normalizeSettings({ awaySeconds: 120 });
  let s = { ...newSession(0), status: 'study' };
  let r = step(s, 'away', 1000, S); s = r.session;
  r = step(s, 'away', 60_000, S); s = r.session;
  assert.deepEqual(r.triggers, []);
  r = step(s, 'away', 121_500, S); s = r.session;
  assert.deepEqual(r.triggers, ['away']);
  r = step(s, 'away', 150_000, S); s = r.session;
  assert.deepEqual(r.triggers, []);
  assert.ok(s.awayMs > 100_000);
  // the screamers: pointing at 2x, the pistol at 3x, once each
  r = step(s, 'away', 210_000, S); s = r.session;
  r = step(s, 'away', 241_500, S); s = r.session;
  assert.deepEqual(r.triggers, ['awayPoint']);
  for (let at = 270_000; at < 360_000; at += 30_000) { r = step(s, 'away', at, S); s = r.session; assert.deepEqual(r.triggers, []); }
  r = step(s, 'away', 361_500, S); s = r.session;
  assert.deepEqual(r.triggers, ['awayShoot']);
  r = step(s, 'away', 390_000, S); s = r.session;
  assert.deepEqual(r.triggers, []);
  // still gone: he keeps firing every awaySeconds
  r = step(s, 'away', 481_500, S);
  assert.deepEqual(r.triggers, ['awayShoot']);
  r = step(s, 'study', 151_000, S); s = r.session;
  assert.deepEqual(r.triggers, ['returned']);
  assert.equal(s.cameBackFrom, 3, 'he remembers how far it went');
  s = { ...s, status: 'distraction', pendingReturn: { at: 999_999, fromTabId: 2 } };
  s = step(s, 'study', 160_000, S).session;
  assert.equal(s.pendingReturn, null);
});

test('check-ins come at random between min and max; he peeks from an edge', async () => {
  const { nextCheckIn, peekSpot } = await import('../src/core.js');
  assert.equal(nextCheckIn(0, () => 0), 1 * 60_000); // every 1 to 5 minutes, not a setting
  assert.equal(nextCheckIn(0, () => 1), 5 * 60_000);
  assert.equal('checkIns' in normalizeSettings({ checkIns: false }), false);
  assert.deepEqual(peekSpot(() => 0), { side: 'bottom', at: 0.12 });
  assert.equal(peekSpot(() => 0.99).side, 'right');
});

test('nextDueIn points at the grace and desert deadlines', () => {
  let s = newSession(0);
  s = step(s, 'distraction', 1000, S).session;
  assert.equal(nextDueIn(s, 2000, S), 4000);
  s = step(s, 'distraction', 6000, S).session;
  assert.equal(nextDueIn(s, 6000, S), 15_000);
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

test('a pack can pick single clips for a trigger; its own event still wins', () => {
  const p = sanitizePack('x', { events: { tab: ['mild.mp3', 'stern.mp3'], desert: ['d.mp3'] }, aliases: { distracted: ['stern.mp3', 'gone.mp3'] } });
  assert.equal(pickClip([p], { persona: 'x' }, 'distracted', () => 0).file, 'stern.mp3');
  const q = sanitizePack('x', { events: { distracted: ['new.mp3'], tab: ['stern.mp3'] }, aliases: { distracted: ['stern.mp3'] } });
  assert.equal(pickClip([q], { persona: 'x' }, 'distracted', () => 0).file, 'new.mp3');
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

test('sites the AI learned: neutral holds, study words and your lists still win', async () => {
  const { classify: c } = await import('../src/core.js');
  const learned = { 'search.example': 'neutral', 'cats.example': 'distraction', 'notes.example': 'study', 'youtube.com': 'study' };
  assert.equal(c('https://search.example/q', 'cats', S, '', {}, learned), 'neutral');
  assert.equal(c('https://search.example/q', 'calculus lecture notes', S, '', {}, learned), 'study');
  assert.equal(c('https://cats.example/', 'cats', S, '', {}, learned), 'distraction');
  assert.equal(c('https://cats.example/', 'lecture on cats', S, '', {}, learned), 'study'); // study words beat a learned site
  assert.equal(c('https://notes.example/', 'x', S, '', {}, learned), 'study');
  assert.equal(c('https://reddit.com/', 'x', S, '', {}, { 'reddit.com': 'study' }), 'distraction'); // your block list first
  assert.equal(c('https://www.youtube.com/watch?v=1', 'funny cats', S, '', {}, learned), 'distraction'); // mixed sites: the title
  assert.equal(c('https://search.example/q', 'x', { ...S, strictUnknown: true }, '', {}, learned), 'neutral');
});

test('the site-learning request and answer', async () => {
  const { buildSiteRequest, parseSiteResponse } = await import('../src/gemini.js');
  const { learnableHost } = await import('../src/gemini.js');
  const body = buildSiteRequest({ title: 'Cats', url: 'https://cats.example/a/reset-token-123?token=secret' });
  const text = body.contents[0].parts[0].text;
  assert.ok(text.includes('"cats.example/a"') && !text.includes('secret') && !text.includes('reset-token'), 'only host and first path segment');
  assert.ok(learnableHost('cats.example') && learnableHost('xn--80aswg.xn--p1ai') && learnableHost('en.wikipedia.org'));
  assert.ok(!learnableHost('192.168.1.1') && !learnableHost('localhost') && !learnableHost('__proto__') && !learnableHost(''));
  assert.deepEqual(body.generationConfig.responseSchema.properties.verdict.enum, ['study', 'distraction', 'neutral']);
  const wrap = (t) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
  assert.deepEqual(parseSiteResponse(wrap('{"verdict":"neutral","why":"a search engine"}')), { v: 'neutral', why: 'a search engine' });
  assert.equal(parseSiteResponse(wrap('{"verdict":"maybe"}')), null);
  assert.equal(parseSiteResponse(wrap('nonsense')), null);
});

test('the distraction clock is not dropped by hopping tabs or apps; only study resets it', () => {
  const t0 = 1_000_000;
  let s = { ...newSession(t0), status: 'study' };
  let r = step(s, 'distraction', t0, S); s = r.session;
  r = step(s, 'distraction', t0 + 6000, S); s = r.session;
  assert.deepEqual(r.triggers, ['distracted']);
  const since = s.distractedSince;
  s = { ...s, pendingReturn: { at: t0 + 99_000, fromTabId: 2 } };
  // off to another app for a minute, then another distracting tab: same clock, no new warning, burn still pending
  r = step(s, 'away', t0 + 10_000, S); s = r.session;
  assert.ok(s.pendingReturn, 'leaving the browser must not cancel the burn');
  r = step(s, 'away', t0 + 60_000, S); s = r.session;
  r = step(s, 'distraction', t0 + 70_000, S); s = r.session;
  assert.equal(s.distractedSince, since);
  assert.deepEqual(r.triggers, ['deserted']); // 70 s off post: the desertion comes at once
  assert.equal(s.strikes, 1);
  // a blank page for a moment does not reset it either
  r = step(s, 'neutral', t0 + 75_000, S); s = r.session;
  r = step(s, 'distraction', t0 + 80_000, S); s = r.session;
  assert.equal(s.distractedSince, since);
  // back to study: reset, praise
  r = step(s, 'study', t0 + 90_000, S); s = r.session;
  assert.deepEqual(r.triggers, ['back']);
  assert.equal(s.pendingReturn, null);
  // off distractions for longer than CARRY_MS: a fresh start next time
  r = step({ ...s, distractedSince: t0, lastDistractAt: t0 + 90_000, warned: true }, 'neutral', t0 + 100_000, S); s = r.session;
  r = step(s, 'distraction', t0 + 90_000 + 181_000, S); s = r.session;
  assert.equal(s.distractedSince, t0 + 90_000 + 181_000);
  assert.equal(s.warned, false);
});

test('the away clock keeps running through a distracting tab; an outside-resources pass excuses it', () => {
  const S = normalizeSettings({ awaySeconds: 60 });
  let s = { ...newSession(0), status: 'study' };
  let r = step(s, 'away', 1000, S); s = r.session;
  r = step(s, 'distraction', 30_000, S); s = r.session;
  assert.deepEqual(r.triggers, []); // no "you are back" for a distraction
  r = step(s, 'away', 40_000, S); s = r.session;
  assert.equal(s.awaySince, 1000);
  r = step(s, 'away', 62_000, S);
  assert.deepEqual(r.triggers, ['away']);
  // excused (pass): no warnings, and the away clock is reset
  s = { ...newSession(0), status: 'study' };
  for (let at = 1000; at < 400_000; at += 30_000) { r = step(s, 'excused', at, S); s = r.session; assert.deepEqual(r.triggers, []); }
  assert.equal(s.awaySince, 0);
});

test('the camera watch: a phone is a strike, still on it is a desertion, an empty chair is noticed once', async () => {
  const { cameraStep, cameraBusy } = await import('../src/core.js');
  const C = normalizeSettings({ camera: true });
  let s = { ...newSession(0), status: 'study' };
  let r = cameraStep(s, { phone: true, person: true }, 1000, C); s = r.session;
  assert.deepEqual(r.triggers, []); // a glance is free
  r = cameraStep(s, { phone: true, person: true }, 4500, C); s = r.session;
  assert.deepEqual(r.triggers, ['phone']);
  assert.equal(s.strikes, 1);
  r = cameraStep(s, { phone: true, person: true }, 20_000, C); s = r.session;
  assert.deepEqual(r.triggers, []);
  r = cameraStep(s, { phone: true, person: true }, 34_500, C); s = r.session;
  assert.deepEqual(r.triggers, ['phoneStill']);
  assert.equal(s.desertions, 1);
  r = cameraStep(s, { phone: true, person: true }, 50_000, C); s = r.session;
  assert.deepEqual(r.triggers, []);
  r = cameraStep(s, { phone: true, person: true }, 65_000, C); s = r.session;
  assert.deepEqual(r.triggers, ['phoneStill'], 'he keeps firing every 30 s while the phone stays');
  assert.equal(s.strikes, 3);
  assert.equal(s.desertions, 2);
  r = cameraStep(s, { phone: true, person: true }, 90_000, C); s = r.session;
  assert.deepEqual(r.triggers, []);
  assert.equal(cameraBusy(s, 90_000, C), false, 'on the phone is not busy');
  r = cameraStep(s, { phone: false, person: true }, 91_000, C); s = r.session;
  assert.ok(s.camPhoneSince, 'a moment out of view is the same phone');
  r = cameraStep(s, { phone: false, person: true }, 95_500, C); s = r.session;
  assert.equal(s.camPhoneSince, 0);
  assert.equal(cameraBusy(s, 96_000, C), true, 'at the desk, off the phone: reading');
  assert.equal(cameraBusy(s, 96_000, S), false, 'camera off');
  assert.equal(cameraBusy(s, 140_000, C), false, 'no word from the camera: unknown');
  // started with nobody in view: not "at the desk"
  const fresh = cameraStep({ ...newSession(0), status: 'study' }, { phone: false, person: false }, 1000, C).session;
  assert.equal(cameraBusy(fresh, 2000, C), false);
  r = cameraStep(s, { phone: false, person: false }, 100_000, C); s = r.session;
  r = cameraStep(s, { phone: false, person: false }, 191_000, C); s = r.session;
  assert.deepEqual(r.triggers, ['absent']);
  r = cameraStep(s, { phone: false, person: false }, 400_000, C); s = r.session;
  assert.deepEqual(r.triggers, []);
  r = cameraStep(s, { phone: false, person: true }, 401_000, C); s = r.session;
  assert.equal(s.camAbsentWarned, false);
  const { punishmentFor } = await import('../src/core.js');
  assert.equal(punishmentFor('phone', s, C).screamer, 'point');
  assert.ok(punishmentFor('phone', s, C).effects.includes('flash'));
  assert.equal(punishmentFor('phoneStill', s, C).screamer, 'shoot');
  assert.equal(punishmentFor('phone', s, { ...C, discipline: 'off' }).screamer, '');
});

test('the camera smoother: 3 of 4 frames for a phone, 5 misses before nobody is there', async () => {
  const { smoother, judgeFrame } = await import('../src/vision.js');
  const sm = smoother();
  const f = (phone, person) => ({ phone, person });
  assert.equal(sm(f(true, true)).phone, false);
  assert.equal(sm(f(true, true)).phone, false);
  assert.equal(sm(f(false, true)).phone, false, 'a flicker is not a phone');
  assert.equal(sm(f(true, true)).phone, true); // T T F T: 3 of 4
  assert.equal(sm(f(true, true)).phone, true);
  assert.equal(sm(f(true, true)).phone, true);
  assert.equal(sm(f(false, true)).phone, true); // T T T F
  assert.equal(sm(f(false, true)).phone, false);
  for (let i = 0; i < 4; i += 1) assert.equal(sm(f(false, false)).person, true);
  assert.equal(sm(f(false, false)).person, false);
  const j = judgeFrame({ detections: [
    { categories: [{ categoryName: 'cell phone', score: 0.6 }], boundingBox: { originX: 1, originY: 2, width: 3, height: 4 } },
    { categories: [{ categoryName: 'person', score: 0.2 }], boundingBox: {} },
  ] });
  assert.deepEqual([j.phone, j.person, j.boxes.length], [true, false, 1]);
});

test('where you look: away is warned then struck; head down only counts with hands off the keys; a pass excuses it', async () => {
  const { cameraStep } = await import('../src/core.js');
  const C = normalizeSettings({ camera: true });
  const run = (s, obs, at) => cameraStep(s, { phone: false, person: true, ...obs }, at, C);
  let s = { ...newSession(0), status: 'study' };
  let r = run(s, { look: 'away' }, 1000); s = r.session;
  r = run(s, { look: 'away' }, 21_500); s = r.session;
  assert.deepEqual(r.triggers, ['lookAway']);
  assert.equal(s.strikes, 0);
  r = run(s, { look: 'screen' }, 22_000); s = r.session; // a 1 s look back is not enough to reset
  r = run(s, { look: 'away' }, 23_000); s = r.session;
  r = run(s, { look: 'away' }, 61_500); s = r.session;
  assert.deepEqual(r.triggers, ['lookAwayLong']);
  assert.equal(s.strikes, 1);
  r = run(s, { look: 'screen' }, 62_000); s = r.session;
  r = run(s, { look: 'screen' }, 66_000); s = r.session;
  assert.equal(s.camLookAwaySince, 0, 'back on the screen for 3 s: fresh start');
  // head down while typing: working
  for (let at = 70_000; at < 300_000; at += 5000) { r = run(s, { look: 'down', input: true }, at); s = r.session; assert.deepEqual(r.triggers, []); }
  // head down, hands off the keys (a phone in the lap)
  r = run(s, { look: 'down', input: false }, 300_000); s = r.session;
  r = run(s, { look: 'down', input: false }, 345_500); s = r.session;
  assert.deepEqual(r.triggers, ['lookDown']);
  r = run(s, { look: 'down', input: false }, 435_500); s = r.session;
  assert.deepEqual(r.triggers, ['lookDownLong']);
  assert.equal(s.strikes, 2);
  // an outside-resources pass: paper is fine
  let p = { ...newSession(0), status: 'study', passUntil: 10_000_000 };
  for (let at = 1000; at < 500_000; at += 5000) { r = run(p, { look: 'down', input: false }, at); p = r.session; assert.deepEqual(r.triggers, []); }
  // the watch switched off, or no face model: nothing
  let o = { ...newSession(0), status: 'study' };
  for (let at = 1000; at < 200_000; at += 5000) { r = cameraStep(o, { person: true, look: 'away' }, at, { ...C, gaze: false }); o = r.session; assert.deepEqual(r.triggers, []); }
  const { punishmentFor } = await import('../src/core.js');
  assert.equal(punishmentFor('lookAwayLong', s, C).screamer, 'point');
  assert.equal(punishmentFor('lookAway', s, C).screamer, '');
});

test('reading a face: straight on, turned away, head down', async () => {
  const { judgeFace } = await import('../src/vision.js');
  const face = (noseX, noseY, extra = {}) => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    lm[234] = { x: 0.3, y: 0.5 }; lm[454] = { x: 0.7, y: 0.5 }; lm[10] = { x: 0.5, y: 0.2 }; lm[152] = { x: 0.5, y: 0.8 };
    lm[1] = { x: noseX, y: noseY };
    return { faceLandmarks: [lm], faceBlendshapes: [{ categories: Object.entries(extra).map(([categoryName, score]) => ({ categoryName, score })) }] };
  };
  assert.equal(judgeFace(face(0.5, 0.53)).look, 'screen');
  assert.equal(judgeFace(face(0.66, 0.53)).look, 'away');
  assert.equal(judgeFace(face(0.5, 0.64)).look, 'down');
  assert.equal(judgeFace(face(0.5, 0.53, { eyeLookOutLeft: 0.8, eyeLookInRight: 0.8 })).look, 'away');
  assert.equal(judgeFace(face(0.5, 0.53, { eyeLookDownLeft: 0.7, eyeLookDownRight: 0.7 })).look, 'down');
  assert.equal(judgeFace({}).look, 'none');
  assert.equal(judgeFace(face(0.42, 0.64)).look, 'downRight', 'head down, turned to your right: a copybook');
  assert.equal(judgeFace(face(0.58, 0.64)).look, 'away', 'down and to the left is still away');
});

test('WebAssign and its Cengage pages stay study: Gemini verdicts and an old saved allowlist cannot flip them', () => {
  const old = normalizeSettings({ allowlist: ['wikipedia.org'], strictUnknown: true }); // saved before these were listed
  const gemini = { 'college.cengage.com/watch-it': 'distraction', 'webassign.net': 'distraction' };
  const learned = { 'cengage.com': 'distraction', 'login.cengage.com': 'neutral' };
  assert.equal(classify('https://www.webassign.net/web/Student/Assignment-Responses/last?dep=1', 'x', old, '', gemini, learned), 'study');
  assert.equal(classify('https://college.cengage.com/watch-it', 'Watch It', old, '', gemini, learned), 'study');
  assert.equal(classify('https://login.cengage.com/', 'Sign in', old, '', gemini, learned), 'study');
  assert.equal(classify('https://www.cengage.com/', '', normalizeSettings({ allowlist: [], blocklist: ['cengage.com'] })), 'distraction', 'your block list still wins');
});

test('copybook mode: down and to the right is working; without it, it is head down', async () => {
  const { cameraStep } = await import('../src/core.js');
  const run = (settings) => {
    let s = { ...newSession(0), status: 'study' };
    const seen = [];
    for (let at = 1000; at <= 70_000; at += 1000) { const r = cameraStep(s, { person: true, look: 'downRight', input: false }, at, settings); s = r.session; seen.push(...r.triggers); }
    return seen;
  };
  assert.deepEqual(run(normalizeSettings({ camera: true, copybook: true })), []);
  assert.deepEqual(run(normalizeSettings({ camera: true })), ['lookDown', 'lookDownLong']);
});

test('one phone is punished once by the phone rules, not again by the look rules; a look back resets the clock', async () => {
  const { cameraStep } = await import('../src/core.js');
  const C = normalizeSettings({ camera: true });
  let s = { ...newSession(0), status: 'study' };
  let r;
  const seen = [];
  for (let at = 1000; at <= 70_000; at += 1000) { r = cameraStep(s, { phone: true, person: true, look: 'down', input: false }, at, C); s = r.session; seen.push(...r.triggers); }
  assert.ok(!seen.includes('lookDown') && !seen.includes('lookDownLong'), seen.join());
  assert.deepEqual(seen, ['phone', 'phoneStill', 'phoneStill']);
  // away 18 s, back 8 s (reported only once, as the camera does), away again: a fresh 20 s
  let t = { ...newSession(0), status: 'study' };
  for (let at = 1000; at <= 18_000; at += 1000) t = cameraStep(t, { person: true, look: 'away' }, at, C).session;
  t = cameraStep(t, { person: true, look: 'screen' }, 19_000, C).session;
  r = cameraStep(t, { person: true, look: 'away' }, 27_000, C); t = r.session;
  assert.deepEqual(r.triggers, []);
  r = cameraStep(t, { person: true, look: 'away' }, 28_000, C);
  assert.deepEqual(r.triggers, [], 'the clock started over');
});

test('apps: study, distraction, neutral, the browser itself; your lists decide', async () => {
  const { classifyApp } = await import('../src/core.js');
  const a = (name, bundle) => classifyApp({ name, bundle }, S);
  assert.equal(a('Telegram', 'ru.keepcoder.Telegram'), 'distraction');
  assert.equal(a('Preview', 'com.apple.Preview'), 'study');
  assert.equal(a('Code', 'com.microsoft.VSCode'), 'study');
  assert.equal(a('Activity Monitor', 'com.apple.ActivityMonitor'), 'neutral'); // 'tv' is a whole word only
  assert.equal(a('Brave Browser', 'com.brave.Browser'), 'browser');
  assert.equal(a('Finder', 'com.apple.finder'), 'neutral');
  assert.equal(classifyApp({ name: 'Telegram' }, { ...S, appDistraction: [] }), 'neutral');
  assert.equal(classifyApp({ name: 'Anki' }, { ...S, appDistraction: ['anki'] }), 'distraction'); // distraction wins
  assert.equal(classifyApp({}, S), 'neutral');
});

test('the helper pages escape text and carry the button', async () => {
  const { watchHtml, scareHtml } = await import('../src/native-html.js');
  const w = watchHtml({ line: '<img src=x onerror=alert(1)>' });
  assert.ok(!w.includes('<img src=x') && w.includes('&lt;img'));
  assert.ok(w.includes("postMessage('outsidePass')"));
  const sc = scareHtml('shoot', '"><script>bad()</script>');
  assert.ok(!sc.includes('<script>bad()') && sc.includes('BANG.'));
  assert.ok(scareHtml('point').includes('YOU.'));
  const { watchData } = await import('../src/native-html.js');
  const d = watchData({ passUntil: Date.now() + 60_000 });
  assert.match(d.until, /^Outside resources until /);
  assert.equal(watchData().until, '');
  assert.ok(d.rows.length && d.colors.r && !('html' in d));
});

test('a phone found in the zoomed look lands back in the right place', async () => {
  const { judgeFrame } = await import('../src/vision.js');
  const r = judgeFrame({ detections: [{ categories: [{ categoryName: 'cell phone', score: 0.6 }], boundingBox: { originX: 100, originY: 40, width: 60, height: 120 } }] }, { x: 77, y: 144, scale: 2 });
  assert.deepEqual(r.boxes[0], { label: 'cell phone', score: 0.6, x: 127, y: 164, w: 30, h: 60 });
  assert.equal(judgeFrame({ detections: [{ categories: [{ categoryName: 'cell phone', score: 0.35 }], boundingBox: {} }] }).phone, false, 'unsure is not a phone');
});

test('defaults kept; away repeats never faster than every 10 s', () => {
  assert.equal(S.answersAlways, true);
  const F = normalizeSettings({ awaySeconds: 3 });
  let s = { ...newSession(0), status: 'study' };
  const fired = [];
  for (let at = 1000; at <= 60_000; at += 500) { const r = step(s, 'away', at, F); s = r.session; fired.push(...r.triggers.map((t) => `${t}@${Math.round((at - 1000) / 1000)}`)); }
  assert.deepEqual(fired.slice(0, 3), ['away@3', 'awayPoint@6', 'awayShoot@9']);
  const shots = fired.filter((f) => f.startsWith('awayShoot')).map((f) => Number(f.split('@')[1]));
  for (let i = 1; i < shots.length; i += 1) assert.ok(shots[i] - shots[i - 1] >= 10, shots.join());
});

test('looking away is judged against where your face usually points (a camera off to the side)', async () => {
  const { gazeTracker } = await import('../src/vision.js');
  const face = (noseX, noseY = 0.53) => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    lm[234] = { x: 0.3, y: 0.5 }; lm[454] = { x: 0.7, y: 0.5 }; lm[10] = { x: 0.5, y: 0.2 }; lm[152] = { x: 0.5, y: 0.8 };
    lm[1] = { x: noseX, y: noseY };
    return { faceLandmarks: [lm], faceBlendshapes: [{ categories: [] }] };
  };
  const g = gazeTracker();
  // the camera sits to the side: looking at the screen puts the nose at 0.37 of the face (would be "away" straight on)
  let r;
  for (let i = 0; i < 30; i += 1) r = g(face(0.37));
  assert.equal(r.look, 'screen');
  assert.equal(r.learned, true);
  assert.equal(g(face(0.55)).look, 'away', 'turned away from the screen (towards the camera side)');
  assert.equal(g(face(0.2)).look, 'away', 'turned away the other way');
  assert.equal(g(face(0.4)).look, 'screen', 'a small move is not away');
  // a long look away is still away: it does not become the new "usual"
  for (let i = 0; i < 80; i += 1) r = g(face(0.6));
  assert.equal(r.look, 'away', 'still away after 80 looks');
  assert.equal(g(face(0.37)).look, 'screen', 'and looking back is the screen at once');
  assert.equal(g({}).look, 'none');
  assert.equal(normalizeSettings({ schemaVersion: 3, lookAwaySeconds: 20 }).lookAwaySeconds, 8);
});

test('modes: settings keep a known one, a session without one is an overseer', () => {
  assert.equal(normalizeSettings({}).mode, 'overseer');
  assert.equal(normalizeSettings({ mode: 'tracker' }).mode, 'tracker');
  assert.equal(normalizeSettings({ mode: 'nope' }).mode, 'overseer');
  assert.equal(modeCaps({}).punish, true);
  assert.equal(modeCaps(null).speak, true);
  assert.deepEqual(modeCaps({ mode: 'tracker' }), { speak: false, punish: false, camera: false, checkIn: false });
  assert.equal(newSession(1, '', 'tracker').mode, 'tracker');
  assert.equal(verdictOf({ ...newSession(0, '', 'tracker') }, 3_600_000), 'tracked');
});

test('trackKey and trackKind', () => {
  assert.equal(trackKey({ url: 'https://www.Reddit.com/r/x' }), 'reddit.com');
  assert.equal(trackKey({ url: 'file:///Users/a/b.pdf' }), 'Local files');
  assert.equal(trackKey({ url: 'chrome://settings' }), '(browser pages)');
  assert.equal(trackKey({ url: '' }), '(browser pages)');
  assert.equal(trackKey({ url: 'https://reddit.com/', incognito: true }), '(private window)');
  assert.equal(trackKey({ outside: true, app: { name: '  Telegram ' }, url: 'https://reddit.com/' }), 'Telegram');
  assert.equal(trackKey({ outside: true, app: null }), 'Other apps');
  assert.equal(trackKey({ outside: true, app: { name: 'x'.repeat(100) } }).length, 60);
  assert.equal(trackKey({ idle: true, url: 'https://reddit.com/' }), '');
  assert.equal(trackKind('study'), 'w');
  assert.equal(trackKind('distraction'), 's');
  assert.equal(trackKind('away', 'distraction'), 's');
  assert.equal(trackKind('away', 'neutral'), 'n');
  assert.equal(trackKind('away'), 'n');
  assert.equal(trackKind('neutral'), 'n');
  assert.equal(trackKind('excused', 'distraction'), 'n');
});

test('step books the slice under what the previous look saw', () => {
  const t0 = 1_000_000;
  let s = newSession(t0);
  s = step(s, 'study', t0, S, 'youtube.com', { key: 'youtube.com', kind: 'w' }).session;
  s = step(s, 'distraction', t0 + 10_000, S, 'youtube.com', { key: 'youtube.com', kind: 's' }).session;
  s = step(s, 'distraction', t0 + 15_000, S, 'youtube.com', { key: 'youtube.com', kind: 's' }).session;
  assert.deepEqual(s.apps, { 'youtube.com': { w: 10_000, s: 5_000, n: 0 } });
  assert.deepEqual(s.dayApps, s.apps);
  // a gap over 90 s counts nothing, and neither does a locked screen
  s = step(s, 'study', t0 + 200_000, S, '', { key: 'a.com', kind: 'w' }).session;
  assert.equal(s.apps['a.com'], undefined);
  assert.equal(s.apps['youtube.com'].s, 5_000);
  s = step(s, 'locked', t0 + 210_000, S, '', null).session;
  assert.equal(s.apps['a.com'].w, 10_000);
  assert.equal(s.trackKey, '');
  s = step(s, 'study', t0 + 220_000, S, '', { key: 'b.com', kind: 'w' }).session;
  assert.equal(s.apps['b.com'], undefined);
  // without a track nothing is booked and nothing else changes
  const plain = step(newSession(t0), 'study', t0 + 5000, S);
  assert.deepEqual(plain.session.apps, {});
});

test('accrue keeps at most TRACK_MAX_KEYS keys', () => {
  let apps = {};
  for (let i = 0; i < TRACK_MAX_KEYS; i += 1) apps = accrue(apps, `k${i}`, 'w', 1);
  apps = accrue(apps, 'new.example', 's', 7);
  assert.equal(apps['new.example'], undefined);
  assert.equal(apps['(other)'].s, 7);
  assert.equal(accrue(apps, 'k0', 'w', 2).k0.w, 3); // a known key still counts under its own name
});

test('rollDay flushes the old day once', () => {
  const t = new Date(2026, 5, 10, 23, 59).getTime();
  const s = { ...newSession(t), dayApps: { 'a.com': { w: 5, s: 0, n: 0 } } };
  const same = rollDay(s, t + 30_000);
  assert.equal(same.flush, null);
  const next = rollDay(s, t + 120_000);
  assert.deepEqual(next.flush, { day: '2026-06-10', apps: { 'a.com': { w: 5, s: 0, n: 0 } } });
  assert.deepEqual([next.session.day, next.session.dayApps], ['2026-06-11', {}]);
  assert.equal(rollDay(next.session, t + 180_000).flush, null);
});

test('mergeDay sums, prunes to the newest days; summarize sorts; todayView adds the live part', () => {
  let days = {};
  for (let d = 1; d <= 16; d += 1) days = mergeDay(days, `2026-06-${String(d).padStart(2, '0')}`, { 'a.com': { w: d, s: 0, n: 0 } });
  assert.equal(Object.keys(days).length, 14);
  assert.ok(!days['2026-06-02'] && days['2026-06-03']);
  days = mergeDay(days, '2026-06-16', { 'a.com': { w: 4, s: 1, n: 0 }, 'b.com': { w: 0, s: 9, n: 0 } });
  assert.deepEqual([days['2026-06-16'].w, days['2026-06-16'].s], [20, 10]);
  const sum = summarize({ x: { w: 1, s: 0, n: 0 }, y: { w: 0, s: 5, n: 1 }, z: { w: 2, s: 0, n: 0 } }, 2);
  assert.deepEqual(sum.rows.map((r) => r.key), ['y', 'z']);
  assert.deepEqual([sum.w, sum.s, sum.n], [3, 5, 1]);
  const now = new Date(2026, 5, 16, 12).getTime();
  const view = todayView(days, { day: localDay(now), dayApps: { 'a.com': { w: 100, s: 0, n: 0 } } }, now);
  assert.equal(view.rows.find((r) => r.key === 'a.com').w, 120);
  assert.equal(todayView(days, { day: '2026-06-15', dayApps: { 'a.com': { w: 100, s: 0, n: 0 } } }, now).w, 16 + 4);
});
