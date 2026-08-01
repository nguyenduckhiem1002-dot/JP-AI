import { YoutubeTranscript } from 'youtube-transcript';
import { Innertube } from 'youtubei.js';

export async function fetchTranscript(videoId: string) {
  // Method 1: youtube-transcript
  const fetchWithYoutubeTranscript = async () => {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
    return transcript.map(t => ({
      text: t.text,
      start: t.offset / 1000,
      duration: t.duration / 1000,
    }));
  };

  // Method 2: youtubei.js
  const fetchWithYoutubei = async () => {
    const yt = await Innertube.create();
    const info = await yt.getInfo(videoId);

    const transcriptData = await info.getTranscript();
    if (!transcriptData || !transcriptData.transcript) {
      throw new Error("No transcript found in youtubei");
    }

    const lines = [];
    if (transcriptData.transcript.content?.body?.initial_segments) {
       for (const segment of transcriptData.transcript.content.body.initial_segments) {
          lines.push({
             text: segment.snippet?.text || "",
             start: parseInt(segment.start_ms || "0") / 1000,
             duration: parseInt((segment as any).duration_ms || "0") / 1000
          });
       }
    }
    if (lines.length > 0) return lines;
    throw new Error("Empty transcript from youtubei");
  };

  try {
    return await fetchWithYoutubeTranscript();
  } catch (err) {
    console.log("Fallback to youtubei.js for transcript");
    try {
      return await fetchWithYoutubei();
    } catch (fallbackErr) {
      console.log("Both methods failed");
      throw new Error("Video này không có phụ đề tiếng Nhật hoặc bị giới hạn quốc gia. Vui lòng thử link khác.");
    }
  }
}
