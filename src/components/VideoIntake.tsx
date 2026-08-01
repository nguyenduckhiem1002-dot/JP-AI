import { useState } from "react";

export default function VideoIntake({ 
  onSubmit, 
  error 
}: { 
  onSubmit: (url: string) => void;
  error: string | null;
}) {
  const [url, setUrl] = useState("");

  return (
    <div className="mt-4 mb-2">
      <label className="font-sans text-[11.5px] uppercase tracking-[0.08em] text-[var(--ink-faint)] mb-2 block">
        Dán liên kết video
      </label>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className={`flex-1 font-sans text-sm text-[var(--ink)] bg-white border rounded-[var(--radius-s)] px-3.5 py-[11px] outline-none transition-colors duration-150 ${error ? 'border-[var(--persimmon)]' : 'border-[var(--line)] focus:border-[var(--indigo)]'}`}
        />
        <button 
          onClick={() => onSubmit(url)}
          className="font-sans text-[13.5px] font-medium rounded-[var(--radius-s)] border border-[var(--indigo)] bg-[var(--indigo)] text-white px-5 py-[11px] cursor-pointer transition-transform duration-75 hover:bg-[var(--indigo-soft)] active:scale-[0.98] whitespace-nowrap"
        >
          Tải dữ liệu
        </button>
      </div>
      {error && (
        <div className="font-sans text-xs text-[var(--persimmon)] mt-2 mx-[2px] block">
          {error}
        </div>
      )}
    </div>
  );
}
