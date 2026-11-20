// Chat with the Commissar and take quick quizzes, through the user's own Gemini key (src/gemini.js, via the worker).
// Everything from Gemini is shown with textContent only.
import { BUST, COLORS } from './pixelart.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: String(e?.message || e) }));
let history = [];
let asked = [];
let subject = '';
let busy = false;

// the officer's face as the avatar
const fc = $('face').getContext('2d');
BUST.forEach((row, y) => [...row].forEach((k, x) => {
  if (k === '.') return;
  const c = COLORS[k];
  fc.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
  fc.fillRect(x, y, 1, 1);
}));

function add(cls, text) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  $('log').append(div);
  div.scrollIntoView({ block: 'end' });
  return div;
}

async function save() {
  await chrome.storage.local.set({ chatLog: history.slice(-40) });
}

async function status() {
  const st = await send({ type: 'chatStatus' });
  subject = st?.subject || '';
  $('topic').placeholder = subject ? `Quiz topic (empty: ${subject})` : 'Quiz topic (empty: a random one)';
  $('usage').textContent = st?.ok ? `${st.used} of ${st.cap} messages used today` : '';
  $('off').hidden = Boolean(st?.ok);
  if (!st?.ok) $('off').textContent = `Chat needs your own Gemini key. ${st?.reason || ''}`;
  for (const el of document.querySelectorAll('.bar button, .bar input')) el.disabled = !st?.ok;
  return st?.ok;
}

async function busyWhile(fn) {
  if (busy) return;
  busy = true;
  document.body.style.cursor = 'progress';
  try { await fn(); } finally { busy = false; document.body.style.cursor = ''; status(); }
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text) return;
  $('text').value = '';
  busyWhile(async () => {
    add('user', text);
    history.push({ role: 'user', text });
    const r = await send({ type: 'chat', history });
    if (!r?.ok) { add('err', r?.error || 'No answer.'); history.pop(); return; }
    add('model', r.text);
    history.push({ role: 'model', text: r.text });
    await save();
  });
});

function showQuiz(q) {
  const card = document.createElement('div');
  card.className = 'quiz';
  const head = document.createElement('div');
  head.className = 'muted small';
  head.textContent = `Quiz: ${q.topic}`;
  const question = document.createElement('div');
  question.className = 'q';
  question.textContent = q.question;
  card.append(head, question);
  const buttons = q.choices.map((c, i) => {
    const b = document.createElement('button');
    b.textContent = `${'ABCD'[i]}. ${c}`;
    b.addEventListener('click', () => {
      buttons.forEach((x, j) => { x.disabled = true; if (j === q.correct) x.classList.add('right'); });
      const right = i === q.correct;
      if (!right) b.classList.add('wrong');
      const exp = document.createElement('div');
      exp.className = 'exp';
      exp.textContent = `${right ? 'Correct.' : `Wrong. It was ${'ABCD'[q.correct]}.`} ${q.explanation}`;
      card.append(exp);
      exp.scrollIntoView({ block: 'end' });
      send({ type: 'quizAnswer', correct: right }); // the persona's voice reacts, and a running session counts it
    });
    card.append(b);
    return b;
  });
  $('log').append(card);
  card.scrollIntoView({ block: 'end' });
}

function quiz(topic) {
  busyWhile(async () => {
    const r = await send({ type: 'quiz', topic, avoid: asked });
    if (!r?.ok) { add('err', r?.error || 'No quiz.'); return; }
    asked.push(r.quiz.question);
    asked = asked.slice(-8);
    showQuiz(r.quiz);
  });
}
$('quizMe').addEventListener('click', () => quiz($('topic').value.trim() || subject));
$('randomQuiz').addEventListener('click', () => quiz(''));

(async () => {
  const { chatLog } = await chrome.storage.local.get('chatLog');
  history = Array.isArray(chatLog) ? chatLog.filter((m) => m && typeof m.text === 'string').slice(-40) : [];
  for (const m of history) add(m.role === 'model' ? 'model' : 'user', m.text);
  if (await status() && !history.length) add('model', 'Speak. A question about your material, or ask for a quiz. Make it count.');
  $('text').focus();
})();
