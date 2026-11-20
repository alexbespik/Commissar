#!/usr/bin/env node
// Records a persona's lines once with ElevenLabs into a voice pack folder (Node 18+, no dependencies).
// Port of SciEdu-Studio scripts/make_commissar_voice.py. The extension only ever plays the files; it never calls
// ElevenLabs. Each clip's name carries a hash of voice + model + text, so a rerun only pays for new or changed lines.
//
//   node tools/gen-voice.mjs commissar --dry-run            # count characters, call nothing
//   ELEVENLABS_API_KEY=... node tools/gen-voice.mjs commissar --only distracted --limit 1   # one test clip
//   ELEVENLABS_API_KEY=... node tools/gen-voice.mjs commissar # record every missing clip (capped by --max-chars)
//   ELEVENLABS_API_KEY=... node tools/gen-voice.mjs commissar --replace   # ...and play only these lines from now on
//
// Or record locally and for free with the VoiceStudio app (OmniVoice), which must be open (http://127.0.0.1:3900):
//   node tools/gen-voice.mjs commissar --engine voicestudio --as commissar-local --only start --limit 1
//   node tools/gen-voice.mjs commissar --engine voicestudio --as commissar-local --instruct "male, elderly, low pitch"
// --voice takes a VoiceStudio voice profile id (a cloned or designed voice; list them with --list-voices). Without
// one, --instruct designs the voice and a fixed --seed keeps every line sounding like the same man.
//
// Lines come from tools/lines/<pack>.json: {"name", "voice", "model", "events": {event: [text, ...]}}.
// Writes <pack>/<event>-<hash>.mp3, merges them into <pack>/manifest.json (existing entries are kept), puts each
// clip's text into captions/<pack>.json (shown on screen) and adds the pack to packs.json.
// The key is read from the ELEVENLABS_API_KEY environment variable only: never put it in a file in this folder,
// because the whole folder is the extension.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, rename, mkdir, lstat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_VOICE = 'onwK4e9ZLuTAKqWW03F9'; // ElevenLabs stock voice "Daniel" (not a clone of anyone)
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const FORMAT = 'mp3_44100_128';
const SETTINGS = { stability: 0.6, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true }; // stern and steady
const VS_URL = (process.env.VOICESTUDIO_URL || 'http://127.0.0.1:3900').replace(/\/+$/, '');
const VS_INSTRUCT = 'male, middle-aged, low pitch, russian accent';
const VS_SEED = 1917;

function args(argv) {
  const a = { pack: '', dryRun: false, only: '', limit: 0, maxChars: 4000, voice: '', replace: false,
    engine: 'elevenlabs', as: '', instruct: '', seed: undefined, speed: undefined, listVoices: false, pause: 2 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--replace') a.replace = true;
    else if (k === '--only') a.only = argv[++i] || '';
    else if (k === '--limit') a.limit = Number(argv[++i]) || 0;
    else if (k === '--max-chars') a.maxChars = Number(argv[++i]) || 0;
    else if (k === '--voice') a.voice = argv[++i] || '';
    else if (k === '--engine') a.engine = argv[++i] || '';
    else if (k === '--as') a.as = argv[++i] || '';
    else if (k === '--instruct') a.instruct = argv[++i] || '';
    else if (k === '--seed') a.seed = Number(argv[++i]);
    else if (k === '--speed') a.speed = Number(argv[++i]);
    else if (k === '--list-voices') a.listVoices = true;
    else if (k === '--pause') a.pause = Number(argv[++i]);
    else if (!k.startsWith('-') && !a.pack) a.pack = k;
    else throw new Error(`unknown argument ${k}`);
  }
  if (!['elevenlabs', 'voicestudio'].includes(a.engine)) throw new Error('--engine is elevenlabs or voicestudio');
  if (a.as && !/^[a-z0-9][a-z0-9_-]{0,40}$/.test(a.as)) throw new Error('--as needs a pack name like commissar-local');
  if (a.seed !== undefined && !Number.isInteger(a.seed)) throw new Error('--seed needs a whole number');
  if (!(a.pause >= 0 && a.pause <= 600)) throw new Error('--pause needs seconds from 0 to 600');
  if (a.speed !== undefined && !(a.speed >= 0.25 && a.speed <= 4)) throw new Error('--speed needs a number from 0.25 to 4');
  if (a.listVoices) { a.engine = 'voicestudio'; if (!a.pack) a.pack = 'x'; }
  if (a.replace && (a.only || a.limit)) throw new Error('--replace needs the whole set: drop --only / --limit');
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(a.pack)) throw new Error('usage: node tools/gen-voice.mjs <pack> [--dry-run] [--only event] [--limit n] [--max-chars n] [--voice id] [--replace] [--engine elevenlabs|voicestudio] [--as pack] [--instruct text] [--seed n] [--speed x] [--list-voices] [--pause s]');
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

