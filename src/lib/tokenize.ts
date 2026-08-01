import kuromoji from 'kuromoji';
import path from 'path';

let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | null = null;

export async function getTokenizer(): Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> {
  if (tokenizer) return tokenizer;

  return new Promise((resolve, reject) => {
    // resolve absolute path for node environment
    const dicPath = path.resolve('./public/dict');

    kuromoji.builder({ dicPath }).build((err, t) => {
      if (err) return reject(err);
      tokenizer = t;
      resolve(t);
    });
  });
}

export async function tokenizeText(text: string) {
  const t = await getTokenizer();
  return t.tokenize(text).map(token => ({
    text: token.surface_form,
    reading: token.reading ? token.reading : undefined, // Katakana reading
    pos: token.pos,
    meaning: undefined // Will be filled by Gemini
  }));
}
