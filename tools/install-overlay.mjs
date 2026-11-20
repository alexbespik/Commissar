#!/usr/bin/env node
// Builds the Mac helper (native/CommissarOverlay.swift) and registers it with the browser for one extension id, so
// only that extension can start it (native messaging "allowed_origins").
//   node tools/install-overlay.mjs <extension-id>                 Brave
//   node tools/install-overlay.mjs <extension-id> --browser chrome
//   node tools/install-overlay.mjs --uninstall [--browser chrome]
// The extension id is shown in Settings → Mac helper (and at brave://extensions). Needs Apple's command line tools
// (xcode-select --install) for swiftc.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync, chmodSync, readdirSync } from 'node:fs';
import { homedir, tmpdir, platform } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'com.commissar.overlay';
const DIRS = {
  brave: join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts'),
  chrome: join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
  chromium: join(homedir(), 'Library/Application Support/Chromium/NativeMessagingHosts'),
};
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
const browser = (flag('--browser') || 'brave').toLowerCase();
const dir = DIRS[browser];
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

if (platform() !== 'darwin') fail('The helper is for macOS only.');
if (!dir) fail(`Unknown browser "${browser}": use brave, chrome or chromium.`);
// some Brave builds on macOS look for hosts in Chrome's or Chromium's folder instead of their own: register in all three
const targets = (browser === 'brave' ? [DIRS.brave, DIRS.chrome, DIRS.chromium] : [dir]).map((d) => join(d, `${HOST}.json`));
// the installed copy lives outside this folder, so later changes here (a git pull) never change what the browser runs
const INSTALLED = join(homedir(), 'Library/Application Support/CommissarOverlay/commissar-overlay');

if (args.includes('--uninstall')) {
  for (const m of targets) { rmSync(m, { force: true }); console.log(`ok: removed ${m}`); }
  if (!Object.values(DIRS).some((d) => existsSync(join(d, `${HOST}.json`)))) { // no browser uses it any more
    rmSync(dirname(INSTALLED), { recursive: true, force: true });
    console.log(`ok: removed ${dirname(INSTALLED)}`);
  }
  process.exit(0);
}

const id = args.find((a) => /^[a-p]{32}$/.test(a));
if (!id) fail('Give the extension id (32 letters a-p), shown in Settings → Mac helper or at brave://extensions.');

const out = join(ROOT, 'native', 'build', 'commissar-overlay');
mkdirSync(dirname(out), { recursive: true });
console.log('· building the helper with swiftc…');
const cache = join(tmpdir(), 'commissar-swift-cache');
try {
  execFileSync('swiftc', ['-O', '-module-cache-path', cache, join(ROOT, 'native', 'CommissarOverlay.swift'), '-o', out], {
    stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CLANG_MODULE_CACHE_PATH: join(cache, 'clang') },
  });
} catch {
  fail('swiftc failed. Install Apple\'s command line tools with: xcode-select --install');
}
if (!existsSync(out)) fail('swiftc did not produce the helper.');
mkdirSync(dirname(INSTALLED), { recursive: true });
copyFileSync(out, INSTALLED);
chmodSync(INSTALLED, 0o755);
// the bundled font for his panel (the helper draws it natively); the Latin files only: the Cyrillic subsets share
// their names and would shadow them. The licence goes with it.
const fontsOut = join(dirname(INSTALLED), 'fonts');
rmSync(fontsOut, { recursive: true, force: true });
mkdirSync(fontsOut, { recursive: true });
const fontsIn = join(ROOT, 'src', 'fonts');
for (const f of readdirSync(fontsIn)) if (/^jetbrains-mono-latin-.*\.woff2$/.test(f) || f === 'OFL.txt') copyFileSync(join(fontsIn, f), join(fontsOut, f));

const hostManifest = `${JSON.stringify({
  name: HOST,
  description: 'Commissar Study Watch: shows the Commissar over every app and tells the extension which app is in front',
  path: INSTALLED,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${id}/`],
}, null, 2)}\n`;
for (const m of targets) { mkdirSync(dirname(m), { recursive: true }); writeFileSync(m, hostManifest); }
console.log(`ok: helper built and installed at ${INSTALLED}`);
for (const m of targets) console.log(`ok: registered for ${browser} in ${m}`);
console.log('Now tick "Use the Mac helper" in the extension\'s Settings (it asks for one permission) and start a session.');
