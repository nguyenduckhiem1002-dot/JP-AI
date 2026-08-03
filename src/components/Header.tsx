import { useState, useEffect } from "react";

export default function Header({
  onShowSearch,
  fontKanji = 23,
  fontFuri = 11,
  fontViet = 14.5,
  onFontChange
}: {
  onShowSearch?: () => void,
  fontKanji?: number,
  fontFuri?: number,
  fontViet?: number,
  onFontChange?: (type: 'kanji'|'furi'|'viet', val: number) => void
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [localKanji, setLocalKanji] = useState(fontKanji);
  const [localFuri, setLocalFuri] = useState(fontFuri);
  const [localViet, setLocalViet] = useState(fontViet);

  // Initialize local state lazily for localStorage to avoid hydration mismatch
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedKey = localStorage.getItem('gemini_api_key');
      if (savedKey) setApiKey(savedKey);

      const savedSize = localStorage.getItem('app_font_size');
      if (savedSize && onFontChange) {
        try {
          const sizes = JSON.parse(savedSize);
          if (sizes.kanji) { setLocalKanji(sizes.kanji); onFontChange('kanji', sizes.kanji); }
          if (sizes.furi) { setLocalFuri(sizes.furi); onFontChange('furi', sizes.furi); }
          if (sizes.viet) { setLocalViet(sizes.viet); onFontChange('viet', sizes.viet); }
        } catch {
          // fallback if old format
          const multiplier = parseFloat(savedSize);
          if (!isNaN(multiplier)) {
            onFontChange('kanji', 23 * multiplier);
            onFontChange('furi', 11 * multiplier);
            onFontChange('viet', 14.5 * multiplier);
          }
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettings = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    localStorage.setItem('app_font_size', JSON.stringify({ kanji: localKanji, furi: localFuri, viet: localViet }));
    if (onFontChange) {
      onFontChange('kanji', localKanji);
      onFontChange('furi', localFuri);
      onFontChange('viet', localViet);
    }
    setShowSettings(false);
  };

  return (
    <header className="flex items-center justify-between pt-3.5 pb-2.5 border-b border-[var(--line)] relative">
      <div className="flex items-baseline gap-[9px]">
        <svg className="w-5 h-5 flex-none" viewBox="0 0 30 30" fill="none">
          <path d="M15 3 C15 3 15 14 15 27" stroke="#23262B" strokeWidth="1.4"/>
          <path d="M5 9 C5 9 15 6 25 9" stroke="#23262B" strokeWidth="1.4"/>
          <path d="M6 20 C6 20 15 25 24 20" stroke="#B85A34" strokeWidth="1.4"/>
        </svg>
        <div className="font-[family-name:var(--font-jp)] font-semibold text-[15px] tracking-wide" style={{ fontFamily: "'Shippori Mincho', serif" }}>
          AI Language Learner
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="font-sans text-[10.5px] font-medium tracking-[0.03em] text-[var(--indigo)] border border-[var(--indigo)] rounded pt-[3px] pb-[3px] px-[7px]">
          日本語・中文
        </div>
        <div className="flex items-center gap-1">
          {onShowSearch && (
            <button
              onClick={onShowSearch}
              className="text-[var(--ink-soft)] hover:text-[var(--ink)] p-1 rounded transition-colors"
              title="Tìm video mới"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-[var(--ink-soft)] hover:text-[var(--ink)] p-1 rounded transition-colors"
            title="Cài đặt"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="absolute top-12 right-0 bg-white border border-[var(--line)] rounded-md shadow-sm p-4 z-50 w-72">
          <label className="block font-sans text-xs font-medium text-[var(--ink)] mb-2">Gemini API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full border border-[var(--line)] rounded px-2.5 py-1.5 text-sm font-sans mb-4 outline-none focus:border-[var(--indigo)]"
            placeholder="AIzaSy..."
          />

          <label className="block font-sans text-xs font-medium text-[var(--ink)] mb-2">Cỡ chữ Kanji</label>
          <div className="flex items-center gap-3 mb-4">
            <span className="font-sans text-xs text-[var(--ink-faint)]">A</span>
            <input
              type="range"
              min="14" max="40" step="1"
              value={localKanji}
              onChange={(e) => setLocalKanji(parseFloat(e.target.value))}
              className="flex-1 accent-[var(--indigo)]"
            />
            <span className="font-sans text-sm text-[var(--ink-soft)] font-semibold">A</span>
          </div>

          <label className="block font-sans text-xs font-medium text-[var(--ink)] mb-2">Cỡ chữ Furigana</label>
          <div className="flex items-center gap-3 mb-4">
            <span className="font-sans text-xs text-[var(--ink-faint)]">A</span>
            <input
              type="range"
              min="8" max="20" step="1"
              value={localFuri}
              onChange={(e) => setLocalFuri(parseFloat(e.target.value))}
              className="flex-1 accent-[var(--indigo)]"
            />
            <span className="font-sans text-sm text-[var(--ink-soft)] font-semibold">A</span>
          </div>

          <label className="block font-sans text-xs font-medium text-[var(--ink)] mb-2">Cỡ chữ Dịch & Romaji</label>
          <div className="flex items-center gap-3 mb-4">
            <span className="font-sans text-xs text-[var(--ink-faint)]">A</span>
            <input
              type="range"
              min="10" max="24" step="1"
              value={localViet}
              onChange={(e) => setLocalViet(parseFloat(e.target.value))}
              className="flex-1 accent-[var(--indigo)]"
            />
            <span className="font-sans text-sm text-[var(--ink-soft)] font-semibold">A</span>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setLocalKanji(fontKanji);
                setLocalFuri(fontFuri);
                setLocalViet(fontViet);
                setShowSettings(false);
              }}
              className="px-3 py-1.5 text-xs font-sans text-[var(--ink-soft)] hover:text-[var(--ink)] transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={saveSettings}
              className="px-3 py-1.5 text-xs font-sans bg-[var(--indigo)] text-white rounded hover:bg-[var(--indigo-soft)] transition-colors"
            >
              Lưu
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
