#!/usr/bin/env node
// Records a persona's lines once with ElevenLabs into a voice pack folder (Node 18+, no dependencies).
// Port of SciEdu-Studio scripts/make_commissar_voice.py. The extension only ever plays the files; it never calls
// ElevenLabs. Each clip's name carries a hash of voice + model + text, so a rerun only pays for new or changed lines.
//
//   node tools/gen-voice.mjs commissar --dry-run            # count characters, call nothing
//   ELEVENLABS_API_KEY=... node tools/gen-voice.mjs commissar --only distracted --limit 1   # one test clip
//   ELEVENLABS_API_KEY=... node tools/gen-voice.mjs commissar # record every missing clip (capped by --max-chars)
//
// Lines come from tools/lines/<pack>.json: {"name", "voice", "model", "events": {event: [text, ...]}}.
// Writes <pack>/<event>-<hash>.mp3, merges them into <pack>/manifest.json (existing entries are kept), puts each
// clip's text into captions/<pack>.json (shown on screen) and adds the pack to packs.json.
// The key is read from the ELEVENLABS_API_KEY environment variable only: never put it in a file in this folder,
// because the whole folder is the extension.
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, lstat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_VOICE = 'onwK4e9ZLuTAKqWW03F9'; // ElevenLabs stock voice "Daniel" (not a clone of anyone)
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const FORMAT = 'mp3_44100_128';
const SETTINGS = { stability: 0.6, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true }; // stern and steady

function args(argv) {
  const a = { pack: '', dryRun: false, only: '', limit: 0, maxChars: 3000, voice: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--only') a.only = argv[++i] || '';
    else if (k === '--limit') a.limit = Number(argv[++i]) || 0;
    else if (k === '--max-chars') a.maxChars = Number(argv[++i]) || 0;
    else if (k === '--voice') a.voice = argv[++i] || '';
    else if (!k.startsWith('-') && !a.pack) a.pack = k;
    else throw new Error(`unknown argument ${k}`);
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(a.pack)) throw new Error('usage: node tools/gen-voice.mjs <pack> [--dry-run] [--only event] [--limit n] [--max-chars n] [--voice id]');
  return a;
}

export function clipName(event, text, voice, model) {
  const h = createHash('sha256').update(`${voice}|${model}|${text}`).digest('hex').slice(0, 12);
  return `${event}-${h}.mp3`;
}

const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };
async function writeJson(p, data) {
  const tmp = `${p}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, p); // also replaces a planted symlink instead of writing through it
}
async function isFile(p) { try { const s = await lstat(p); return s.isFile(); } catch { return false; } }

async function main() {
  const a = args(process.argv.slice(2));
  const lines = await readJson(join(ROOT, 'tools', 'lines', `${a.pack}.json`), null);
  if (!lines?.events) throw new Error(`no tools/lines/${a.pack}.json with "events"`);
  const voice = a.voice || lines.voice || DEFAULT_VOICE;
  const model = lines.model || DEFAULT_MODEL;
  const out = join(ROOT, a.pack);

  const want = {};
  const todo = [];
  for (const [event, texts] of Object.entries(lines.events)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(event) || !Array.isArray(texts)) continue;
    for (const text of texts) {
      if (typeof text !== 'string' || !text.trim()) continue;
      const name = clipName(event, text, voice, model);
      (want[event] ||= []).push({ name, text });
      if ((a.only && event !== a.only) || (await isFile(join(out, name)))) continue;
      todo.push({ event, text, name });
    }
  }
  const batch = a.limit ? todo.slice(0, a.limit) : todo;
  const chars = batch.reduce((n, t) => n + t.text.length, 0);
  console.log(`${batch.length} clips to record, ${chars} characters (cap ${a.maxChars}); voice ${voice}, model ${model}`);
  if (chars > a.maxChars) { console.log('Over the cap: nothing sent. Raise --max-chars or use --only / --limit.'); return 1; }
  if (a.dryRun) return 0;

  let made = 0, spent = 0, failed = false;
  if (batch.length) {
    const key = (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || '').trim();
    if (!key) { console.log('Set ELEVENLABS_API_KEY in the environment (not in a file inside this folder).'); return 1; }
    await mkdir(out, { recursive: true });
    for (const t of batch) {
      let res;
      try {
        res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${FORMAT}`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({ text: t.text, model_id: model, voice_settings: SETTINGS }),
        });
      } catch (e) { console.log(`  ${t.name}: request failed (${e.name}); stopping`); failed = true; break; }
      const body = Buffer.from(await res.arrayBuffer());
      if (!res.ok || !body.length) {
        let detail = '';
        try { detail = JSON.parse(body.toString('utf8'))?.detail?.message || ''; } catch { /* not JSON */ }
        console.log(`  ${t.name}: HTTP ${res.status} ${detail}; stopping`);
        failed = true;
        break;
      }
      const tmp = join(out, `.${t.name}.tmp`);
      await unlink(tmp).catch(() => {});
      await writeFile(tmp, body);
      await rename(tmp, join(out, t.name));
      made += 1;
      spent += t.text.length;
      console.log(`  ${t.name}  (${t.text.length} chars)`);
    }
  }

  // manifest: keep what is there, add every wanted clip that now exists
  const manifestPath = join(out, 'manifest.json');
  const manifest = await readJson(manifestPath, { name: lines.name || a.pack, events: {} });
  manifest.events ||= {};
  const captionsPath = join(ROOT, 'captions', `${a.pack}.json`);
  const captions = await readJson(captionsPath, {});
  let added = 0;
  for (const [event, clips] of Object.entries(want)) {
    for (const { name, text } of clips) {
      if (!(await isFile(join(out, name)))) continue;
      captions[name] = text;
      const list = (manifest.events[event] ||= []);
      if (!list.includes(name)) { list.push(name); added += 1; }
    }
  }
  if (added || made) {
    await writeJson(manifestPath, manifest);
    await mkdir(join(ROOT, 'captions'), { recursive: true });
    await writeJson(captionsPath, captions);
    const packs = await readJson(join(ROOT, 'packs.json'), []);
    if (!packs.includes(a.pack)) { packs.push(a.pack); await writeJson(join(ROOT, 'packs.json'), packs); }
  }
  console.log(`Recorded ${made} clips, ${spent} characters sent; ${added} new manifest entries. Reload the extension to hear them.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(2); });
}
