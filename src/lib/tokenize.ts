import kuromoji from 'kuromoji';
import path from 'path';

let tokenizerPromise: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | null = null;

export function getTokenizer(): Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      const dicPath = path.resolve('./public/dict');
      kuromoji.builder({ dicPath }).build((err, t) => {
        if (err) {
          tokenizerPromise = null;
          return reject(err);
        }
        resolve(t);
      });
    });
  }
  return tokenizerPromise;
}

export type TranscriptToken = {
  text: string;
  reading?: string;
  pos: string;
  meaning?: string;
  start?: number;
  end?: number;
};

export function assignTokenTimings(
  lineStart: number,
  lineDuration: number,
  tokens: TranscriptToken[]
): TranscriptToken[] {
  if (!tokens.length || lineDuration <= 0) return tokens;

  // Sometimes line.duration from YouTube overlaps with the next line slightly.
  // We need to ensure we don't extend past the actual line boundaries.
  const actualDuration = lineDuration;

  const weights = tokens.map((token) => {
    if (token.pos === "記号") return 0.25;
    if (token.pos === "助詞") return 0.55;
    return Math.max((token.reading || token.text).length, 1);
  });
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let cursor = lineStart;

  return tokens.map((token, index) => {
    const end = index === tokens.length - 1
      ? lineStart + actualDuration
      : cursor + (actualDuration * weights[index]) / totalWeight;
    // ensure end does not overshoot line limits due to float imprecision
    const safeEnd = Math.min(end, lineStart + actualDuration);
    const timedToken = { ...token, start: cursor, end: safeEnd };
    cursor = safeEnd;
    return timedToken;
  });
}

export type TimedWord = { text: string; start: number; end: number };

/**
 * Time tokens from Whisper word timestamps by matching characters in order.
 * Falls back to the length-weighted guess when there are no words.
 */
export function assignWordTimings(
  lineStart: number,
  lineDuration: number,
  tokens: TranscriptToken[],
  words?: TimedWord[]
): TranscriptToken[] {
  if (!words?.length) return assignTokenTimings(lineStart, lineDuration, tokens);

  // Per-character times, spread evenly inside each word
  const chars: { c: string; start: number; end: number }[] = [];
  for (const w of words) {
    const cs = [...w.text];
    const step = (w.end - w.start) / Math.max(cs.length, 1);
    cs.forEach((c, i) => chars.push({ c, start: w.start + i * step, end: w.start + (i + 1) * step }));
  }

  let ci = 0;
  let prevEnd = lineStart;
  return tokens.map((token) => {
    let first = -1;
    let last = -1;
    for (const c of token.text) {
      let k = ci;
      while (k < chars.length && chars[k].c !== c && k - ci < 8) k++;
      if (k < chars.length && chars[k].c === c) {
        if (first < 0) first = k;
        last = k;
        ci = k + 1;
      }
    }
    const start = first < 0 ? prevEnd : Math.max(chars[first].start, prevEnd);
    const end = first < 0 ? prevEnd : Math.max(chars[last].end, start);
    prevEnd = end;
    return { ...token, start, end };
  });
}

export async function tokenizeText(text: string): Promise<TranscriptToken[]> {
  const t = await getTokenizer();
  return t.tokenize(text).map(token => ({
    text: token.surface_form,
    reading: token.reading ? token.reading : undefined, // Katakana reading
    pos: token.pos,
    meaning: undefined // Will be filled by Gemini
  }));
}
