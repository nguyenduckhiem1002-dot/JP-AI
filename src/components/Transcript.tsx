import { useEffect, useRef, useState } from "react";
import { TranscriptLine } from "@/app/learn/page";

import { getActiveTranscriptIndex } from "@/lib/transcript";

interface TranscriptProps {
  lines: TranscriptLine[];
  currentTime: number;
  onLineClick: (time: number) => void;
  showFurigana: boolean;
  showRomaji: boolean;
  onNeedMoreLines?: (visibleIndices: number[]) => void;
  fontKanji?: number;
  fontFuri?: number;
  fontViet?: number;
}

export default function Transcript({ lines, currentTime, onLineClick, showFurigana, showRomaji, onNeedMoreLines, fontKanji = 23, fontFuri = 11, fontViet = 14.5 }: TranscriptProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const [activeWordData, setActiveWordData] = useState<{lineIdx: number, wordIdx: number, loading: boolean, data?: any} | null>(null);

  const currentLineIdx = getActiveTranscriptIndex(lines, currentTime);
  const prevLineIdxRef = useRef(-1);

  // Auto-scroll
  useEffect(() => {
    if (activeLineRef.current && currentLineIdx !== -1 && currentLineIdx !== prevLineIdxRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      prevLineIdxRef.current = currentLineIdx;
    }
  }, [currentLineIdx]);

  // Use IntersectionObserver to accurately detect which lines are visible
  // and pass that array up to trigger translation fetching
  useEffect(() => {
    if (!onNeedMoreLines || lines.length === 0 || !containerRef.current) return;

    const visibleIndices = new Set<number>();
    let timeoutId: NodeJS.Timeout;

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        entries.forEach(entry => {
          const idx = Number((entry.target as HTMLElement).dataset.index);
          if (entry.isIntersecting) {
            if (!visibleIndices.has(idx)) {
              visibleIndices.add(idx);
              changed = true;
            }
          } else {
            if (visibleIndices.has(idx)) {
              visibleIndices.delete(idx);
              changed = true;
            }
          }
        });

        if (changed) {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            onNeedMoreLines(Array.from(visibleIndices));
          }, 300); // debounce slightly to avoid spamming
        }
      },
      {
        root: document.getElementById('transcript-scroll-area'), // Use the actual scroll area as root
        rootMargin: '200px 0px 200px 0px', // trigger earlier, especially on fast scrolls
        threshold: 0
      }
    );

    const elements = containerRef.current.querySelectorAll('.gloss-line');
    elements.forEach(el => observer.observe(el));

    // Cleanup
    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, [lines.length, onNeedMoreLines]);

  const handleWordClick = async (e: React.MouseEvent, lineIdx: number, wordIdx: number, text: string, context: string) => {
    e.stopPropagation();
    if (activeWordData?.lineIdx === lineIdx && activeWordData?.wordIdx === wordIdx) {
      setActiveWordData(null); // toggle off
      return;
    }

    setActiveWordData({ lineIdx, wordIdx, loading: true });

    try {
      const apiKey = localStorage.getItem('gemini_api_key') || "";
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: text, context, apiKey })
      });
      const data = await res.json();
      setActiveWordData({ lineIdx, wordIdx, loading: false, data });
    } catch (err) {
      setActiveWordData({ lineIdx, wordIdx, loading: false, data: { meaning: "Lỗi kết nối", pos: "Lỗi" } });
    }
  };

  return (
    <div className="flex flex-col" ref={containerRef}>
      <div className="sticky top-0 z-[3] bg-[var(--paper)] flex items-center justify-between pt-[14px] pb-3 mb-0.5">
        <div className="flex items-center gap-2 font-sans text-[11.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B5E63" strokeWidth="1.6" className="opacity-55"><path d="M4 5h16M4 12h16M4 19h10"/></svg>
          Bản ghi
        </div>
        <div className="font-sans text-[11px] text-[var(--moss)] border border-[var(--moss)] rounded px-2 py-[3px]">
          click vào từ bất kỳ để tra nghĩa
        </div>
      </div>

      <div className="flex flex-col">
        {lines.map((line, idx) => {
          const isPast = currentLineIdx !== -1 && idx < currentLineIdx;
          const isCurrent = idx === currentLineIdx;

          // Safe fallback for un-tokenized lines
          const tokensToRender = (line.tokens && line.tokens.length > 0 && line.tokens[0].pos !== "Unknown")
            ? line.tokens
            : [{ text: line.text, pos: "Unknown" }];

          return (
            <div
              key={idx}
              data-index={idx}
              ref={isCurrent ? activeLineRef : null}
              className={`gloss-line grid grid-cols-[20px_22px_1fr] gap-2.5 px-2.5 py-4 -mx-2.5 border-b border-[var(--line-soft)] border-l-2 rounded-r-md cursor-pointer transition-colors duration-150 ${isCurrent ? 'bg-[var(--paper-current)] border-l-[var(--persimmon)]' : 'border-l-transparent hover:bg-[var(--line-soft)]'} ${isPast ? 'text-[var(--ink-past)]' : ''}`}
              onClick={() => onLineClick(line.start + 0.1)}
            >
              <div className={`font-sans text-xs pt-1 ${isPast ? 'text-[var(--ink-past)]' : 'text-[var(--persimmon)]'}`}>
                {(idx + 1).toString().padStart(2, '0')}
              </div>
              <div
                className="pt-0.5 relative group"
                onClick={(e) => {
                  e.stopPropagation();
                  onLineClick(line.start);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" className={`w-[15px] h-[15px] transition-colors duration-120 ${isCurrent ? 'stroke-[var(--persimmon)]' : 'stroke-[var(--ink-faint)] group-hover:stroke-[var(--indigo)]'}`}><path d="M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"/></svg>
              </div>
              <div className="min-w-0">
                <div
                  className={`font-[family-name:var(--font-jp)] font-semibold leading-[1.9] ${isPast ? 'text-[var(--ink-past)]' : 'text-[var(--ink)]'} ${!showFurigana ? 'no-furi' : ''}`}
                  style={{ fontFamily: "'Shippori Mincho', serif", fontSize: `${fontKanji}px` }}
                >
                  {tokensToRender.map((token, tIdx) => {
                    const isWordActive = activeWordData?.lineIdx === idx && activeWordData?.wordIdx === tIdx;
                    const isKaraokeActive = isCurrent && token.start !== undefined && token.end !== undefined
                      && currentTime >= token.start && currentTime < token.end;
                    const tokenClass = isKaraokeActive
                      ? "border-solid border-[var(--persimmon)] bg-[var(--paper-current)] text-[var(--persimmon)] rounded"
                      : isWordActive
                        ? "border-solid border-[var(--persimmon)] text-[var(--persimmon)]"
                        : "border-[var(--ink-faint)] hover:border-[var(--persimmon)]";

                    if (token.reading && token.reading !== token.text) {
                      return (
                        <ruby key={tIdx}>
                          <button
                            className={`cursor-pointer px-[1px] border-b-[1.5px] border-dotted transition-colors duration-120 bg-transparent ${tokenClass}`}
                            onClick={(e) => handleWordClick(e, idx, tIdx, token.text, line.text)}
                          >
                            {token.text}
                          </button>
                          {showFurigana && <rt className={isPast ? 'text-[var(--ink-past)]' : ''} style={{ fontSize: `${fontFuri}px` }}>{token.reading}</rt>}
                        </ruby>
                      );
                    }
                    return (
                      <button
                        key={tIdx}
                        className={`cursor-pointer px-[1px] border-b-[1.5px] border-dotted transition-colors duration-120 bg-transparent ${tokenClass}`}
                        onClick={(e) => handleWordClick(e, idx, tIdx, token.text, line.text)}
                      >
                        {token.text}
                      </button>
                    );
                  })}
                </div>

                {showRomaji && line.romaji && (
                  <div className={`font-sans tracking-[0.02em] mt-1 ${isPast ? 'text-[var(--ink-past)]' : 'text-[var(--ink-faint)]'}`} style={{ fontSize: `${Math.round(fontViet * 0.85)}px` }}>
                    {line.romaji}
                  </div>
                )}

                {line.translation && (
                  <div className={`font-serif mt-1.25 ${isPast ? 'text-[var(--ink-past)]' : 'text-[var(--ink-soft)]'}`} style={{ fontFamily: "'Source Serif 4', serif", fontSize: `${fontViet}px` }}>
                    {line.translation}
                  </div>
                )}

                {/* Loading state for chunk translation */}
                {line.isTranslated === false && (
                  <div className="font-sans text-[var(--indigo)] italic mt-1 animate-pulse" style={{ fontSize: `${Math.round(fontViet * 0.75)}px` }}>
                    Đang phân tích cấu trúc...
                  </div>
                )}

                {activeWordData?.lineIdx === idx && (
                  <div className="flex mt-2.5 px-3 py-2.5 bg-white border-l-2 border-[var(--persimmon)] rounded-r-[var(--radius-s)] font-sans text-[var(--ink-soft)] leading-[1.6] items-center justify-between gap-2.5 shadow-sm" style={{ fontSize: `${Math.round(fontViet * 0.85)}px` }}>
                    {activeWordData.loading ? (
                      <span className="italic" style={{ fontSize: `${Math.round(fontViet * 0.75)}px` }}>Đang tra cứu...</span>
                    ) : (
                      <>
                        <span className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="text-[var(--moss)]" style={{ fontSize: `${Math.round(fontViet * 0.75)}px` }}>{activeWordData.data?.pos}</span>
                          <b className="font-[family-name:var(--font-jp)] text-[var(--ink)] font-semibold" style={{ fontFamily: "'Shippori Mincho', serif", fontSize: `${Math.round(fontKanji * 0.65)}px` }}>{tokensToRender[activeWordData.wordIdx]?.text}</b>
                          {activeWordData.data?.reading && <span className="text-[var(--ink-soft)] mr-1" style={{ fontSize: `${Math.round(fontViet * 0.75)}px` }}>({activeWordData.data.reading})</span>}
                          <span>{activeWordData.data?.meaning}</span>
                        </span>
                        {/* Lưu từ vựng sẽ được implement sau, tạm ẩn */}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="mt-10 pt-4 border-t border-[var(--line)] font-sans text-[11px] text-[var(--ink-faint)] flex justify-between pb-8">
        <span>AI Language Learner</span>
        <span>Shippori Mincho / Noto Sans JP / Source Serif 4</span>
      </footer>
    </div>
  );
}
