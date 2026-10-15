import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadAudioPcm, SAMPLE_RATE } from './audio';

export type SpeechSegment = { start: number; end: number };
type Line = { text: string; start: number; duration: number };

const WINDOW = 512; // Silero v5 @16kHz
const CONTEXT = 64;
const MODEL_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), 'models', 'silero_vad.onnx');
const CACHE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), '.cache', 'vad');

// Hysteresis / duration params (seconds)
const THRESHOLD = 0.5;
const NEG_THRESHOLD = 0.35;
const MIN_SPEECH = 0.15;
const MIN_SILENCE = 0.25;
const SPEECH_PAD = 0.03;

// How far a caption boundary may move to snap onto a speech boundary
const SNAP_RANGE = 0.8;

export async function detectSpeech(pcm: Float32Array): Promise<SpeechSegment[]> {
  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create(MODEL_PATH);
  const srTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);

  let state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  let context = new Float32Array(CONTEXT);
  const input = new Float32Array(CONTEXT + WINDOW);

  const segments: SpeechSegment[] = [];
  let speechStart = -1;
  let silenceStart = -1;
  const frameSec = WINDOW / SAMPLE_RATE;

  const numFrames = Math.floor(pcm.length / WINDOW);
  for (let f = 0; f < numFrames; f++) {
    const chunk = pcm.subarray(f * WINDOW, (f + 1) * WINDOW);
    input.set(context, 0);
    input.set(chunk, CONTEXT);
    context = chunk.slice(WINDOW - CONTEXT);

    const out = await session.run({
      input: new ort.Tensor('float32', input, [1, CONTEXT + WINDOW]),
      state,
      sr: srTensor,
    });
    state = out.stateN as typeof state;
    const prob = (out.output.data as Float32Array)[0];
    const t = f * frameSec;

    if (prob >= THRESHOLD) {
      silenceStart = -1;
      if (speechStart < 0) speechStart = t;
    } else if (speechStart >= 0 && prob < NEG_THRESHOLD) {
      if (silenceStart < 0) silenceStart = t;
      if (t + frameSec - silenceStart >= MIN_SILENCE) {
        if (silenceStart - speechStart >= MIN_SPEECH) {
          segments.push({ start: speechStart, end: silenceStart });
        }
        speechStart = -1;
        silenceStart = -1;
      }
    }
  }
  if (speechStart >= 0) {
    const end = silenceStart >= 0 ? silenceStart : numFrames * frameSec;
    if (end - speechStart >= MIN_SPEECH) segments.push({ start: speechStart, end });
  }

  const total = pcm.length / SAMPLE_RATE;
  return segments.map(s => ({
    start: Math.max(0, s.start - SPEECH_PAD),
    end: Math.min(total, s.end + SPEECH_PAD),
  }));
}

async function getSpeechSegments(videoId: string): Promise<SpeechSegment[]> {
  const cacheFile = path.join(CACHE_DIR, `${videoId.replace(/[^\w-]/g, '')}.json`);
  try {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  } catch { /* not cached */ }

  const pcm = await downloadAudioPcm(videoId);
  const segments = await detectSpeech(pcm);
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(segments));
  } catch { /* cache is best-effort */ }
  return segments;
}

function nearest(values: number[], target: number): number | null {
  let best: number | null = null;
  let bestDist = SNAP_RANGE;
  for (const v of values) {
    const d = Math.abs(v - target);
    if (d <= bestDist) { best = v; bestDist = d; }
  }
  return best;
}

/** Snap each caption's start/end onto the nearest speech onset/offset. */
export function snapLinesToSpeech<T extends Line>(lines: T[], segments: SpeechSegment[]): T[] {
  if (segments.length === 0) return lines;
  const onsets = segments.map(s => s.start);
  const offsets = segments.map(s => s.end);

  const out = lines.map(l => ({ ...l }));
  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    const origEnd = line.start + line.duration;
    const prevEnd = i > 0 ? out[i - 1].start + out[i - 1].duration : 0;
    const nextStart = i < out.length - 1 ? lines[i + 1].start : Infinity;

    let start = nearest(onsets, line.start) ?? line.start;
    let end = nearest(offsets, origEnd) ?? origEnd;

    start = Math.max(start, prevEnd);
    end = Math.min(end, nextStart);
    if (end - start < 0.2) { start = Math.max(line.start, prevEnd); end = Math.min(origEnd, nextStart); }

    line.start = start;
    line.duration = Math.max(0, end - start);
  }
  return out;
}

/** Best-effort: returns the original lines unchanged if anything fails. */
export async function alignWithVad<T extends Line>(videoId: string, lines: T[]): Promise<T[]> {
  try {
    const segments = await getSpeechSegments(videoId);
    return snapLinesToSpeech(lines, segments);
  } catch (err) {
    console.warn('VAD alignment skipped:', (err as Error).message);
    return lines;
  }
}
