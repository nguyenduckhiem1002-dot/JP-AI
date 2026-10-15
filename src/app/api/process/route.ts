import { NextResponse } from "next/server";
import { getCache, setCache } from "@/lib/simpleCache";
import { assignWordTimings, tokenizeText } from "@/lib/tokenize";
import jaconv from 'jaconv';
import { callGeminiWithFallback } from "@/lib/gemini";
import { tokensToRomaji } from "@/lib/romaji";
import { transcribeVideo } from "@/lib/asr";

function kataToHira(kata: string) {
  if (!kata) return "";
  return jaconv.toHiragana(kata);
}

export async function POST(req: Request) {
  try {
    const { videoId, apiKey } = await req.json();
    if (!videoId) return NextResponse.json({ error: "Missing videoId" }, { status: 400 });

    const cacheKey = `transcript:${videoId}`;
    const cached = getCache(cacheKey);
    if (cached) {
      if (apiKey) {
        // If we have cached tokenized lines but now we have an apiKey, we just need to send them back
        // Real app might want to trigger a background translation here, but for now we rely on lazy load
        return NextResponse.json({ transcript: cached });
      }
      return NextResponse.json({ transcript: cached });
    }

    // 1. Nhận dạng giọng nói trên máy (Apple SpeechAnalyzer, dự phòng Whisper) — có timing từng chữ, không dùng phụ đề YouTube
    console.log("Transcribing", videoId);
    let rawTranscript;
    try {
      rawTranscript = await transcribeVideo(videoId);
    } catch (e: any) {
      console.error("Speech recognition failed:", e);
      return NextResponse.json({ error: `Nhận dạng giọng nói lỗi: ${e.message}` }, { status: 500 });
    }

    if (!rawTranscript || rawTranscript.length === 0) {
      return NextResponse.json({ error: "Không nhận dạng được lời thoại tiếng Nhật" }, { status: 400 });
    }

    // 2. CHỈ Tokenize 20 câu đầu tiên để load cực nhanh
    const initialBatch = rawTranscript.slice(0, 20);
    const restBatch = rawTranscript.slice(20);

    console.log("Tokenizing initial batch locally...");
    const tokenizedInitial = await Promise.all(
      initialBatch.map(async (line) => {
        const tokens = await tokenizeText(line.text);
        const cleanTokens = tokens.map(t => ({
          text: t.text,
          reading: t.reading ? kataToHira(t.reading) : undefined,
          pos: t.pos
        }));

        return {
          start: line.start,
          duration: line.duration,
          text: line.text,
          words: line.words,
          tokens: assignWordTimings(line.start, line.duration, cleanTokens, line.words),
          isTokenized: true
        };
      })
    );

    // 3. Dịch 20 câu đầu
    let finalInitialLines = tokenizedInitial.map(l => ({ ...l, romaji: "", translation: "", isTranslated: false }));

    if (apiKey) {
      console.log(`Calling Gemini for initial batch translation`);
      const schema = {
        type: "ARRAY",
        description: "Bản dịch từng dòng phụ đề, đúng thứ tự với đầu vào",
        items: {
          type: "OBJECT",
          properties: {
            index: { type: "NUMBER", description: "Chỉ số dòng gốc" },
            translation: { type: "STRING", description: "Bản dịch tiếng Việt tự nhiên" },
          },
          required: ["index", "translation"]
        }
      };

      const inputLines = tokenizedInitial.map((l, i) => ({ index: i, text: l.text }));
      const prompt = `Bạn là biên dịch viên tiếng Nhật - tiếng Việt chuyên dịch phụ đề video (hội thoại nói tự nhiên).
Dưới đây là các dòng phụ đề liên tiếp. Hãy đọc TOÀN BỘ các dòng theo mạch để hiểu đúng ngữ cảnh, nhưng khi trả kết quả PHẢI dịch tương ứng đúng theo từng dòng gốc theo index.
Yêu cầu:
- Dịch tự nhiên, đúng văn phong hội thoại đời thường.
- Giữ đúng sắc thái tiểu từ cuối câu.
Dữ liệu đầu vào:
${JSON.stringify(inputLines)}`;

      let translatedData: any[] = [];
      try {
        const result = await callGeminiWithFallback('translation', { contents: [{ parts: [{ text: prompt }] }], schema }, apiKey);
        if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
          translatedData = JSON.parse(result.candidates[0].content.parts[0].text);
        }
      } catch (geminiErr) {
        console.error(`Gemini initial translation failed`, geminiErr);
        translatedData = inputLines.map((_, idx) => ({ index: idx, translation: "Bản dịch (Lỗi API)" }));
      }

      finalInitialLines = tokenizedInitial.map((line, idx) => {
        const match = translatedData.find((d: any) => d.index === idx);
        return {
          ...line,
          romaji: tokensToRomaji(line.tokens),
          translation: match?.translation || "",
          isTranslated: !!match
        };
      });
    }

    // Combine
    const finalLines = [
      ...tokenizedInitial.map(l => ({ ...l, romaji: "", translation: "", isTranslated: false, isTokenized: true })),
      ...restBatch.map((line) => ({
        start: line.start,
        duration: line.duration,
        text: line.text,
        words: line.words,
        // Fake single token for un-tokenized lines so UI doesn't crash
        tokens: [{ text: line.text, pos: "Unknown" }],
        romaji: "",
        translation: "",
        isTranslated: false,
        isTokenized: false
      }))
    ];

    setCache(cacheKey, finalLines);

    if (apiKey) {
      const translatedDataMap = new Map(finalInitialLines.map((l, i) => [i, l]));
      const linesToSend = finalLines.map((l, i) => {
        if (translatedDataMap.has(i)) {
          return translatedDataMap.get(i);
        }
        return l;
      });
      return NextResponse.json({ transcript: linesToSend });
    }

    return NextResponse.json({ transcript: finalLines });

  } catch (error: any) {
    console.error("Process API Error:", error);
    return NextResponse.json({ error: error.message || "Lỗi xử lý video" }, { status: 500 });
  }
}
