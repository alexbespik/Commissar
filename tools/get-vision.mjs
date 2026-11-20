#!/usr/bin/env node
// Fetches the on-device vision files for the camera watch into vendor/mediapipe/ (about 31 MB, kept out of git):
//   - Google MediaPipe Tasks Vision 1.2.3 from the npm registry (Apache-2.0): vision_bundle.mjs and its wasm loader
//   - the EfficientDet-Lite0 and -Lite2 object detectors (int8, COCO labels incl. "person" and "cell phone"), the face
//     landmarker (head and eye direction) from Google's model storage (Apache-2.0)
// Every download is checked against a pinned SHA-256: anything else is refused and nothing is written.
// Usage: node tools/get-vision.mjs   (or: npm run vision)
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor', 'mediapipe');
const TGZ = {
  url: 'https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.2.3.tgz',
  sha256: '469602650dab70256df387983ea44e85fa66020335bae85a54fa8fda062ca0a0',
};
// files taken out of the package, and where they go
const FROM_TGZ = {
  'package/vision_bundle.mjs': { to: 'vision_bundle.mjs', sha256: 'fb0c02c296f44ce0cc324ba16bd646d8773eb4a7847db4019cc4d0430db7a9b5' },
  'package/wasm/vision_wasm_internal.js': { to: 'wasm/vision_wasm_internal.js', sha256: '2aa5fd3fdd3d8208cd7587df0bb19fb6925c4ea16a76dd025aedc1f64d6a6309' },
  'package/wasm/vision_wasm_internal.wasm': { to: 'wasm/vision_wasm_internal.wasm', sha256: '225bc06c0f51a9cf31fea0e9e0b0243e9e01fb5ef332cc1a7fa6656dbdfdaabf' },
};
const MODELS = [{
  name: 'EfficientDet-Lite0 object detector',
  url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
  to: 'efficientdet_lite0.tflite',
  sha256: '0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb',
}, {
  // the bigger, sharper detector (448 px instead of 320): catches phones that are small, tilted or half in view
  name: 'EfficientDet-Lite2 object detector',
  url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite',
  to: 'efficientdet_lite2.tflite',
  sha256: 'b3f50554cb0ea559e90328845f7d9ba4d13c8bff372914d24e06bc8bb72fa896',
}, {
  // which way your head and eyes point: facing the screen, down at paper, or away
  name: 'Face landmarker',
  url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  to: 'face_landmarker.task',
  sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
}];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const have = (to, hash) => existsSync(join(OUT, to)) && sha(readFileSync(join(OUT, to))) === hash;

async function download(url, hash) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha(buf);
  if (got !== hash) throw new Error(`${url}: checksum mismatch (got ${got}); refusing it`);
  return buf;
}

/** The files of a .tar buffer: {name: Buffer} (plain ustar, as npm writes it). */
function untar(buf) {
  const files = {};
  for (let off = 0; off + 512 <= buf.length;) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const prefix = buf.toString('utf8', off + 345, off + 500).replace(/\0.*$/s, '');
    const size = parseInt(buf.toString('utf8', off + 124, off + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    const type = buf.toString('utf8', off + 156, off + 157);
    const full = prefix ? `${prefix}/${name}` : name;
    if (type === '0' || type === '\0' || type === '') files[full] = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const write = (to, buf) => { mkdirSync(dirname(join(OUT, to)), { recursive: true }); writeFileSync(join(OUT, to), buf); };

const needPkg = Object.values(FROM_TGZ).some((f) => !have(f.to, f.sha256));
if (needPkg) {
  console.log('· MediaPipe Tasks Vision 1.2.3 from npm…');
  const files = untar(gunzipSync(await download(TGZ.url, TGZ.sha256)));
  for (const [from, f] of Object.entries(FROM_TGZ)) {
    const buf = files[from];
    if (!buf) throw new Error(`${from} is not in the package`);
    if (sha(buf) !== f.sha256) throw new Error(`${from}: checksum mismatch; refusing it`);
    write(f.to, buf);
  }
}
for (const m of MODELS) {
  if (have(m.to, m.sha256)) continue;
  console.log(`· ${m.name}…`);
  write(m.to, await download(m.url, m.sha256));
}
write('NOTICE.txt', Buffer.from([
  'MediaPipe Tasks Vision 1.2.3 (vision_bundle.mjs, wasm/), the EfficientDet-Lite0 object detector',
  '(efficientdet_lite0.tflite) and the face landmarker (face_landmarker.task), Copyright Google LLC, licensed under',
  'the Apache License 2.0:',
  'https://www.apache.org/licenses/LICENSE-2.0',
  'Fetched by tools/get-vision.mjs; checksums pinned there. Runs on your computer only.',
  '',
].join('\n')));
console.log(`ok: vision files in ${OUT}`);
