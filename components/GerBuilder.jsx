"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BARE } from "../lib/bare";
import { STEPS } from "../lib/steps";
import { createSfx } from "../lib/sound";
import DayNight from "./DayNight";
import MusicVolume from "./MusicVolume";
import Quality from "./Quality";
import Thanks from "./Thanks";
import TouchStick from "./TouchStick";

const LAST = STEPS.length;

export default function GerBuilder() {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const sfxRef = useRef(null);
  const [muted, setMuted] = useState(false);
  const [intro, setIntro] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // a part is still going in: the next card waits until its animation has finished
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [inside, setInside] = useState(false);
  const [moving, setMoving] = useState(false); // the camera is flying in or out
  const [nearDoor, setNearDoor] = useState(false); // inside, standing at the door: "leave" shows
  const [locked, setLocked] = useState(false); // inside, the mouse is captured for looking round
  const [reading, setReading] = useState(false); // inside, the map is open and the camera on it
  const [touch, setTouch] = useState(false); // a phone or tablet: drag to look, a stick to walk
  useEffect(() => setTouch(matchMedia("(pointer: coarse)").matches), []);
  const [page, setPage] = useState(null); // the unrolled map's place on screen: the page sits on it
  // the part cards, in a random order (picked once; the right one is always the next step)
  const [deck] = useState(() => STEPS.map((_, i) => i).sort(() => Math.random() - 0.5));

  useEffect(() => {
    let disposed = false;
    let gs;
    const sfx = (sfxRef.current = createSfx());
    setMuted(sfx.isMuted());
    // three touches window and WebGL, so it is loaded in the browser only
    import("../lib/gerScene").then(({ GerScene }) => {
      if (disposed) return;
      gs = sceneRef.current = new GerScene(canvasRef.current, setProgress);
      if (!BARE) {
        gs.onDoor = (open) => sfx.door(open);
        gs.onMapRoll = (open, ms) => sfx.paper(open, ms / 1000);
      }
      gs.onNearDoor = setNearDoor;
      gs.onLock = setLocked;
      gs.onMapFocus = setReading;
      gs.onMapShown = (shown) => setPage(shown ? gs.mapRect() : null);
      gs.onStepDone = () => {
        busyRef.current = false;
        setBusy(false);
      };
      gs.load().then(() => {
        if (disposed) return;
        // ?step=N opens at step N; adding &play plays that step's animation
        const params = new URLSearchParams(window.location.search);
        const q = parseInt(params.get("step") ?? "0", 10);
        const s = Number.isNaN(q) ? 0 : Math.min(LAST, Math.max(0, q));
        // ?cam=x,y,z,tx,ty,tz sets the view (handy for sharing a particular angle)
        const cam = params.get("cam")?.split(",").map(Number);
        if (cam?.length === 6 && cam.every(Number.isFinite)) gs.setView(cam);
        // dev only: getView() in the console prints the current view as x,y,z,tx,ty,tz
        if (process.env.NODE_ENV === "development") {
          window.getView = () => gs.getView().join(",");
          window.gerScene = gs; // for poking at the scene from the console
        }
        // the intro is skipped for shared links that ask for a step or a view, and in bare mode
        if (BARE) {
          setReady(true);
          return;
        }
        if (!params.has("step") && !cam) {
          gs.showIntro();
          setIntro(true);
        } else gs.goTo(s, params.has("play"));
        stepRef.current = s;
        setStep(s);
        setReady(true);
      });
    });
    return () => {
      disposed = true;
      gs?.dispose();
      sfx.dispose();
      sceneRef.current = null;
    };
  }, []);

  // runs inside the click / key handler, so the sound may start (browsers need a user gesture)
  const go = useCallback((next) => {
    const cur = stepRef.current;
    const s = Math.min(LAST, Math.max(0, next(cur)));
    const forward = s === cur + 1;
    if (forward && busyRef.current) return; // wait for the part going in
    busyRef.current = forward && s > 0;
    setBusy(busyRef.current);
    sceneRef.current?.goTo(s, forward);
    if (forward) sfxRef.current?.play(s - 1);
    else sfxRef.current?.stop();
    stepRef.current = s;
    setStep(s);
  }, []);

  // the camera flies in while the glass clears, then the intro goes away
  const start = useCallback(() => {
    const ms = sceneRef.current?.leaveIntro() ?? 0;
    sfxRef.current?.land(ms / 1000); // a rush of air as the camera glides down
    setLeaving(true);
    setTimeout(() => {
      setIntro(false);
      setLeaving(false);
    }, 700);
  }, []);

  // once the ger is built, the UI steps aside (only "rebuild" stays): the sky turns by itself and
  // the ger can be orbited, zoomed and its door opened
  const built = ready && !intro && step === LAST && !busy;
  const walk = useCallback((goIn) => {
    const gs = sceneRef.current;
    if (!gs) return;
    const ms = goIn ? gs.enterGer() : gs.leaveGer();
    setInside(goIn);
    setMoving(true);
    setTimeout(() => setMoving(false), ms);
  }, []);
  useEffect(() => {
    sceneRef.current?.setChill(built);
  }, [built]);

  useEffect(() => {
    if (!page) return;
    const onResize = () => setPage(sceneRef.current?.mapRect() ?? null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [page]);

  // crickets come in with the night
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const gs = sceneRef.current;
      if (gs) sfxRef.current?.setNight(gs.sky.nightAmount());
    }, 500);
    return () => clearInterval(id);
  }, [ready]);

  useEffect(() => {
    if (!ready || intro) return;
    const onKey = (e) => {
      sceneRef.current?.poke();
      if (sceneRef.current?.inside) {
        // inside the ger the keys walk (W A S D), not build; E at the door goes out
        if (e.code === "KeyE" && sceneRef.current.nearDoor) walk(false);
        return;
      }
      if (BARE) return; // bare mode: only going in and out (W A S D, E) is wired up
      if (e.target instanceof HTMLInputElement) return; // arrows on the focused slider move the slider
      const gs = sceneRef.current;
      if (e.code === "ArrowRight" || e.code === "Space") {
        e.preventDefault();
        go((s) => s + 1);
      } else if (e.code === "ArrowLeft") go((s) => s - 1);
      else if (e.code === "KeyN") gs?.sky.toggleNight();
      else if (e.code === "KeyT") gs?.setSkyLook(!gs.isLookingUp());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, intro, go, walk]);

  // going in and out of the finished ger, with the first-person crosshair and hints
  const insideControls = (
    <>
      {!inside && (
        <div className="tray">
          {!BARE && (
            <button type="button" className="card" disabled={moving} onClick={() => go(() => 0)}>
              Дахин барих ↺
            </button>
          )}
          <button type="button" className="card next" disabled={moving} onClick={() => walk(true)}>
            Дотогш орох →
          </button>
        </div>
      )}
      {inside && !moving && !reading && (
        <div className="tray">
          <button
            type="button"
            className="card next"
            onClick={(e) => {
              sceneRef.current?.toggleMap(); // unroll the map and step up to read it
              e.currentTarget.blur();
            }}
          >
            Унших 📜
          </button>
          {nearDoor && (
            <button type="button" className="card" onClick={() => walk(false)}>
              Гарах ↩ <kbd>E</kbd>
            </button>
          )}
        </div>
      )}
      {inside && !moving && locked && !reading && <span className="crosshair" aria-hidden="true" />}
      {inside && !moving && touch && !reading && <TouchStick sceneRef={sceneRef} />}
      {inside && !moving && (
        <p
          key={reading ? "reading" : locked ? "locked" : "free"}
          className={`chill-hint ${(locked || touch) && !reading ? "" : "stay"} ${reading ? "low" : ""}`}
        >
          {reading
            ? ""
            : touch
              ? "Чирж эргэн тойрноо харна · Зүүн доор алхана · Цаас дээр дарж дэлгэнэ"
              : locked
                ? "W A S D — алхах · Хулгана — харах · Цаас дээр дарж дэлгэнэ · Esc — заагч гаргах"
                : "Дэлгэц дээр дарж эргэн тойрноо харна уу · Цаас дээр дарж дэлгэнэ"}
        </p>
      )}
    </>
  );

  if (BARE) {
    // bare mode (lib/bare.js): just the scene, and the progress while it loads
    return (
      <main className="stage">
        <canvas ref={canvasRef} className="scene" />
        {!ready && (
          <div className="intro" role="status" aria-label="Ачаалж байна">
            <div className="orb loading">
              <span className="face">
                <img src="/intro/start-circle.svg" width={449} height={449} alt="" />
                <span className="label">{Math.round(progress * 100)}%</span>
              </span>
            </div>
          </div>
        )}
        {ready && insideControls}
        {page && <Thanks rect={page} onClose={() => sceneRef.current?.toggleMap()} />}
      </main>
    );
  }

  return (
    <main className="stage">
      <canvas ref={canvasRef} className="scene" />

      {!ready && (
        <div className="intro" role="status" aria-label="Ачаалж байна">
          {/* the same glass circle as the start button, with the progress as a ring round it */}
          <div className="orb loading">
            <svg className="arc" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="48" pathLength="100" />
              <circle
                className="fill"
                cx="50"
                cy="50"
                r="48"
                pathLength="100"
                strokeDashoffset={100 - progress * 100}
              />
            </svg>
            <span className="face">
              <img src="/intro/start-circle.svg" width={449} height={449} alt="" />
              <span className="label">{Math.round(progress * 100)}%</span>
            </span>
          </div>
        </div>
      )}

      {ready && intro && (
        <div className={`intro ${leaving ? "leaving" : ""}`}>
          <button type="button" className="orb intro-start" onClick={start} autoFocus>
            <span className="ring" aria-hidden="true" />
            <span className="ring late" aria-hidden="true" />
            {/* Figma "Frame 2": a glass circle with the label, drawn at 449px and scaled down */}
            <span className="face">
              <img src="/intro/start-circle.svg" width={449} height={449} alt="" />
              <span className="label">Эхлэх</span>
            </span>
          </button>
        </div>
      )}

      {ready && !intro && !built && <MusicVolume sfxRef={sfxRef} />}
      {ready && !built && <Quality sceneRef={sceneRef} />}

      {ready && !intro && !built && (
        <DayNight sceneRef={sceneRef}>
          <button
            type="button"
            className={muted ? "" : "on"}
            aria-label={muted ? "Дуу асаах" : "Дуу унтраах"}
            aria-pressed={!muted}
            onClick={(e) => {
              sfxRef.current?.setMuted(!muted);
              setMuted(!muted);
              e.currentTarget.blur();
            }}
          >
            <svg className="line" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              {muted ? (
                <path d="M17 9l5 6M22 9l-5 6" />
              ) : (
                <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
              )}
            </svg>
          </button>
        </DayNight>
      )}

      {ready && !intro && !built && (
        <p className="caption" aria-live="polite">
          {step === 0 ? "Доорх товчлуур дээр дарж гэрээ бариарай" : STEPS[step - 1].text}
        </p>
      )}

      {built && insideControls}
      {page && <Thanks rect={page} onClose={() => sceneRef.current?.toggleMap()} />}

      {ready && !intro && step < LAST && (
        <div className="tray" role="group" aria-label="Гэрийн хэсгүүд">
          {deck
            .filter((i) => i >= step)
            .map((i) => {
              const next = i === step;
              const ready = next && !busy;
              return (
                <button
                  key={STEPS[i].key}
                  type="button"
                  className={ready ? "card next" : next ? "card waiting" : "card"}
                  disabled={!ready}
                  title={next ? undefined : `Эхлээд: ${STEPS[step].title}`}
                  onClick={(e) => {
                    go((s) => s + 1);
                    e.currentTarget.blur();
                  }}
                >
                  {STEPS[i].title}
                </button>
              );
            })}
        </div>
      )}

      {built && !inside && !moving && (
        <p className="chill-hint">Гэр бэлэн боллоо! Хаалган дээр дарж нээж болно</p>
      )}
    </main>
  );
}
