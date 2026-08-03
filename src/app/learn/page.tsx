"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Header from "@/components/Header";
import VideoIntake from "@/components/VideoIntake";
import VideoPlayer from "@/components/VideoPlayer";
import Transcript from "@/components/Transcript";

import { getActiveTranscriptIndex } from "@/lib/transcript";

export type TranscriptLine = {
  start: number;
  duration: number;
  text: string; // Original text (Kanji)
  romaji: string;
  translation: string;
  isTranslated?: boolean;
  tokens: { text: string; reading?: string; pos: string; meaning?: string; start?: number; end?: number }[];
};

export default function LearnPage() {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [transcriptData, setTranscriptData] = useState<TranscriptLine[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [showFurigana, setShowFurigana] = useState(true);
  const [showRomaji, setShowRomaji] = useState(true);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [showSearchBox, setShowSearchBox] = useState(true);

  // Use a ref to access latest transcriptData inside the observer callback without causing re-renders
  const transcriptDataRef = useRef<TranscriptLine[] | null>(null);
  useEffect(() => {
    transcriptDataRef.current = transcriptData;
  }, [transcriptData]);

  // Font settings
  const [fontKanji, setFontKanji] = useState(23);
  const [fontFuri, setFontFuri] = useState(11);
  const [fontViet, setFontViet] = useState(14.5);

  useEffect(() => {
    const savedSize = localStorage.getItem('app_font_size');
    if (savedSize) {
      try {
        const sizes = JSON.parse(savedSize);
        if (sizes.kanji) setFontKanji(sizes.kanji);
        if (sizes.furi) setFontFuri(sizes.furi);
        if (sizes.viet) setFontViet(sizes.viet);
      } catch {
        // ignore
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track which chunks we are currently translating to avoid duplicate requests
  const translatingChunksRef = useRef<Set<number>>(new Set());
  const requestGenerationRef = useRef(0);

  const handleUrlSubmit = async (url: string) => {
    let vidId = "";
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname.includes("youtube.com")) {
        vidId = urlObj.searchParams.get("v") || "";
      } else if (urlObj.hostname.includes("youtu.be")) {
        vidId = urlObj.pathname.slice(1);
      }
    } catch {
      setError("Link sai định dạng");
      return;
    }

    if (!vidId) {
      setError("Không tìm thấy video ID");
      return;
    }

    setVideoId(vidId);
    setIsLoading(true);
    setError(null);
    setTranscriptData(null);
    setShowSearchBox(false);
    translatingChunksRef.current.clear(); // Reset translation state for new video
    requestGenerationRef.current += 1;
    const currentGen = requestGenerationRef.current;

    try {
      const apiKey = localStorage.getItem('gemini_api_key') || "";
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: vidId, apiKey }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Không lấy được phụ đề cho video này.");
      }

      const data = await res.json();
      if (currentGen !== requestGenerationRef.current) return;
      if (!data.transcript || data.transcript.length === 0) {
        throw new Error("Video không có transcript tiếng Nhật.");
      }
      setTranscriptData(data.transcript);
    } catch (err: any) {
      if (currentGen !== requestGenerationRef.current) return;
      setError(err.message || "Đã xảy ra lỗi");
      setShowSearchBox(true);
    } finally {
      if (currentGen === requestGenerationRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleNeedMoreLines = useCallback((visibleIndices: number[]) => {
    // We cannot use await directly with state setter if we rely on its latest value inside
    // So we use functional state update to always get the freshest transcriptData
    setTranscriptData(prevData => {
      if (!prevData || visibleIndices.length === 0) return prevData;

      const maxVisibleIndex = Math.max(...visibleIndices);
      const minVisibleIndex = Math.min(...visibleIndices);

      const chunkSize = 20;
      const minChunkStart = Math.max(0, Math.floor(minVisibleIndex / chunkSize) * chunkSize - chunkSize);
      const maxChunkStart = Math.floor(maxVisibleIndex / chunkSize) * chunkSize;
      const lookaheadChunkStart = maxChunkStart + chunkSize;

      const chunksToLoad = new Set<number>();
      for (let i = minChunkStart; i <= lookaheadChunkStart; i += chunkSize) {
        chunksToLoad.add(i);
      }
      console.log("Chunks to load:", Array.from(chunksToLoad));
      let shouldFetch = false;
      const chunksThatNeedFetch: number[] = [];

      for (const chunkStart of chunksToLoad) {
        if (chunkStart >= prevData.length) continue;
        const chunkEnd = Math.min(chunkStart + chunkSize, prevData.length);

        let needsTranslation = false;
        for (let i = chunkStart; i < chunkEnd; i++) {
          if (!prevData[i].isTranslated) {
            needsTranslation = true;
            break;
          }
        }

        if (needsTranslation && !translatingChunksRef.current.has(chunkStart)) {
          translatingChunksRef.current.add(chunkStart);
          chunksThatNeedFetch.push(chunkStart);
          shouldFetch = true;
        }
      }

      if (shouldFetch) {
        const currentGen = requestGenerationRef.current;
        // Fire async fetch out of band so we don't block the render cycle
        setTimeout(async () => {
          for (const chunkStart of chunksThatNeedFetch) {
            // Read from latest ref to get actual original array indices properly
            const freshestData = transcriptDataRef.current;
            if (!freshestData) continue;

            const chunkEnd = Math.min(chunkStart + chunkSize, freshestData.length);

            // Map the exact indices from the actual position in the array
            const actualLinesToTranslate = freshestData.slice(chunkStart, chunkEnd).map((l, i) => ({
              index: chunkStart + i,
              text: l.text,
              start: l.start,
              duration: l.duration
            }));

            try {
              const apiKey = localStorage.getItem('gemini_api_key') || "";
              const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lines: actualLinesToTranslate, apiKey })
              });

              if (!res.ok) throw new Error("Translation failed");

              const { translated } = await res.json();
              if (currentGen !== requestGenerationRef.current) return;

              setTranscriptData(currentData => {
                if (!currentData) return currentData;
                const newData = [...currentData];
                translated.forEach((t: any) => {
                  if (newData[t.index]) {
                    newData[t.index] = {
                      ...newData[t.index],
                      tokens: t.tokens && t.tokens.length > 0 ? t.tokens : newData[t.index].tokens,
                      romaji: t.romaji,
                      translation: t.translation,
                      isTranslated: t.isTranslated !== undefined ? t.isTranslated : true
                    };
                  }
                });
                return newData;
              });
            } catch (err) {
              if (currentGen !== requestGenerationRef.current) return;
              console.error("Lazy load translation error", err);
              setTranscriptData(currentData => {
                if (!currentData) return currentData;
                const newData = [...currentData];
                for (let i = chunkStart; i < chunkEnd; i++) {
                  if (newData[i] && !newData[i].isTranslated) {
                    newData[i] = {
                      ...newData[i],
                      romaji: "Lỗi kết nối API",
                      translation: "Không thể dịch đoạn này",
                      isTranslated: true
                    };
                  }
                }
                return newData;
              });
            } finally {
              if (currentGen === requestGenerationRef.current) {
                translatingChunksRef.current.delete(chunkStart);
              }
            }
          }
        }, 0);
      }

      return prevData;
    });
  }, []); // Functional set state is safe

  const currentLineIdx = transcriptData ? getActiveTranscriptIndex(transcriptData, currentTime) : -1;
  const currentLine = currentLineIdx !== -1 && transcriptData ? transcriptData[currentLineIdx] : undefined;

  // Calculate translation progress
  const totalLines = transcriptData?.length || 0;
  const translatedCount = transcriptData?.filter(l => l.isTranslated && l.translation && l.translation !== '(Nhập API key để hiện bản dịch)').length || 0;
  const progressPercent = totalLines > 0 ? (translatedCount / totalLines) * 100 : 0;

  return (
    <div className="relative z-10 max-w-[760px] mx-auto px-6 h-[100dvh] flex flex-col">
      <div className="flex-none">
        <Header
          onShowSearch={() => setShowSearchBox(!showSearchBox)}
          fontKanji={fontKanji}
          fontFuri={fontFuri}
          fontViet={fontViet}
          onFontChange={(type, val) => {
            if (type === 'kanji') setFontKanji(val);
            if (type === 'furi') setFontFuri(val);
            if (type === 'viet') setFontViet(val);
          }}
        />

        {showSearchBox && !isLoading && (
          <VideoIntake onSubmit={handleUrlSubmit} error={error} />
        )}

        {isLoading && (
          <div className="my-8 flex flex-col items-center gap-3">
            <div className="text-[var(--ink-soft)] font-sans text-sm">
              Đang phân tích cấu trúc ngữ pháp...
            </div>
            {/* Indeterminate loading bar */}
            <div className="w-full max-w-[200px] h-1.5 bg-[var(--line)] rounded-full overflow-hidden relative">
              <div className="absolute top-0 bottom-0 left-0 bg-[var(--persimmon)] w-1/3 rounded-full animate-[pulse_1s_ease-in-out_infinite] blur-[1px]"></div>
            </div>
          </div>
        )}

        {videoId && transcriptData && (
          <div className="mt-2 mb-2">
            <VideoPlayer
              videoId={videoId}
              currentLine={currentLine}
              showFurigana={showFurigana}
              showRomaji={showRomaji}
              onTimeUpdate={setCurrentTime}
              onToggleFurigana={() => setShowFurigana(!showFurigana)}
              onToggleRomaji={() => setShowRomaji(!showRomaji)}
              seekTo={seekTo}
              onSeeked={() => setSeekTo(null)}
            />

            <div className="flex items-center justify-between mt-2">
              <div className="font-sans text-[11px] text-[var(--ink-faint)]">
                Phím tắt: <kbd className="font-sans text-[10.5px] border border-[var(--line)] rounded-[3px] px-1.5 py-[1px] bg-white">Space</kbd> phát/tạm dừng · <kbd className="font-sans text-[10.5px] border border-[var(--line)] rounded-[3px] px-1.5 py-[1px] bg-white">←</kbd> <kbd className="font-sans text-[10.5px] border border-[var(--line)] rounded-[3px] px-1.5 py-[1px] bg-white">→</kbd> lùi/tới câu
              </div>

              {/* Progress Bar for Translation */}
              <div className="flex items-center gap-2" title={`Tiến độ dịch: ${translatedCount}/${totalLines} câu`}>
                <span className="font-sans text-[10px] text-[var(--ink-faint)]">Dịch</span>
                <div className="w-24 h-1.5 bg-[var(--line)] rounded-full overflow-hidden relative">
                  <div
                    className="absolute top-0 left-0 bottom-0 bg-[var(--moss)] transition-all duration-500 ease-out rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {transcriptData && (
        <div id="transcript-scroll-area" className="flex-1 min-h-0 overflow-y-auto scroll-area">
          <Transcript
            lines={transcriptData}
            currentTime={currentTime}
            onLineClick={(time) => setSeekTo(time)}
            showFurigana={showFurigana}
            showRomaji={showRomaji}
            onNeedMoreLines={handleNeedMoreLines}
            fontKanji={fontKanji}
            fontFuri={fontFuri}
            fontViet={fontViet}
          />
        </div>
      )}
    </div>
  );
}
