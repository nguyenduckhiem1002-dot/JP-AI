import { YoutubeTranscript } from 'youtube-transcript';
import { Innertube } from 'youtubei.js';

export function getActiveTranscriptIndex(lines: Array<{ start: number, duration: number }>, currentTime: number): number {
  if (!lines || lines.length === 0) return -1;
  // Lines are normalized to not overlap and have start/duration
  // Find the latest line that has started
  let activeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (currentTime >= lines[i].start && currentTime < lines[i].start + lines[i].duration) {
      return i;
    }
    if (currentTime >= lines[i].start) {
      activeIdx = i; // fallback if in a gap, select the closest previous line
    }
  }
  return activeIdx;
}
export async function fetchTranscript(videoId: string) {
  // Method 1: youtube-transcript
  const fetchWithYoutubeTranscript = async () => {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'ja' });
    return transcript.map(t => ({
      text: t.text,
      start: Math.max(0, t.offset / 1000),
      duration: Math.max(0, t.duration / 1000),
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

    const lines: Array<{ text: string, start: number, duration: number }> = [];
    if (transcriptData.transcript.content?.body?.initial_segments) {
       for (const segment of transcriptData.transcript.content.body.initial_segments) {
          lines.push({
             text: segment.snippet?.text || "",
             start: Math.max(0, parseInt(segment.start_ms || "0") / 1000),
             duration: Math.max(0, parseInt((segment as any).duration_ms || "0") / 1000)
          });
       }
    }
    if (lines.length > 0) return lines;
    throw new Error("Empty transcript from youtubei");
  };

  let rawLines: Array<{ text: string, start: number, duration: number }> = [];

  try {
    rawLines = await fetchWithYoutubeTranscript();
  } catch (err) {
    console.log("Fallback to youtubei.js for transcript");
    try {
      rawLines = await fetchWithYoutubei();
    } catch (fallbackErr) {
      console.log("Both methods failed");
      throw new Error("Video này không có phụ đề tiếng Nhật hoặc bị giới hạn quốc gia. Vui lòng thử link khác.");
    }
  }

  if (rawLines.length === 0) return [];

  // Sort by start time just in case
  rawLines.sort((a, b) => a.start - b.start);

  // Normalize durations to prevent overlaps
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    let end = line.start + line.duration;

    if (i < rawLines.length - 1) {
      const nextLine = rawLines[i + 1];
      // Clamp end to next line's start
      if (end > nextLine.start) {
        end = nextLine.start;
      }
      // If duration was 0, fill gap up to next line (max 5 seconds)
      if (line.duration <= 0) {
        end = Math.min(line.start + 5, nextLine.start);
      }
    } else {
      // Last line
      if (line.duration <= 0) end = line.start + 5;
    }

    line.duration = Math.max(0, end - line.start);
  }

  return rawLines;
}
