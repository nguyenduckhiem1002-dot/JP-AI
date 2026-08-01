const MODEL_CHAINS = {
  translation: [ 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  wordLookup:  ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
};

export async function callGeminiWithFallback(task: 'translation' | 'wordLookup', payload: any, apiKey?: string) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing Gemini API Key");

  for (const model of MODEL_CHAINS[task]) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'x-goog-api-key': key
          },
          body: JSON.stringify({
            contents: payload.contents,
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: payload.schema,
              thinkingConfig: { thinkingLevel: task === 'wordLookup' ? 'minimal' : 'low' },
            },
          }),
        }
      );
      if (res.status === 429 || res.status === 503) continue; // fallback
      if (!res.ok) throw new Error(`Gemini error ${res.status}`);
      return await res.json();
    } catch { continue; }
  }
  throw new Error('Tất cả model trong chain đều thất bại');
}
