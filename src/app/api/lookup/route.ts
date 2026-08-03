import { NextResponse } from "next/server";
import { getCache, setCache } from "@/lib/simpleCache";
import { callGeminiWithFallback } from "@/lib/gemini";

export async function POST(req: Request) {
  try {
    const { word, context, apiKey } = await req.json();
    if (!word) return NextResponse.json({ error: "Missing word" }, { status: 400 });

    const key = `lookup:${word}:${context || ''}`;
    const cached = getCache(key);
    if (cached) return NextResponse.json(cached);

    if (!apiKey) {
      return NextResponse.json({
        word,
        pos: "Chưa rõ",
        meaning: "(Nhập API key để tra từ)",
        reading: word
      });
    }

    const schema = {
      type: "OBJECT",
      properties: {
        pos: { type: "STRING", description: "Part of speech in Vietnamese (Danh từ, Động từ, Tính từ, etc.)" },
        meaning: { type: "STRING", description: "Meaning in Vietnamese in this specific context" },
        reading: { type: "STRING", description: "Hiragana reading of the word" }
      },
      required: ["pos", "meaning", "reading"]
    };

    const prompt = `Lookup this Japanese word: "${word}". Context sentence: "${context || word}". Return part of speech, Vietnamese meaning, and hiragana reading.`;
    
    const result = await callGeminiWithFallback(
      'wordLookup', 
      { contents: [{ parts: [{ text: prompt }] }], schema }, 
      apiKey
    );

    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      const finalResult = {
        word,
        pos: data.pos,
        meaning: data.meaning,
        reading: data.reading
      };
      setCache(key, finalResult);
      return NextResponse.json(finalResult);
    }

    throw new Error("Invalid response format");
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
