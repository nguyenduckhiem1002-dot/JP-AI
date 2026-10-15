import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { RawPiece } from './asr';

// Built from tools/apple-asr/main.swift by `npm run build:asr` (also runs before dev/build)
const APPLE_ASR_BIN = path.join(/*turbopackIgnore: true*/ process.cwd(), 'bin', 'apple-asr');

type AppleWord = { text: string; start: number; end: number };
type AppleJson = { results: { words: AppleWord[] }[] };

export function appleAsrAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(APPLE_ASR_BIN);
}

function runAppleAsr(wavFile: string): Promise<AppleJson> {
  return new Promise((resolve, reject) => {
    // Relative to the working directory (= APPLE_ASR_BIN); a variable command makes Turbopack trace the whole project
    const proc = spawn('./bin/apple-asr', [wavFile, 'ja-JP']);
    const out: Buffer[] = [];
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-2000); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`apple-asr exited ${code}: ${stderr.trim()}`));
      try {
        resolve(JSON.parse(Buffer.concat(out).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
  });
}

const isAscii = (c: string | undefined) => c !== undefined && c < '\u0080';

/**
 * Apple's SpeechAnalyzer (on-device, Neural Engine) — about 5x faster than Whisper here
 * with similar accuracy on Japanese, and per-character timings.
 */
export async function applePieces(wavFile: string): Promise<RawPiece[]> {
  const json = await runAppleAsr(wavFile);
  const pieces: RawPiece[] = [];
  let untimed = '';

  for (const result of json.results) {
    for (const word of result.words) {
      let text = untimed + word.text;
      untimed = '';
      // Apple spaces out numbers ("毎朝 6時"); keep spaces only between ASCII words
      const prev = pieces.at(-1)?.text.at(-1);
      const first = text.trimStart()[0];
      if (/^\s/.test(text) && !(isAscii(prev) && isAscii(first))) text = text.trimStart();
      if (!text) continue;

      if (word.start < 0) {
        // No time range: glue onto the previous character (or the next one at the start)
        const last = pieces.at(-1);
        if (last && !last.segmentEnd) last.text += text;
        else untimed = text;
        continue;
      }
      pieces.push({ text, start: word.start, end: Math.max(word.end, word.start), segmentEnd: false });
    }
    const last = pieces.at(-1);
    if (last) last.segmentEnd = true;
  }
  return pieces;
}
