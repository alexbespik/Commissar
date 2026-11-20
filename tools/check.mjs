#!/usr/bin/env node
// Static checks the browser would otherwise only show at load time: manifest JSON and the files it names,
// every pack in packs.json (manifest parses, sanitizes, every listed clip exists), captions, and JS syntax.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizePack } from '../src/core.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const named = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page,
  ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap((c) => c.js), 'src/offscreen.html'];
for (const f of named) ok(existsSync(join(ROOT, f)), `manifest names a missing file: ${f}`);

const packs = JSON.parse(readFileSync(join(ROOT, 'packs.json'), 'utf8'));
let clips = 0;
for (const id of packs) {
  const mp = join(ROOT, id, 'manifest.json');
  if (!existsSync(mp)) { console.log(`· pack ${id}: not on this computer (only the Commissar pack is in the repo; see README)`); continue; }
  const raw = JSON.parse(readFileSync(mp, 'utf8'));
  const capPath = join(ROOT, 'captions', `${id}.json`);
  const caps = existsSync(capPath) ? JSON.parse(readFileSync(capPath, 'utf8')) : {};
  const pack = sanitizePack(id, raw, caps);
  ok(pack, `pack ${id}: no usable events`);
  if (!pack) continue;
  const rawCount = Object.values(raw.events).flat().length;
  const kept = Object.values(pack.events).flat();
  ok(kept.length === rawCount, `pack ${id}: ${rawCount - kept.length} clip names rejected by the sanitizer`);
  for (const f of kept) { clips += 1; ok(existsSync(join(ROOT, id, f)), `pack ${id}: missing clip ${f}`); }
  for (const f of Object.keys(caps)) ok(kept.includes(f), `captions/${id}.json: ${f} is not in the pack`);
}

for (const dir of ['src', 'tools', 'tests']) {
  for (const f of readdirSync(join(ROOT, dir)).filter((x) => /\.(m?js)$/.test(x))) {
    try { execFileSync(process.execPath, ['--check', join(ROOT, dir, f)], { stdio: 'pipe' }); } catch (e) { problems.push(`syntax: ${dir}/${f}: ${String(e.stderr).split('\n')[0]}`); }
  }
}

// nothing that would be committed may carry a login token (saved homework pages do: UserPass=, SSO ids)
try {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of files) {
    if (!/\.(html?|js|mjs|json|md|css|txt)$/i.test(f)) continue;
    const text = readFileSync(join(ROOT, f), 'utf8');
    if (/UserPass=|SSOGUID|wa-analytics-sessionId/.test(text) && !f.startsWith('tools/check.mjs')) problems.push(`${f} holds a login token: keep it out of git`);
  }
} catch { console.log('· git not available: skipped the token scan'); }

if (!existsSync(join(ROOT, 'vendor', 'mediapipe', 'efficientdet_lite0.tflite'))) console.log('· camera watch: vision files not fetched yet (npm run vision)');

if (problems.length) { console.log(problems.map((p) => `✗ ${p}`).join('\n')); process.exit(1); }
console.log(`ok: manifest files present, ${packs.length} packs, ${clips} clips, all scripts parse`);
