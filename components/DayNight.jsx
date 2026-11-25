"use client";

import { useEffect, useRef, useState } from "react";

// Day cycle bar (top right): ☀ Өдөр ───●─── ☾ Шөнө, then any extra buttons passed as children.
// The sky does not run by itself: only the slider and the two buttons move it.
// The slider is the time of the cycle: left half day (sunrise → sunset), right half night.
export default function DayNight({ sceneRef, children }) {
  const [state, setState] = useState({ time: 0, night: false, phase: "" });
  const dragging = useRef(false);

  // keep the knob and labels in step with the sky
  useEffect(() => {
    const id = setInterval(() => {
      const gs = sceneRef.current;
      if (!gs || dragging.current) return;
      const sky = gs.sky;
      setState({
        time: sky.getTime(),
        night: sky.isNight(),
        phase: sky.phaseName(),
      });
    }, 100);
    return () => clearInterval(id);
  }, [sceneRef]);

  const sky = () => sceneRef.current?.sky;

  return (
    <>
      <div className="daynight" role="group" aria-label="Өдөр / шөнө">
        <button
          type="button"
          className={state.night ? "" : "on"}
          aria-label="Өдөр"
          onClick={(e) => {
            sky()?.setNight(false);
            e.currentTarget.blur();
          }}
        >
          <svg className="line" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
          <span className="lbl">Өдөр</span>
        </button>
        <input
          type="range"
          min="0"
          max="1000"
          step="1"
          aria-label="Өдрийн цаг"
          aria-valuetext={state.phase}
          value={Math.round(state.time * 1000)}
          onPointerDown={() => (dragging.current = true)}
          onPointerUp={(e) => {
            dragging.current = false;
            e.currentTarget.blur();
          }}
          onChange={(e) => {
            const t = e.target.value / 1000;
            sky()?.setTime(t);
            setState((s) => ({ ...s, time: t }));
          }}
        />
        <button
          type="button"
          className={state.night ? "on" : ""}
          aria-label="Шөнө"
          onClick={(e) => {
            sky()?.setNight(true);
            e.currentTarget.blur();
          }}
        >
          <svg className="line" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
          <span className="lbl">Шөнө</span>
        </button>
        {children && <span className="sep" aria-hidden="true" />}
        {children}
      </div>
    </>
  );
}
