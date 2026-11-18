import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/answers.js';
import { buildRequest, parseResponse } from '../src/gemini.js';
import { classifyToken, cssCandidates } from '../src/teach.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const A = globalThis.CommissarAnswers;
const q = (score, max, subs, c = 0, i = 0, p = 0) => ({ score, max, subs, c, i, p });
const snap = (questions, marks = { c: 0, i: 0, p: 0 }) => ({ questions, marks });

test('frac and grid labels', () => {
  assert.deepEqual(A.frac('– / 1'), [null, 1]);
  assert.deepEqual(A.frac('0/5'), [0, 5]);
  assert.deepEqual(A.frac('[1 / 1 Points]'), [1, 1]);
  assert.deepEqual(A.frac('0.5/1'), [0.5, 1]);
  assert.deepEqual(A.frac('nothing'), [null, null]);
  assert.deepEqual(A.parseGridLabel('Question 9 out of 16, your score is none out of 1'), { n: 9, score: null, max: 1 });
  assert.deepEqual(A.parseGridLabel('Question 3 out of 13, your score is 1 out of 1'), { n: 3, score: 1, max: 1 });
});

test('diff: right, wrong, partial, and the first visit says nothing', () => {
  const before = snap({ a: q(null, 1, 0), b: q(null, 1, 0) });
  assert.deepEqual(A.diff(null, before).results, []);
  assert.equal(A.triggerFor(A.diff(before, snap({ a: q(1, 1, 1, 2), b: q(null, 1, 0) }))), 'quizPass');
  assert.equal(A.triggerFor(A.diff(before, snap({ a: q(0, 1, 1, 0, 1), b: q(null, 1, 0) }))), 'quizFail');
  assert.equal(A.triggerFor(A.diff(before, snap({ a: q(0.5, 1, 1, 1, 1), b: q(null, 1, 0) }))), 'quizPartial');
  // one right and one wrong in the same batch: the miss is what gets said
  assert.equal(A.triggerFor(A.diff(before, snap({ a: q(1, 1, 1), b: q(0, 1, 1) }))), 'quizFail');
  // nothing changed
  assert.equal(A.triggerFor(A.diff(before, before)), '');
  // a wrong answer resubmitted and still wrong: the submission count moves, the score does not
  const wrong = snap({ a: q(0, 1, 1, 0, 1) });
  assert.equal(A.triggerFor(A.diff(wrong, snap({ a: q(0, 1, 2, 0, 1) }))), 'quizFail');
});

test('diff: a question in parts is judged by the part just submitted', () => {
  const part = (score, max, subs) => ({ score, max, subs });
  const qp = (parts, c = 0, i = 0) => ({ score: null, max: 1, subs: parts.reduce((a, x) => a + x.subs, 0), c, i, p: 0, parts });
  const start = snap({ q12: qp([part(null, 0.2, 0), part(null, 0.2, 0), part(null, 0.2, 0)]) });
  const aRight = snap({ q12: qp([part(0.2, 0.2, 1), part(null, 0.2, 0), part(null, 0.2, 0)], 1) });
  assert.equal(A.triggerFor(A.diff(start, aRight)), 'quizPass'); // one right part of three is "right", not partial
  const bWrong = snap({ q12: qp([part(0.2, 0.2, 1), part(0, 0.2, 1), part(null, 0.2, 0)], 1) });
  assert.equal(A.triggerFor(A.diff(aRight, bWrong)), 'quizFail');
  const onlyMark = snap({ q12: qp([part(0.2, 0.2, 1), part(0, 0.2, 1), part(null, 0.2, 0)], 2) });
  assert.equal(A.triggerFor(A.diff(bWrong, onlyMark)), 'quizPass'); // scores not updated yet: the new mark decides
  assert.equal(A.triggerFor(A.diff(onlyMark, onlyMark)), '');
});

test('diff: the whole assignment correct says allDone once', () => {
  const almost = snap({ a: q(1, 1, 1), b: q(0, 1, 1) });
  const done = snap({ a: q(1, 1, 1), b: q(1, 1, 2) });
  assert.equal(A.triggerFor(A.diff(almost, done)), 'allDone');
  assert.equal(A.triggerFor(A.diff(done, done)), '');
});

test('diff: pages without question boxes go by mark counts', () => {
  const none = snap({}, { c: 0, i: 0, p: 0 });
  assert.equal(A.triggerFor(A.diff(none, snap({}, { c: 1, i: 0, p: 0 }))), 'quizPass');
  assert.equal(A.triggerFor(A.diff(none, snap({}, { c: 0, i: 1, p: 0 }))), 'quizFail');
  assert.equal(A.triggerFor(A.diff(none, snap({}, { c: 2, i: 1, p: 0 }))), 'quizPartial');
});

test('ruleFor: built-in, saved page, user rule, auto mode', () => {
  assert.equal(A.ruleFor({ hostname: 'www.webassign.net', protocol: 'https:' }).id, 'webassign');
  assert.equal(A.ruleFor({ hostname: '', protocol: 'file:', pathname: '/Users/x/4.9%20Homework%20_%20WebAssign.html' }).id, 'webassign');
  assert.equal(A.ruleFor({ hostname: 'quiz.example.com', protocol: 'https:' }, [{ id: 'user-example.com', hosts: ['example.com'] }]).id, 'user-example.com');
  assert.equal(A.ruleFor({ hostname: 'other.com', protocol: 'https:' }), null);
  assert.equal(A.ruleFor({ hostname: 'other.com', protocol: 'https:' }, [], true).id, 'generic');
});

test('pageSense only ever says study', () => {
  assert.equal(A.pageSense('Chapter 4 Theorem 2 Proof. Example: the integral of x. Exercise 3. Solution.', 'Notes', [], { math: true }).verdict, 'study');
  assert.equal(A.pageSense('Trending now. Subscribe. Shorts. Add to cart.', 'Home', []).verdict, '');
  assert.equal(A.pageSense('Antiderivatives practice', 'x', ['antiderivatives'], { answerForm: true, quizRule: true }).verdict, 'study');
});

test('gemini request carries no query string and parses answers', () => {
  const body = buildRequest({ subject: 'calc', title: 'T', url: 'https://ex.com/a/b?token=SECRET#x' });
  const text = body.contents[0].parts[0].text;
  assert.ok(text.includes('ex.com/a/b'));
  assert.ok(!text.includes('SECRET'));
  assert.equal(parseResponse({ candidates: [{ content: { parts: [{ text: '{"study": true}' }] } }] }), true);
  assert.equal(parseResponse({ candidates: [{ content: { parts: [{ text: '```json\n{"study":false}\n```' }] } }] }), false);
  assert.equal(parseResponse({}), null);
});

test('teach: token names and the saved WebAssign stylesheets', () => {
  assert.equal(classifyToken('mCorrect'), 'correct');
  assert.equal(classifyToken('incorrectBord'), 'incorrect');
  assert.equal(classifyToken('mPartial'), 'partial');
  assert.equal(classifyToken('correctHint'), '');
  assert.equal(classifyToken('text-right'), '');
  assert.equal(classifyToken('partialDerivativeButton'), '');
  const dir = readdirSync('.').find((d) => /WebAssign_files$/.test(d));
  if (!dir) return; // the saved demo page is optional
  const css = readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  const found = cssCandidates(css).map((c) => `${c.kind} ${c.selector}`);
  for (const want of ['correct .waMark.mCorrect', 'incorrect .waMark.mIncorrect', 'partial .waMark.mPartial']) assert.ok(found.includes(want), want);
  assert.ok(!found.some((f) => /right/.test(f)));
});
