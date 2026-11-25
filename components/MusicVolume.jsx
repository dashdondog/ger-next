"use client";

import { useState } from "react";

// Music volume (top left): a note button that turns the music off / back on, and a slider.
export default function MusicVolume({ sfxRef }) {
  const [volume, setVolume] = useState(() => sfxRef.current?.getMusicVolume() ?? 0.5);
  const [last, setLast] = useState(volume || 0.5); // where "on" goes back to
  const set = (v) => {
    sfxRef.current?.setMusicVolume(v);
    setVolume(v);
    if (v > 0) setLast(v);
  };
  const off = volume === 0;

  return (
    <div className="music" role="group" aria-label="Хөгжим">
      <button
        type="button"
        className={off ? "" : "on"}
        aria-label={off ? "Хөгжим асаах" : "Хөгжим унтраах"}
        aria-pressed={!off}
        onClick={(e) => {
          set(off ? last : 0);
          e.currentTarget.blur();
        }}
      >
        <svg className="line" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 18V5l11-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="17" cy="16" r="3" />
          {off && <path d="M3 3l18 18" />}
        </svg>
      </button>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        aria-label="Хөгжмийн дуу"
        aria-valuetext={off ? "Унтраалттай" : `${Math.round(volume * 100)}%`}
        value={Math.round(volume * 100)}
        style={{ "--fill": `${volume * 100}%` }}
        onChange={(e) => set(e.target.value / 100)}
        onPointerUp={(e) => e.currentTarget.blur()}
      />
    </div>
  );
}
