// Builds bin/apple-asr from main.swift when missing or stale. Never fails the caller:
// without it (not macOS, no Xcode command line tools) the app falls back to Whisper.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = path.join(root, 'tools', 'apple-asr', 'main.swift');
const out = path.join(root, 'bin', 'apple-asr');

if (process.platform !== 'darwin') process.exit(0);
if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) process.exit(0);

try {
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('swiftc', ['-O', '-parse-as-library', src, '-o', out], { stdio: 'inherit' });
  console.log('Built bin/apple-asr');
} catch {
  console.warn('Skipped building bin/apple-asr (needs macOS 26+ and Xcode command line tools); Whisper will be used.');
}
