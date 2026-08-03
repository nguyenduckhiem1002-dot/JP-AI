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

export async function tokenizeText(text: string): Promise<TranscriptToken[]> {
  const t = await getTokenizer();
  return t.tokenize(text).map(token => ({
    text: token.surface_form,
    reading: token.reading ? token.reading : undefined, // Katakana reading
    pos: token.pos,
    meaning: undefined // Will be filled by Gemini
  }));
}