// ElevenLabs: one clip per call, billed per character. Returns the mp3 bytes or throws with the reason.
async function elevenlabs(text, voice, model, key) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: SETTINGS }),
  });
  const body = Buffer.from(await res.arrayBuffer());
  if (res.ok && body.length) return body;
  let detail = '';
  try { detail = JSON.parse(body.toString('utf8'))?.detail?.message || ''; } catch { /* not JSON */ }
  throw new Error(`HTTP ${res.status} ${detail}`);
}

// VoiceStudio's OpenAI-compatible endpoint on this Mac. The first call can take minutes while the model loads.
async function voicestudio(text, vs) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${VS_URL}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ model: vs.model, input: text, voice: vs.voice || 'default', response_format: 'mp3',
        speed: vs.speed, seed: vs.seed, ...(vs.voice ? {} : { instruct: vs.instruct }) }),
      signal: AbortSignal.timeout(25 * 60 * 1000),
    });
    const body = Buffer.from(await res.arrayBuffer());
    if (res.ok && body.length) return body;
    if ((res.status === 429 || res.status === 503) && res.headers.get('x-omnivoice-retryable') && attempt < 5) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 30) * 1000));
      continue;
    }
    let detail = '';
    try { detail = String(JSON.parse(body.toString('utf8'))?.detail || ''); } catch { /* not JSON */ }
    throw new Error(`HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
}

// ffmpeg from the PATH (Homebrew), arguments passed without a shell
const ffmpeg = (argv) => new Promise((ok, fail) => execFile('ffmpeg', argv, { timeout: 120000 }, (e, _o, err) => (e ? fail(new Error(err || e.message)) : ok())));

async function listVoices() {
  let data;
  try { data = await (await fetch(`${VS_URL}/v1/audio/voices`, { signal: AbortSignal.timeout(10000) })).json(); }
  catch { console.log(`VoiceStudio is not answering at ${VS_URL}: open the app first.`); return 1; }
  for (const v of data.voices || []) if (v.type === 'profile') console.log(`  ${v.voice_id}  ${v.name}${v.language ? ` (${v.language})` : ''}`);
  console.log(`Engines ready: ${(data.engines || []).filter((e) => e.available).map((e) => e.id).join(', ') || 'none'}`);
  return 0;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a.listVoices) return listVoices();
  const lines = await readJson(join(ROOT, 'tools', 'lines', `${a.pack}.json`), null);
  if (!lines?.events) throw new Error(`no tools/lines/${a.pack}.json with "events"`);
  const local = a.engine === 'voicestudio';
  const vs = local && { model: lines.voicestudio?.model || 'omnivoice', voice: a.voice || lines.voicestudio?.voice || '',
    instruct: a.instruct || lines.voicestudio?.instruct || VS_INSTRUCT, seed: a.seed ?? lines.voicestudio?.seed ?? VS_SEED,
    speed: a.speed ?? lines.voicestudio?.speed ?? 1, filter: String(lines.voicestudio?.ffmpeg || '') };
  // the clip name hashes everything that changes the sound, so another voice, instruct or seed records anew
  const voice = local ? `vs:${vs.voice || vs.instruct}|${vs.seed}|${vs.speed}${vs.filter ? `|fx:${vs.filter}` : ''}` : a.voice || lines.voice || DEFAULT_VOICE;
  const model = local ? `voicestudio-${vs.model}` : lines.model || DEFAULT_MODEL;
  const packId = a.as || a.pack;
  const out = join(ROOT, packId);

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
  console.log(`${batch.length} clips to record into ${packId}/, ${chars} characters (cap ${local ? 'none, local' : a.maxChars}); voice ${voice}, model ${model}`);
  if (!local && chars > a.maxChars) { console.log('Over the cap: nothing sent. Raise --max-chars or use --only / --limit.'); return 1; }
  if (a.dryRun) return 0;

  let made = 0, spent = 0, failed = false;
  if (batch.length) {
    const key = local ? 'local' : (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || '').trim();
    if (!key) { console.log('Set ELEVENLABS_API_KEY in the environment (not in a file inside this folder).'); return 1; }
    await mkdir(out, { recursive: true });
    for (const [i, t] of batch.entries()) {
      // one request at a time; with VoiceStudio also a breather between them so this Mac stays usable
      if (local && i && a.pause) await new Promise((r) => setTimeout(r, a.pause * 1000));
      let body;
      try {
        body = local ? await voicestudio(t.text, vs) : await elevenlabs(t.text, voice, model, key);
      } catch (e) {
        const why = e.message.startsWith('HTTP') ? e.message : `request failed (${e.name})`;
        console.log(`  ${t.name}: ${why}; stopping${local && !e.message.startsWith('HTTP') ? ` (is VoiceStudio open at ${VS_URL}?)` : ''}`);
        failed = true;
        break;
      }
      const tmp = join(out, `.${t.name}.tmp`);
      await unlink(tmp).catch(() => {});
      await writeFile(tmp, body);
      if (local && vs.filter) {
        // the pack's own effect chain (lines file "voicestudio.ffmpeg"), applied to every clip the same way
        const fx = join(out, `.${t.name}.fx.mp3`);
        try { await ffmpeg(['-v', 'error', '-y', '-i', tmp, '-af', vs.filter, '-b:a', '128k', fx]); await rename(fx, tmp); }
        catch (e) { await unlink(tmp).catch(() => {}); await unlink(fx).catch(() => {}); console.log(`  ${t.name}: ffmpeg failed (${e.message.split('\n')[0]}); stopping`); failed = true; break; }
      }
      await rename(tmp, join(out, t.name));
      made += 1;
      spent += t.text.length;
      console.log(`  ${t.name}  (${t.text.length} chars)`);
    }
  }

  // manifest: keep what is there, add every wanted clip that now exists
  const manifestPath = join(out, 'manifest.json');
  const packName = a.as ? `${lines.name || a.pack} (${local ? 'VoiceStudio' : a.as})` : lines.name || a.pack;
  const manifest = await readJson(manifestPath, { name: packName, events: {} });
  // --replace: the pack plays only the lines in the lines file (older clips stay on disk, unlisted). Only after a
  // complete run: a partial one would leave events without any clip.
  const complete = !failed && batch.length === todo.length;
  const replacing = a.replace && complete;
  if (a.replace && !complete) console.log('Not every line was recorded: kept the old lines too (run --replace again to finish).');
  if (replacing) {
    // the packs are not in git: keep the old list and captions next to them, once, so the old voice can be restored
    const backup = join(out, 'manifest.before-replace.json');
    if (!(await isFile(backup)) && (await isFile(manifestPath))) await writeFile(backup, await readFile(manifestPath));
    const capsPath = join(ROOT, 'captions', `${packId}.json`);
    const capsBackup = join(ROOT, 'captions', `${packId}.before-replace.json`);
    if (!(await isFile(capsBackup)) && (await isFile(capsPath))) await writeFile(capsBackup, await readFile(capsPath));
    manifest.events = {};
    manifest.name = packName || manifest.name;
  }
  manifest.events ||= {};
  const captionsPath = join(ROOT, 'captions', `${packId}.json`);
  const captions = replacing ? {} : await readJson(captionsPath, {});
  let added = 0;
  for (const [event, clips] of Object.entries(want)) {
    for (const { name, text } of clips) {
      if (!(await isFile(join(out, name)))) continue;
      captions[name] = text;
      const list = (manifest.events[event] ||= []);
      if (!list.includes(name)) { list.push(name); added += 1; }
    }
  }
  if (added || made || replacing) {
    await writeJson(manifestPath, manifest);
    await mkdir(join(ROOT, 'captions'), { recursive: true });
    await writeJson(captionsPath, captions);
    const packs = await readJson(join(ROOT, 'packs.json'), []);
    if (!packs.includes(packId)) { packs.push(packId); await writeJson(join(ROOT, 'packs.json'), packs); }
  }
  console.log(`Recorded ${made} clips, ${spent} characters ${local ? 'spoken locally' : 'sent'}; ${added} new manifest entries. Reload the extension to hear them.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(2); });
}
