"use client";

import { useRef, useState } from "react";

const R = 44; // how far the knob travels from the centre, px

// A thumb stick for walking inside the ger on a phone (bottom left): push the knob the way to go.
export default function TouchStick({ sceneRef }) {
  const base = useRef(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const move = (e) => {
    const r = base.current.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2),
      y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y);
    if (d > R) ((x *= R / d), (y *= R / d));
    setKnob({ x, y });
    sceneRef.current?.setWalkAxis(x / R, y / R);
  };
  const stop = () => {
    setKnob({ x: 0, y: 0 });
    sceneRef.current?.setWalkAxis(0, 0);
  };

  return (
    <div
      ref={base}
      className="stick"
      aria-hidden="true"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => e.buttons && move(e)}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <span style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
