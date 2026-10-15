import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applePieces, appleAsrAvailable } from './appleAsr';
import { runFfmpeg, SAMPLE_RATE, toFloat32, withAudioFile } from './audio';
import type { TimedWord } from './tokenize';
import { detectSpeech, type SpeechSegment } from './vadAlign';
import { whisperPieces } from './whisper';

export type TranscriptLine = { text: string; start: number; duration: number; words: TimedWord[] };
/** Smallest timed unit an engine produces; `segmentEnd` marks the end of one of its utterances. */
export type RawPiece = TimedWord & { segmentEnd: boolean };
type Piece = RawPiece & { inSpeech: boolean };

// 'apple' (default on macOS when bin/apple-asr exists) falls back to 'whisper' on failure
const ENGINE = process.env.ASR_ENGINE === 'whisper' ? 'whisper' : 'apple';
// v3: Apple SpeechAnalyzer, merged fragment lines (v2: Whisper only)
const CACHE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.cache', 'asr-v3');

// Line splitting (seconds / characters)
const MAX_GAP = 1.0;        // a pause this long ends a line…
const MIN_LINE_CHARS = 8;   // …once the line has this many characters
const LONG_GAP = 3.0;       // a pause this long always ends a line
const SOFT_MAX_CHARS = 28;
const HARD_MAX_CHARS = 48;
const SENTENCE_END = /[。！？!?]$/;
const CLAUSE_END = /[、,]$/;

const letterCount = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').length;

/** Index of the last speech segment starting before `t`, or -1. */
function segmentBefore(speech: SpeechSegment[], t: number): number {
  let lo = 0, hi = speech.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (speech[mid].start < t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/**
 * Pull each piece's start forward onto its Silero speech onset (so a word after a pause
 * doesn't light up during the silence) and clip ends that run into silence.
 */
function snapToSpeech(pieces: RawPiece[], speech: SpeechSegment[]): Piece[] {
  return pieces.map(p => {
    if (!speech.length) return { ...p, inSpeech: true };
    const seg = speech[segmentBefore(speech, p.end - 0.01)];
    if (!seg) return { ...p, inSpeech: false };
    const start = Math.max(p.start, seg.start);
    const end = p.end > seg.end + 0.05 && start < seg.end ? seg.end : p.end;
    return { ...p, start, end: Math.max(end, start), inSpeech: p.end <= seg.end + 0.3 };
  });
}

/** Drop whole engine utterances Silero heard no speech under (hallucinations over silence/music). */
function dropUnheard(pieces: Piece[]): Piece[] {
  const kept: Piece[] = [];
  let group: Piece[] = [];
  for (const p of pieces) {
    group.push(p);
    if (p.segmentEnd) {
      if (group.some(g => g.inSpeech)) kept.push(...group);
      group = [];
    }
  }
  if (group.some(g => g.inSpeech)) kept.push(...group);
  return kept;
}

function toLines(pieces: Piece[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let words: TimedWord[] = [];

  const flush = () => {
    const text = words.map(w => w.text).join('').trim();
    if (text) {
      const prevEnd = lines.length ? lines[lines.length - 1].start + lines[lines.length - 1].duration : 0;
      const start = Math.max(words[0].start, prevEnd);
      const end = Math.max(words[words.length - 1].end, start);
      lines.push({ text, start, duration: end - start, words });
    }
    words = [];
  };

  pieces.forEach((piece, i) => {
    words.push({ text: piece.text, start: piece.start, end: piece.end });
    const next = pieces[i + 1];
    if (!next) return flush();
    // Punctuation never starts a line: keep it with the words before it
    if (letterCount(next.text) === 0) return;

    const len = letterCount(words.map(w => w.text).join(''));
    const gap = next.start - piece.end;
    const t = piece.text.trim();
    if (
      SENTENCE_END.test(t) ||
      gap > LONG_GAP ||
      ((gap > MAX_GAP || piece.segmentEnd) && len >= MIN_LINE_CHARS) ||
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

/** Transcribe a 16kHz mono WAV: Apple SpeechAnalyzer first, Whisper as fallback. */
export async function transcribeWav(wav: string, dir: string): Promise<TranscriptLine[]> {
  const speech = speechSegments(wav);
  let pieces: RawPiece[] = [];
  if (ENGINE === 'apple' && appleAsrAvailable()) {
    try {
      pieces = await applePieces(wav);
      if (!pieces.length) console.warn('Apple ASR heard nothing, trying Whisper');
    } catch (err) {
      console.warn('Apple ASR failed, falling back to Whisper:', (err as Error).message);
    }
  }
  if (!pieces.length) pieces = await whisperPieces(wav, dir);
  return toLines(dropUnheard(snapToSpeech(pieces, await speech)));
}

async function transcribe(videoId: string): Promise<TranscriptLine[]> {
  return withAudioFile(videoId, async (file, dir) => {
    const wav = path.join(dir, 'audio.wav');
    await runFfmpeg(['-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', wav]);
    console.time(`asr ${videoId}`);
    const lines = await transcribeWav(wav, dir);
    console.timeEnd(`asr ${videoId}`);
    return lines;
  });
}

const inFlight = new Map<string, Promise<TranscriptLine[]>>();

/** Japanese transcript of the video with per-word timings, cached on disk. */
export async function transcribeVideo(videoId: string): Promise<TranscriptLine[]> {
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
