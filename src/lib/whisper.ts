import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import path from 'node:path';
import { runFfmpeg, SAMPLE_RATE, toFloat32, withAudioFile } from './audio';
import type { TimedWord } from './tokenize';
import { detectSpeech, type SpeechSegment } from './vadAlign';

export type WhisperLine = { text: string; start: number; duration: number; words: TimedWord[] };

const WHISPER_BIN = process.env.WHISPER_CLI || 'whisper-cli';
const MODEL_PATH = process.env.WHISPER_MODEL || path.join(process.cwd(), 'models', 'ggml-large-v3-turbo-q5_0.bin');
// DTW alignment-heads preset matching the model; gives far better token times than the default heuristic
const DTW_PRESET = process.env.WHISPER_DTW || 'large.v3.turbo';
// v2: DTW + Silero timings (v1 used whisper.cpp --vad, whose token offsets ignore removed silence)
const CACHE_DIR = path.join(process.cwd(), '.cache', 'whisper-v2');
// Punctuated prompt nudges Whisper into emitting 。、 so lines can be split on sentences
const PROMPT = 'こんにちは。今日は、よろしくお願いします。';

// Line splitting (seconds / characters)
const MAX_GAP = 1.0;
const SOFT_MAX_CHARS = 28;
const HARD_MAX_CHARS = 48;
const SENTENCE_END = /[。！？!?]$/;
const CLAUSE_END = /[、,]$/;

type WhisperToken = { text: string; offsets: { from: number; to: number }; t_dtw?: number };
type WhisperJson = { transcription: { tokens?: WhisperToken[] }[] };
type Span = { bytes: Buffer; start: number; end: number; inSpeech: boolean; segmentEnd: boolean };
type Piece = TimedWord & { inSpeech: boolean; segmentEnd: boolean };

function runWhisper(wavFile: string, outBase: string): Promise<void> {
  const args = [
    '-m', MODEL_PATH,
    '-l', 'ja',
    '-t', String(Math.min(8, cpus().length)),
    '--prompt', PROMPT,
    '-ojf', '-of', outBase,
    '-np',
    // No --vad: whisper.cpp then reports token offsets on the silence-stripped timeline.
    // DTW needs flash attention off.
    '-nfa', '--dtw', DTW_PRESET,
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
 * to its own. Starts are then pulled forward onto Silero speech onsets so a word after a
 * pause doesn't start lighting up during the silence.
 */
function toSpans(json: WhisperJson, speech: SpeechSegment[]): Span[] {
  const spans: Span[] = [];
  let mark = 0;
  let si = 0;
  for (const segment of json.transcription) {
    const tokens = (segment.tokens || []).filter(t => !t.text.startsWith('[_'));
    tokens.forEach((token, i) => {
      const dtw = token.t_dtw !== undefined && token.t_dtw >= 0 ? token.t_dtw / 100 : token.offsets.to / 1000;
      const end0 = Math.max(dtw, mark);
      let start = mark;
      let end = end0;
      mark = end0;

      while (si + 1 < speech.length && speech[si + 1].start < end0 - 0.01) si++;
      const seg = speech[si];
      let inSpeech = speech.length === 0;
      if (seg && seg.start < end0 - 0.01) {
        if (start < seg.start) start = seg.start;
        if (end > seg.end + 0.05 && start < seg.end) end = seg.end;
        inSpeech = end0 <= seg.end + 0.3;
      }
      spans.push({
        bytes: Buffer.from(token.text, 'latin1'),
        start,
        end: Math.max(end, start),
        inSpeech,
        segmentEnd: i === tokens.length - 1,
      });
    });
  }
  return spans;
}

/**
 * Whisper tokens can split a multi-byte character, so the JSON is read as latin1
 * (one char per byte) and tokens are re-joined on UTF-8 character boundaries.
 */
function toPieces(spans: Span[]): Piece[] {
  const pieces: Piece[] = [];
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
        inSpeech: first.inSpeech || span.inSpeech,
        segmentEnd: span.segmentEnd,
      });
    }
    pending = Buffer.from(pending.subarray(n || pending.length));
    first = pending.length ? span : null;
  });
  return pieces;
}

function toLines(pieces: Piece[]): WhisperLine[] {
  const lines: WhisperLine[] = [];
  let words: TimedWord[] = [];
  let heard = false;

  const flush = () => {
    const text = words.map(w => w.text).join('').trim();
    // Drop lines Silero found no speech under (Whisper hallucinating over silence/music)
    if (text && heard) {
      const prevEnd = lines.length ? lines[lines.length - 1].start + lines[lines.length - 1].duration : 0;
      const start = Math.max(words[0].start, prevEnd);
      const end = Math.max(words[words.length - 1].end, start);
      lines.push({ text, start, duration: end - start, words });
    }
    words = [];
    heard = false;
  };

  pieces.forEach((piece, i) => {
    words.push({ text: piece.text, start: piece.start, end: piece.end });
    heard ||= piece.inSpeech;
    const len = words.reduce((n, w) => n + w.text.trim().length, 0);
    const next = pieces[i + 1];
    const t = piece.text.trim();
    if (
      !next ||
      piece.segmentEnd ||
      SENTENCE_END.test(t) ||
      next.start - piece.end > MAX_GAP ||
      (len >= SOFT_MAX_CHARS && (CLAUSE_END.test(t) || /^\s/.test(next.text))) ||
      len >= HARD_MAX_CHARS
    ) flush();
  });
  return lines;
}

/** Silero speech segments; empty (no snapping/filtering) if VAD fails. */
async function speechSegments(wav: string): Promise<SpeechSegment[]> {
  try {
    const chunks: Buffer[] = [];
    await runFfmpeg(['-i', wav, '-f', 'f32le', 'pipe:1'], c => chunks.push(c));
    return await detectSpeech(toFloat32(Buffer.concat(chunks)));
  } catch (err) {
    console.warn('Silero VAD skipped:', (err as Error).message);
    return [];
  }
}

/** Transcribe a 16kHz mono WAV; scratch files go in `dir`. */
export async function transcribeWav(wav: string, dir: string): Promise<WhisperLine[]> {
  if (!existsSync(MODEL_PATH)) throw new Error(`Không tìm thấy model Whisper: ${MODEL_PATH}`);
  const outBase = path.join(dir, 'whisper');
  const [, speech] = await Promise.all([runWhisper(wav, outBase), speechSegments(wav)]);
  const json = JSON.parse((await readFile(`${outBase}.json`)).toString('latin1')) as WhisperJson;
  return toLines(toPieces(toSpans(json, speech)));
}

async function transcribe(videoId: string): Promise<WhisperLine[]> {
  return withAudioFile(videoId, async (file, dir) => {
    const wav = path.join(dir, 'audio.wav');
    await runFfmpeg(['-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', wav]);
    console.time(`whisper ${videoId}`);
    const lines = await transcribeWav(wav, dir);
    console.timeEnd(`whisper ${videoId}`);
    return lines;
  });
}

const inFlight = new Map<string, Promise<WhisperLine[]>>();

/** Japanese transcript of the video with per-word timings, cached on disk. */
export async function transcribeWithWhisper(videoId: string): Promise<WhisperLine[]> {
  const cacheFile = path.join(CACHE_DIR, `${videoId.replace(/[^\w-]/g, '')}.json`);
  try {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  } catch { /* not cached */ }

  let job = inFlight.get(videoId);
  if (!job) {
    job = transcribe(videoId).finally(() => inFlight.delete(videoId));
    inFlight.set(videoId, job);
  }
  const lines = await job;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(lines));
  } catch { /* cache is best-effort */ }
  return lines;
}
