"use client";

import { useEffect, useState } from "react";

const STORE = "ger-quality";
const LEVELS = [
  ["low", "Бага"],
  ["medium", "Дунд"],
  ["high", "Өндөр"],
];

// Graphics quality (top left, under the music): low draws less for a smoother frame rate.
export default function Quality({ sceneRef }) {
  const [level, setLevel] = useState(() => {
    try {
      const v = localStorage.getItem(STORE);
      if (LEVELS.some(([k]) => k === v)) return v;
    } catch {}
    return "medium";
  });

  useEffect(() => {
    sceneRef.current?.setQuality(level);
    try {
      localStorage.setItem(STORE, level);
    } catch {}
  }, [sceneRef, level]);

  return (
    <fieldset className="quality">
      <legend>Чанар</legend>
      {LEVELS.map(([key, label]) => (
        <label key={key} className={level === key ? "on" : ""}>
          <input
            type="radio"
            name="quality"
            value={key}
            checked={level === key}
            onChange={() => setLevel(key)}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
