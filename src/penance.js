// The writing punishment. Runs in an extension frame laid over the distracting page, so the page (YouTube and the
// like) never sees these keystrokes and cannot eat them as player shortcuts. Write the line N times by hand: no paste,
// no drop, no Esc. When it is done the service worker lifts the lockout, burns the tab and returns you to your post.
// Any site can load this frame, so nothing is taken from its address: the line and the count come from the service
// worker, and only when this tab really owes a penance.
const $ = (id) => document.getElementById(id);
const input = $('input');
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let line = '';
let times = 0;
let written = 0;
const show = () => { $('count').textContent = `Written ${written} of ${times}.`; };

input.disabled = true;
for (const ev of ['paste', 'drop', 'beforeinput']) {
  input.addEventListener(ev, (e) => {
    if (ev === 'beforeinput' && !/^insert(FromPaste|FromDrop|FromYank|ReplacementText)$/.test(e.inputType || '')) return;
    e.preventDefault();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); return; }
  if (e.key !== 'Enter' || document.activeElement !== input || !times) return;
  e.preventDefault();
  if (norm(input.value) !== norm(line)) { // a wrong line does not count, and is wiped: write it again
    input.value = '';
    input.classList.remove('bad'); void input.offsetWidth; input.classList.add('bad');
    return;
  }
  written += 1;
  input.value = '';
  show();
  if (written >= times) {
    input.disabled = true;
    $('count').textContent = 'Penance accepted. Back to your post.';
    $('count').classList.add('done');
    chrome.runtime.sendMessage({ type: 'penanceDone' }).catch(() => {});
  }
});
// keep the cursor in the field: a click anywhere on the frame lands in it
document.addEventListener('mousedown', (e) => { if (e.target !== input && !input.disabled) { e.preventDefault(); input.focus(); } });
window.addEventListener('focus', () => { if (!input.disabled) input.focus(); });

chrome.runtime.sendMessage({ type: 'penanceConfig' }).then((cfg) => {
  if (!cfg?.ok || !cfg.owed) { // not owed (a site loaded this frame, or the session ended): nothing to write
    $('why').textContent = 'No penance is owed here.';
    $('hint').textContent = '';
    input.hidden = true;
    return;
  }
  line = String(cfg.line || 'I will not desert my studies.').slice(0, 80);
  times = Math.max(1, Math.min(10, Number(cfg.times) || 3));
  if (cfg.why) $('why').textContent = String(cfg.why).slice(0, 160);
  $('line').textContent = line;
  input.setAttribute('aria-label', `Type: ${line}`);
  input.disabled = false;
  show();
  input.focus();
}, () => { $('why').textContent = 'The Commissar could not be reached. Reload the page.'; });
