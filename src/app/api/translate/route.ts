import { NextResponse } from "next/server";
import { callGeminiWithFallback } from "@/lib/gemini";
import { assignTokenTimings, tokenizeText } from "@/lib/tokenize";
import jaconv from 'jaconv';
import { tokensToRomaji } from "@/lib/romaji";

function kataToHira(kata: string) {
  if (!kata) return "";
  return jaconv.toHiragana(kata);
}

export async function POST(req: Request) {
  try {
    const { lines, apiKey } = await req.json();
    if (!lines || !lines.length) return NextResponse.json({ translated: [] });
    if (lines.length > 50) return NextResponse.json({ error: "Too many lines" }, { status: 400 });

    // Validate size to prevent abuse
    const MAX_LINE_LEN = 500;
    const safeLines = lines.map((l: any) => ({
      index: Number(l.index),
      text: String(l.text).substring(0, MAX_LINE_LEN),
      start: Number(l.start),
      duration: Number(l.duration)
    }));

    // 1. Tokenize lines first (since they were skipped in the initial load)
    const tokenizedLines = [];
    for (let i = 0; i < safeLines.length; i += 5) {
      const batch = safeLines.slice(i, i + 5);
      const batchResult = await Promise.all(
        batch.map(async (line: any) => {
        const tokens = await tokenizeText(line.text);
        const cleanTokens = tokens.map(t => ({
          text: t.text,
          reading: t.reading ? kataToHira(t.reading) : undefined,
          pos: t.pos
        }));

        return {
          index: line.index,
          text: line.text,
          tokens: assignTokenTimings(line.start, line.duration, cleanTokens),
          romaji: tokensToRomaji(cleanTokens)
        };
      })
      );
      tokenizedLines.push(...batchResult);
    }

    // 2. Call Gemini for translation
    let geminiTranslations: any[] = [];
    if (apiKey) {
      const schema = {
        type: "ARRAY",
        description: "Bản dịch từng dòng phụ đề, đúng thứ tự với đầu vào",
        items: {
          type: "OBJECT",
          properties: {
            index: { type: "NUMBER", description: "Chỉ số dòng gốc, giữ nguyên như đầu vào" },
            translation: { type: "STRING", description: "Bản dịch tiếng Việt tự nhiên, đúng ngữ cảnh hội thoại" },
          },
          required: ["index", "translation"]
        }
      };

      const inputForGemini = safeLines.map((l: any) => ({ index: l.index, text: l.text }));

      const prompt = `Bạn là biên dịch viên tiếng Nhật - tiếng Việt chuyên dịch phụ đề video (hội thoại nói tự nhiên, không phải văn viết trang trọng).

Dưới đây là các dòng phụ đề liên tiếp, được cắt tự động theo nhịp nói nên có thể KHÔNG khớp ranh giới câu ngữ pháp — một câu có thể bị chia làm 2-3 dòng, hoặc 1 dòng chứa nhiều mệnh đề. Hãy đọc TOÀN BỘ các dòng theo mạch để hiểu đúng ngữ cảnh (đặc biệt suy luận đúng chủ ngữ bị lược bỏ, vốn rất phổ biến trong tiếng Nhật nói), nhưng khi trả kết quả PHẢI dịch tương ứng đúng theo từng dòng gốc theo index, không được gộp hay tách lại dòng.

Yêu cầu dịch:
- Dịch tự nhiên, đúng văn phong hội thoại đời thường, không dịch máy móc từng từ.
- Giữ đúng sắc thái/ngữ khí của câu gốc (ví dụ: câu hỏi tu từ, cảm thán, tiểu từ cuối câu như ね/よ/わ thể hiện qua cách diễn đạt tiếng Việt tương ứng, không cần dịch nghĩa đen của tiểu từ).
- Giữ nguyên tên riêng, tên thương hiệu — không dịch hoặc phiên âm trừ khi có tên tiếng Việt phổ biến đã biết.
- Nếu 1 dòng chỉ là mảnh câu chưa trọn nghĩa (do bị cắt tự động), dịch đúng phần mảnh đó, không tự bịa thêm phần còn thiếu.

Dữ liệu đầu vào (JSON, mỗi phần tử là 1 dòng độc lập cần trả về đúng số lượng và đúng index):
${JSON.stringify(inputForGemini)}`;

      try {
        const result = await callGeminiWithFallback('translation', { contents: [{ parts: [{ text: prompt }] }], schema }, apiKey);
        if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
          geminiTranslations = JSON.parse(result.candidates[0].content.parts[0].text);
        }
      } catch (e) {
        console.error("Translate Chunk API Error in Gemini:", e);
      }
    }

    // 3. Merge tokenized data with translation
    const finalData = tokenizedLines.map(line => {
      const transMatch = geminiTranslations.find(t => t.index === line.index);
      return {
        index: line.index,
        tokens: line.tokens, // Returning tokens is crucial for lazy furigana
        romaji: line.romaji,
        translation: apiKey ? (transMatch?.translation || "Bản dịch (Lỗi API)") : "(Nhập API key để hiện bản dịch)",
        isTranslated: apiKey ? !!transMatch : false,
      };
    });

    return NextResponse.json({ translated: finalData });

  } catch (error: any) {
    console.error("Translate Chunk API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
