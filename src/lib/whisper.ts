import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import path from 'node:path';
import type { RawPiece } from './asr';

const WHISPER_BIN = process.env.WHISPER_CLI || 'whisper-cli';
const MODEL_PATH = process.env.WHISPER_MODEL || path.join(process.cwd(), 'models', 'ggml-large-v3-turbo-q5_0.bin');
// DTW alignment-heads preset matching the model; gives far better token times than the default heuristic
// Set WHISPER_DTW=none for models with no preset (e.g. distilled Kotoba-Whisper)
const DTW_PRESET = process.env.WHISPER_DTW || 'large.v3.turbo';
// Punctuated prompt nudges Whisper into emitting 。、 so lines can be split on sentences
const PROMPT = 'こんにちは。今日は、よろしくお願いします。';

type WhisperToken = { text: string; offsets: { from: number; to: number }; t_dtw?: number };
type WhisperJson = { transcription: { tokens?: WhisperToken[] }[] };
type Span = { bytes: Buffer; start: number; end: number; segmentEnd: boolean };

function runWhisper(wavFile: string, outBase: string): Promise<void> {
  const args = [
    '-m', MODEL_PATH,
    '-l', 'ja',
    '-t', String(Math.min(8, cpus().length)),
    '--prompt', PROMPT,
    '-ojf', '-of', outBase,
    '-np',
    // Don't condition on previously decoded text: stops Whisper looping on repeated phrases
    '-mc', '0',
    // No --vad: whisper.cpp then reports token offsets on the silence-stripped timeline.
    // DTW needs flash attention off.
    ...(DTW_PRESET === 'none' ? [] : ['-nfa', '--dtw', DTW_PRESET]),
    '-f', wavFile,
  ];

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(WHISPER_BIN, args);
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-2000); });
    proc.on('error', err => reject(
      (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? new Error('Chưa cài whisper-cli (brew install whisper-cpp)')
        : err,
    ));
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`whisper-cli exited ${code}: ${stderr}`))));
  });
}

/** Length of the longest prefix of `buf` that ends on a complete UTF-8 character. */
function completeUtf8Length(buf: Buffer): number {
  let i = buf.length - 1;
  while (i >= 0 && (buf[i] & 0xc0) === 0x80) i--;
  if (i < 0) return 0;
  const lead = buf[i];
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return i + need <= buf.length ? buf.length : i;
}

/**
 * DTW time marks roughly where each token ends, so a token spans from the previous mark
 * to its own. (Starts get pulled onto speech onsets later, in asr.ts.)
 */
function toSpans(json: WhisperJson): Span[] {
  const spans: Span[] = [];
  let mark = 0;
  for (const segment of json.transcription) {
    const tokens = (segment.tokens || []).filter(t => !t.text.startsWith('[_'));
    tokens.forEach((token, i) => {
      const dtw = token.t_dtw !== undefined && token.t_dtw >= 0 ? token.t_dtw / 100 : token.offsets.to / 1000;
      const end = Math.max(dtw, mark);
      spans.push({ bytes: Buffer.from(token.text, 'latin1'), start: mark, end, segmentEnd: i === tokens.length - 1 });
      mark = end;
    });
  }
  return spans;
}

/**
 * Whisper tokens can split a multi-byte character, so the JSON is read as latin1
 * (one char per byte) and tokens are re-joined on UTF-8 character boundaries.
 */
function toPieces(spans: Span[]): RawPiece[] {
  const pieces: RawPiece[] = [];
  let pending = Buffer.alloc(0);
  let first: Span | null = null;
  spans.forEach((span, i) => {
    first ??= span;
    pending = Buffer.concat([pending, span.bytes]);
    const n = completeUtf8Length(pending);
    if (n === 0 && i < spans.length - 1 && !span.segmentEnd) return;
    const text = pending.subarray(0, n || pending.length).toString('utf8');
    if (text) {
      pieces.push({
        text,
        start: first.start,
        end: Math.max(span.end, first.start),
        segmentEnd: span.segmentEnd,
      });
    }
    pending = Buffer.from(pending.subarray(n || pending.length));
    first = pending.length ? span : null;
  });
  return pieces;
}

/** Whisper (whisper.cpp, Metal GPU) with DTW token timings; scratch files go in `dir`. */
export async function whisperPieces(wav: string, dir: string): Promise<RawPiece[]> {
  if (!existsSync(MODEL_PATH)) throw new Error(`Không tìm thấy model Whisper: ${MODEL_PATH}`);
  const outBase = path.join(dir, 'whisper');
  await runWhisper(wav, outBase);
  const json = JSON.parse((await readFile(`${outBase}.json`)).toString('latin1')) as WhisperJson;
  return toPieces(toSpans(json));
}
