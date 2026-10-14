import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Innertube } from 'youtubei.js';

export const SAMPLE_RATE = 16000;
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';

function runYtDlp(videoId: string, dir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, [
      '-q', '--no-warnings', '--no-playlist', '-f', 'bestaudio/best',
      '-o', path.join(dir, 'ytdlp.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-1000); });
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}: ${stderr}`))));
  });
}

async function downloadWithYoutubei(videoId: string, file: string) {
  const yt = await Innertube.create();
  const stream = await yt.download(videoId, { type: 'audio', quality: 'best', format: 'any' });
  await pipeline(Readable.fromWeb(stream as any), createWriteStream(file));
}

/** yt-dlp first (youtubei.js often can't decipher stream URLs anymore), youtubei.js as fallback. */
async function downloadAudio(videoId: string, dir: string): Promise<string> {
  try {
    await runYtDlp(videoId, dir);
    const name = (await readdir(dir)).find(f => f.startsWith('ytdlp.'));
    if (name) return path.join(dir, name);
    throw new Error('yt-dlp produced no file');
  } catch (err) {
    console.warn('yt-dlp failed, falling back to youtubei.js:', (err as Error).message);
    const file = path.join(dir, 'audio');
    await downloadWithYoutubei(videoId, file);
    return file;
  }
}

/** Download the video's audio into a temp dir, run `fn` on the file, then clean up. */
export async function withAudioFile<T>(videoId: string, fn: (file: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'jpai-audio-'));
  try {
    const file = await downloadAudio(videoId, dir);
    return await fn(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function runFfmpeg(args: string[], onData?: (chunk: Buffer) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-v', 'error', ...args]);
    if (onData) ff.stdout.on('data', onData);
    ff.on('error', reject);
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

/** Copy f32le bytes into a Float32Array (Buffer offsets aren't always 4-byte aligned). */
export function toFloat32(buf: Buffer): Float32Array {
  const out = new Float32Array(Math.floor(buf.byteLength / 4));
  new Uint8Array(out.buffer).set(buf.subarray(0, out.length * 4));
  return out;
}

/** Mono 16kHz float32 PCM of the video's audio. */
export async function downloadAudioPcm(videoId: string): Promise<Float32Array> {
  return withAudioFile(videoId, async file => {
    const chunks: Buffer[] = [];
    await runFfmpeg(
      ['-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'],
      c => chunks.push(c),
    );
    return toFloat32(Buffer.concat(chunks));
  });
}
