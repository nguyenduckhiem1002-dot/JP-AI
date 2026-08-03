"use client";

import { useEffect, useRef, useState } from "react";
import YouTube, { YouTubeEvent, YouTubePlayer } from "react-youtube";
import { TranscriptLine } from "@/app/learn/page";

interface VideoPlayerProps {
  videoId: string;
  currentLine?: TranscriptLine;
  showFurigana: boolean;
  showRomaji: boolean;
  onTimeUpdate: (time: number) => void;
  onToggleFurigana: () => void;
  onToggleRomaji: () => void;
  seekTo: number | null;
  onSeeked: () => void;
}

export default function VideoPlayer({
  videoId,
  currentLine,
  showFurigana,
  showRomaji,
  onTimeUpdate,
  onToggleFurigana,
  onToggleRomaji,
  seekTo,
  onSeeked
}: VideoPlayerProps) {
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const hideCaptions = (player: any) => {
    if (!player) return;
    try {
      player.unloadModule('captions');
      player.unloadModule('cc');
    } catch (e) {}
    try {
      player.setOption('captions', 'track', { languageCode: '' });
      player.setOption('cc', 'track', { languageCode: '' });
    } catch (e) {}
  };

  const onReady = (event: YouTubeEvent) => {
    playerRef.current = event.target;
    setDuration(event.target.getDuration());
    hideCaptions(event.target);
  };

  const onStateChange = (event: YouTubeEvent) => {
    // 1 = playing, 2 = paused, 3 = buffering
    setIsPlaying(event.data === 1);
    if (event.data === 1) {
      hideCaptions(event.target);
    }
  };

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        if (playerRef.current) {
          const time = playerRef.current.getCurrentTime();
          setCurrentTime(time);
          onTimeUpdate(time);
          hideCaptions(playerRef.current); // aggressively hide just in case
        }
      }, 100);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, onTimeUpdate]);

  useEffect(() => {
    if (seekTo !== null && playerRef.current) {
      playerRef.current.seekTo(seekTo, true);
      setCurrentTime(seekTo);
      onTimeUpdate(seekTo);
      if (!isPlaying) playerRef.current.playVideo();
      onSeeked();
    }
  }, [seekTo, isPlaying, onTimeUpdate, onSeeked]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (playerRef.current) {
          if (isPlaying) playerRef.current.pauseVideo();
          else playerRef.current.playVideo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying]);

  const togglePlay = () => {
    if (playerRef.current) {
      if (isPlaying) playerRef.current.pauseVideo();
      else playerRef.current.playVideo();
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="border border-[var(--line)] rounded-[var(--radius-m)] overflow-hidden bg-[#1C1E22]">
      <div className="aspect-[16/9] relative flex items-center justify-center bg-[repeating-linear-gradient(135deg,#24262b_0_2px,#1c1e22_2px_4px)] overflow-hidden">

        {/* Actual YouTube player, styled to hide controls but keep video visible */}
        <div className="absolute inset-0 pointer-events-none">
          <YouTube
            videoId={videoId}
            opts={{
              height: '100%',
              width: '100%',
              playerVars: {
                controls: 0,
                disablekb: 1,
                modestbranding: 1,
                rel: 0,
                showinfo: 0,
                cc_load_policy: 0, // Explicitly tell YT not to load CC
                iv_load_policy: 3, // Turn off video annotations
                fs: 0,
                hl: "vi" // Change UI lang to vi
              },
            }}
            onReady={onReady}
            onStateChange={onStateChange}
            className="w-full h-full"
          />
        </div>

        {/* Play/Pause Button Overlay */}
        <button
          aria-label={isPlaying ? "Tạm dừng" : "Phát"}
          onClick={togglePlay}
          className="w-[52px] h-[52px] rounded-full border-[1.5px] border-white/70 bg-white/10 flex items-center justify-center cursor-pointer transition-transform duration-75 z-10 hover:bg-white/20 active:scale-[0.94] pointer-events-auto"
        >
          {isPlaying ? (
            <svg width="16" height="18" viewBox="0 0 16 18" fill="#fff"><rect x="1" y="0" width="5" height="18"/><rect x="10" y="0" width="5" height="18"/></svg>
          ) : (
            <svg width="16" height="18" viewBox="0 0 16 18" fill="#fff"><path d="M0 0L16 9L0 18V0Z"/></svg>
          )}
        </button>

        {/* Hack: The native CC might still show sometimes due to YT iframe API quirks.
            This CSS forces captions inside the iframe to hide if they are injected.
            But we cannot inject CSS into cross-origin iframe.
            The `cc_load_policy: 0` is the best we can do. */}
      </div>

      {/* Control Bar */}
      <div className="flex items-center gap-3 px-4 py-[11px] bg-[#1C1E22]">
        <span className="font-sans text-[11px] text-white/55 min-w-[78px]">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          aria-label="Thanh thời gian"
          className="flex-1 h-[3px] bg-white/20 rounded-sm cursor-pointer appearance-none accent-[var(--persimmon-soft)]"
          onChange={(e) => {
            const newTime = parseFloat(e.target.value);
            if (playerRef.current) {
              playerRef.current.seekTo(newTime, true);
              setCurrentTime(newTime);
              onTimeUpdate(newTime);
            }
          }}
        />
        <select
          className="font-sans text-[11px] text-white/70 bg-white/10 border border-white/20 rounded px-1.5 py-[3px] cursor-pointer outline-none"
          onChange={(e) => {
            if (playerRef.current) {
              playerRef.current.setPlaybackRate(parseFloat(e.target.value));
            }
          }}
          defaultValue="1"
        >
          <option value="0.5" className="text-black">0.5×</option>
          <option value="0.75" className="text-black">0.75×</option>
          <option value="1" className="text-black">1×</option>
        </select>
        <button
          onClick={onToggleFurigana}
          className={`bg-transparent border-none cursor-pointer p-0.5 flex transition-colors duration-100 ${showFurigana ? 'text-[var(--persimmon-soft)]' : 'text-white/70 hover:text-white'}`}
          title="Ẩn/hiện Furigana"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h10M4 12h6M4 17h16"/></svg>
        </button>
        <button
          onClick={onToggleRomaji}
          className={`bg-transparent border-none cursor-pointer p-0.5 flex transition-colors duration-100 ${showRomaji ? 'text-[var(--persimmon-soft)]' : 'text-white/70 hover:text-white'}`}
          title="Ẩn/hiện Romaji"
        >
          <span className="font-sans text-[11px] font-bold">R</span>
        </button>
      </div>
    </div>
  );
}
