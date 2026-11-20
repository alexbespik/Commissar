const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: String(e) }));
let status = null;

const VERDICT_TEXT = {
  study: 'Counts as study', distraction: 'Counts as distraction', neutral: 'Not judged (browser page)',
  unknown: 'Not on any list: counts as distraction if you stay long (Settings)',
};

function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function render() {
  if (!status?.ok) return;
  const { session, settings, packs, page, host } = status;
  const on = Boolean(session?.active);
  $('idle').hidden = on;
  $('running').hidden = !on;
  const st = $('state');
  st.className = `pill ${on ? (session.status === 'distraction' ? 'distraction' : session.status === 'study' ? 'study' : 'on') : ''}`;
  st.textContent = on ? (session.status === 'neutral' ? 'on duty' : session.status) : 'off';

  const sel = $('persona');
  if (!sel.options.length) {
    for (const p of packs) sel.add(new Option(p.name, p.id));
    if (packs.length > 1) sel.add(new Option('Squad (everyone takes turns)', 'squad'));
    sel.value = settings.persona;
    if (!sel.value && packs[0]) sel.value = packs[0].id;
  }
  if (on) {
    $('subjectLine').textContent = session.subject ? `Studying: ${session.subject}` : 'Session running';
    $('focus').textContent = Math.round(session.focusMs / 60000);
    $('drift').textContent = Math.round(session.distractMs / 60000);
    $('strikes').textContent = session.strikes;
    const a = session.answers || {};
    $('answers').textContent = `${a.pass || 0}/${(a.fail || 0) + (a.partial || 0)}`;
    $('discLine').textContent = `Discipline: ${settings.discipline} · punishments ${session.punishments || 0} · away ${Math.round((session.awayMs || 0) / 60000)} min`;
    renderPass(session);
    $('returnNow').disabled = !session.studyTab;
    $('returnNow').title = session.studyTab ? session.studyTab.url : 'No study tab yet: open your material first';
  }
  $('pageBox').hidden = !host;
  $('host').textContent = host;
  $('pageVerdict').textContent = VERDICT_TEXT[page] || '';
}

function renderPass(session) {
  const left = (session?.passUntil || 0) - Date.now();
  $('pass').textContent = left > 0 ? `Outside resources: ${mmss(left)} left (+10)` : 'I need outside resources (10 min)';
  $('pass').disabled = left > 0 && left > 20 * 60_000; // already at the 30-minute limit
  $('passEnd').hidden = !(left > 0);
}

function tickClock() {
  const s = status?.session;
  if (s?.active) { $('clock').textContent = mmss(Date.now() - s.startedAt); renderPass(s); }
}

async function refresh() {
  status = await send({ type: 'status' });
  render();
  tickClock();
  $('permNote').hidden = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  const { lastReaction: r } = await chrome.storage.local.get('lastReaction');
  $('lastReaction').hidden = !r;
  if (r) $('lastReaction').textContent = `Last reaction: ${r.trigger} at ${new Date(r.at).toLocaleTimeString()} · ${r.persona ? `${r.persona}, ` : ''}${r.voice}`;
}

$('start').addEventListener('click', async () => {
  $('start').disabled = true;
  const persona = $('persona').value;
  await send({ type: 'setPersona', persona });
  await send({ type: 'start', subject: $('subject').value.trim() });
  $('start').disabled = false;
  refresh();
});
$('stop').addEventListener('click', async () => { $('stop').disabled = true; await send({ type: 'stop' }); $('stop').disabled = false; refresh(); });
$('markStudy').addEventListener('click', async () => { await send({ type: 'mark', verdict: 'study' }); refresh(); });
$('markDistraction').addEventListener('click', async () => { await send({ type: 'mark', verdict: 'distraction' }); refresh(); });
$('silence').addEventListener('click', () => send({ type: 'silence' }));
$('chat').addEventListener('click', async () => { await send({ type: 'openChat' }); window.close(); });
$('pass').addEventListener('click', async () => { await send({ type: 'outsidePass' }); refresh(); });
$('passEnd').addEventListener('click', async () => { await send({ type: 'outsidePass', end: true }); refresh(); });
$('returnNow').addEventListener('click', async () => { await send({ type: 'returnNow' }); window.close(); });
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('grant').addEventListener('click', async () => {
  const ok = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
  if (ok) await send({ type: 'settingsChanged' });
  refresh();
});

chrome.storage.local.get('lastSubject').then(({ lastSubject }) => { if (lastSubject) $('subject').value = lastSubject; });
$('subject').addEventListener('change', () => chrome.storage.local.set({ lastSubject: $('subject').value.trim().slice(0, 120) }));

refresh();
setInterval(tickClock, 1000);
setInterval(refresh, 5000);
