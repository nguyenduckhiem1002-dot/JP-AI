import * as wanakana from 'wanakana';

export function tokensToRomaji(tokens: { text: string; reading?: string }[]) {
  return tokens
    .map(t => wanakana.toRomaji(t.reading || t.text))
    .join(' ');
}
