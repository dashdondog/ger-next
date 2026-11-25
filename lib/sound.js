// ── sound: a calm soundscape, synthesised with Web Audio (no audio files) ──
//
// Underneath: quiet steppe wind, with crickets at night. On top: each build step is heard
// as it happens (soft wooden taps, felt and canvas moving through the air), with a kalimba /
// bell note from the D major pentatonic scale where a part settles. Cues are timed in Blender
// frames like the animations (24 fps × 1.5), so a tap lands on the frame the part touches down.

const FRAME = 1 / 36;
const VOLUME = 0.9;
const CUE_GAIN = 2.2; // the build sounds sit well above the wind
const STORE = "ger-sound-muted";
const MUSIC_STORE = "ger-music-volume";
// one kalimba note per placed part: played in order, the eight make a little tune
const MELODY = [0, 2, 4, 5, 4, 7, 6, 10];
const MUSIC_GAIN = 1; // the music at full volume (the slider's top), under the build sounds
const MUSIC_DEFAULT = 0.5; // slider position on a first visit
const BAR = (60 / 66) * 4; // seconds per bar at 66 bpm
// Dmaj9 · Bm(add11) · Gmaj9 · Asus2, two bars each: pad notes and a bass root, in semitones from D3
const CHORDS = [
  { pad: [0, 4, 7, 11, 14], bass: -12 },
  { pad: [-3, 2, 4, 9, 12], bass: -15 },
  { pad: [2, 5, 9, 12, 16], bass: -19 },
  { pad: [-5, 2, 7, 9, 14], bass: -17 },
];

// D major pentatonic: D E F# A B
const SCALE = [0, 2, 4, 7, 9];
const D3 = 146.83;
const note = (deg, oct = 0) => {
  const o = Math.floor(deg / 5) + oct;
  return D3 * 2 ** (o + SCALE[((deg % 5) + 5) % 5] / 12);
};

/** URL of half a second of silence as an 8 kHz, 8-bit mono WAV */
function silentWav() {
  const n = 4000;
  const b = new DataView(new ArrayBuffer(44 + n));
  const str = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  b.setUint32(4, 36 + n, true);
  str(8, "WAVEfmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); // PCM
  b.setUint16(22, 1, true); // mono
  b.setUint32(24, 8000, true);
  b.setUint32(28, 8000, true);
  b.setUint16(32, 1, true);
  b.setUint16(34, 8, true);
  str(36, "data");
  b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}

export function createSfx() {
  let ctx, master, fx, dry, verb, bus, noise, windGain, cricketGain, musicBus, musicTimer;
  let started = false;
  let night = 0;
  let muted = false;
  let musicVolume = MUSIC_DEFAULT;
  try {
    muted = localStorage.getItem(STORE) === "1";
    const v = parseFloat(localStorage.getItem(MUSIC_STORE));
    if (v >= 0 && v <= 1) musicVolume = v;
  } catch {}

  // iOS silences Web Audio while the ringer switch is on silent, unless the page counts as
  // playing media: ask for a playback audio session (Safari 17+), and on older Safari keep a
  // silent <audio> element looping, which switches the session the same way.
  let silentEl;
  function unlockIOS() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch {}
    if (silentEl || !("ontouchend" in document) || !/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) return;
    silentEl = new Audio(silentWav());
    silentEl.loop = true;
    silentEl.setAttribute("playsinline", "");
    silentEl.play().catch(() => {});
  }

  // The AudioContext may only start inside a user gesture, so it is made on the first play.
  function init() {
    unlockIOS();
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(ctx.destination);
    // everything goes dry + into a long, dark reverb
    fx = ctx.createGain();
    dry = ctx.createGain();
    dry.gain.value = 1;
    verb = ctx.createConvolver();
    verb.buffer = impulse(2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    fx.connect(dry).connect(master);
    fx.connect(verb).connect(wet).connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // older iOS only really starts the context once something is played inside the gesture
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    blip.connect(ctx.destination);
    blip.start();
    ctx.resume();
    return true;
  }

  /** decaying stereo noise, low-passed over time: a soft hall */
  function impulse(seconds) {
    const n = Math.round(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const p = i / n;
        lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.45 * p); // darker as it fades
        d[i] = lp * (1 - p) ** 2.5;
      }
    }
    return b;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const noiseSrc = (t, dur) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start(t, Math.random() * 3);
    if (dur) s.stop(t + dur + 0.1);
    return s;
  };

  // ── ambience: wind and crickets (started once, then left running) ──
  function startAmbience() {
    if (started) return;
    started = true;
    const t = ctx.currentTime;

    // wind: band-passed noise whose pitch and level drift slowly
    const wind = filter("bandpass", 380, 0.6);
    windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0, t);
    windGain.gain.linearRampToValueAtTime(0.03, t + 4);
    noiseSrc(t).connect(wind).connect(windGain).connect(master);
    lfo(0.045, 160, wind.frequency);
    lfo(0.07, 0.014, windGain.gain);


    // crickets: short high chirps, only heard as night falls
    cricketGain = ctx.createGain();
    cricketGain.gain.value = 0;
    cricketGain.connect(fx);
    const chirp = () => {
      if (!ctx) return;
      if (night > 0.05) {
        const at = ctx.currentTime + 0.05;
        const f = rnd(4200, 4700);
        for (let i = 0; i < 3; i++) {
          const o = ctx.createOscillator();
          o.frequency.value = f;
          const g = env(at + i * 0.06, 0.005, 0.035, 0.05);
          o.connect(g).connect(cricketGain);
          o.start(at + i * 0.06);
          o.stop(at + i * 0.06 + 0.06);
        }
      }
      setTimeout(chirp, rnd(250, 900));
    };
    chirp();
    startMusic();
  }

  // ── music: a slow, warm pad with a soft bass and a few kalimba notes drifting over it ──
  const semi = (n) => D3 * 2 ** (n / 12);
  function startMusic() {
    musicBus = ctx.createGain();
    const t = ctx.currentTime;
    musicBus.gain.setValueAtTime(0, t);
    musicBus.gain.linearRampToValueAtTime(MUSIC_GAIN * musicVolume, t + 8); // fade in
    musicBus.connect(fx);
    let at = t + 0.5;
    let i = 0;
    // schedule a few seconds ahead, two bars (one chord) at a time
    const schedule = () => {
      if (!ctx) return;
      while (at < ctx.currentTime + 6) {
        if (musicVolume > 0) phrase(at, CHORDS[i % CHORDS.length]); // silent: keep time, play nothing
        at += BAR * 2;
        i++;
      }
    };
    schedule();
    musicTimer = setInterval(schedule, 1000);
  }
  function phrase(t, { pad, bass }) {
    const len = BAR * 2;
    // pad: two slightly detuned saws per note, low-passed, swelling in and out
    const lp = filter("lowpass", 900, 0.5);
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1100, t + len * 0.5);
    lp.frequency.linearRampToValueAtTime(700, t + len + 2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012, t + 2.5);
    g.gain.setValueAtTime(0.012, t + len - 0.5);
    g.gain.linearRampToValueAtTime(0, t + len + 2.5); // overlaps the next chord's swell
    lp.connect(g).connect(musicBus);
    for (const n of pad) {
      for (const cents of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = semi(n);
        o.detune.value = cents;
        o.connect(lp);
        o.start(t);
        o.stop(t + len + 2.6);
      }
    }
    // bass: a round sine on the root
    const b = ctx.createOscillator();
    b.frequency.value = semi(bass);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.05, t + 1);
    bg.gain.setValueAtTime(0.05, t + len - 0.8);
    bg.gain.linearRampToValueAtTime(0, t + len + 0.4);
    b.connect(bg).connect(musicBus);
    b.start(t);
    b.stop(t + len + 0.5);
    // melody: now and then a kalimba note from the pentatonic scale, on the beat
    for (let beat = 0; beat < 8; beat++) {
      if (Math.random() < 0.3) pluck(t + beat * (BAR / 4), note(Math.floor(rnd(5, 11))), 0.025, 2, musicBus);
    }
  }

  function lfo(rate, depth, param) {
    const o = ctx.createOscillator();
    o.frequency.value = rate * rnd(0.8, 1.2);
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
  }
  function filter(type, f, q = 1) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  function env(t, attack, decay, peak) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  // ── step voices ──
  /** kalimba-like pluck: a sine with a quiet octave and a brief bright tine */
  function pluck(t, f, gain = 0.12, decay = 1.6, dest = bus) {
    const out = env(t, 0.006, decay, gain);
    out.connect(dest);
    [
      [1, 1],
      [2, 0.25],
      [5.4, 0.06],
    ].forEach(([mul, g], i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * mul;
      const og = i === 2 ? env(t, 0.002, 0.08, g) : ctx.createGain();
      if (i !== 2) og.gain.value = g;
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + decay + 0.1);
    });
  }
  /** a soft bell: inharmonic partials with a long tail */
  function bell(t, f, gain = 0.08) {
    [
      [1, 1, 3],
      [2.76, 0.3, 1.6],
      [5.4, 0.12, 0.8],
    ].forEach(([mul, g, d]) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * mul;
      o.connect(env(t, 0.004, d, gain * g)).connect(bus);
      o.start(t);
      o.stop(t + d + 0.1);
    });
  }
  /** a breath of air, band-passed noise swelling and fading */
  function air(t, dur, { f0 = 500, f1 = 1500, gain = 0.06 } = {}) {
    const b = filter("bandpass", f0, 0.8);
    b.frequency.setValueAtTime(f0, t);
    b.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    noiseSrc(t, dur).connect(b).connect(g).connect(bus);
  }
  /** a deep, soft landing: a low sine that sinks a little */
  function soft(t, f = 70, gain = 0.25) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.3, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.2);
    o.connect(env(t, 0.01, 0.5, gain)).connect(bus);
    o.start(t);
    o.stop(t + 0.6);
  }
  /** a soft wooden tap: a damped low tone over a short muffled click */
  function tap(t, f = 220, gain = 0.15) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.015);
    o.connect(env(t, 0.002, 0.12, gain)).connect(bus);
    o.start(t);
    o.stop(t + 0.2);
    const b = filter("bandpass", f * 4, 1.5);
    noiseSrc(t, 0.05).connect(b).connect(env(t, 0.001, 0.04, gain * 0.8)).connect(bus);
  }
  const chord = (t, degs, oct, gain, spread = 0.07) =>
    degs.forEach((d, i) => pluck(t + i * spread, note(d, oct), gain));

  // ── one cue per build step, in the order of STEPS; `at(frame)` gives the time ──
  const CUES = [
    // khaalga: the door frame drops and bounces (touching down at frames 13, 26, 33)
    (at) => {
      air(at(0), 13 * FRAME, { f0: 300, f1: 700, gain: 0.03 });
      soft(at(13.1), 70, 0.3);
      tap(at(13.1), 180, 0.2);
      tap(at(26.2), 200, 0.08);
      tap(at(32.7), 210, 0.04);
      pluck(at(14), note(0, -1), 0.08);
    },
    // khana: the lattice unfolds with a run of little taps, settling at frame 36
    (at) => {
      for (let i = 0; i < 14; i++) tap(at(36 * (i / 14) ** 1.6), rnd(300, 420), 0.07 - i * 0.003);
      tap(at(36), 260, 0.12);
      pluck(at(36), note(2), 0.06);
    },
    // bagana, toono: the poles slide up, then the toono comes down onto them at frame 41
    (at) => {
      air(at(0), 34 * FRAME, { f0: 250, f1: 650, gain: 0.04 });
      tap(at(34), 160, 0.16);
      air(at(26), 15 * FRAME, { f0: 700, f1: 300, gain: 0.03 });
      soft(at(40.8), 80, 0.25);
      tap(at(40.8), 200, 0.2);
      bell(at(41), note(0, 1), 0.06);
    },
    // uni: each of the 72 poles taps into the toono as it seats (frame 3n + 16), with a chime now and then
    (at) => {
      for (let n = 0; n < 72; n++) {
        tap(at(n * 3 + 16), rnd(380, 520), rnd(0.06, 0.09));
        if (n % 6 === 0) pluck(at(n * 3 + 16), note(Math.round(4 + 3 * Math.sin(n * 0.15))), 0.035, 1);
      }
      bell(at(71 * 3 + 16), note(0, 1), 0.05);
    },
    // tuurga: the felt is drawn round the wall, a soft pat as it closes
    (at) => {
      air(at(0), 90 * FRAME, { f0: 400, f1: 1100, gain: 0.08 });
      air(at(30), 40 * FRAME, { f0: 900, f1: 500, gain: 0.04 });
      soft(at(90), 60, 0.15);
      pluck(at(90), note(0, 1), 0.05);
    },
    // deever: the roof felt falls through the air and flumps down at frame 22
    (at) => {
      air(at(0), 23 * FRAME, { f0: 1500, f1: 400, gain: 0.1 });
      soft(at(22), 55, 0.35);
      air(at(22), 0.35, { f0: 300, f1: 200, gain: 0.08 });
      pluck(at(23), note(0, -1), 0.06);
    },
    // gadar: the lighter canvas rushes down, snaps and settles
    (at) => {
      air(at(0), 23 * FRAME, { f0: 2200, f1: 700, gain: 0.08 });
      soft(at(22), 75, 0.2);
      air(at(22), 0.18, { f0: 1800, f1: 900, gain: 0.07 });
      air(at(30), 0.3, { f0: 1200, f1: 800, gain: 0.03 });
      pluck(at(23), note(5), 0.05);
    },
    // buslur: the ropes run round the canvas, one after another, and are tied off
    (at) => {
      [0, 25, 50].forEach((f) => air(at(f), 40 * FRAME, { f0: 1500, f1: 3000, gain: 0.04 }));
      tap(at(95), 300, 0.14);
      tap(at(97), 340, 0.08);
      pluck(at(95), note(4), 0.06);
    },
  ];

  /** The finished ger's door: the latch lifts and it swings open, or it swings shut and knocks home. */
  function door(at, open) {
    if (open) {
      tap(at(0), 600, 0.08);
      air(at(1), 38 * FRAME, { f0: 500, f1: 900, gain: 0.04 });
      chord(at(6), [0, 2, 4, 7], -1, 0.06, 0.12);
    } else {
      air(at(0), 36 * FRAME, { f0: 900, f1: 450, gain: 0.04 });
      tap(at(38), 170, 0.18);
      tap(at(40), 520, 0.06);
    }
  }

  // ── the old map: paper crackling as it unrolls or rolls up ──
  /** dry paper: a thin hiss with little crackles over it, thickest mid-way */
  function rustle(t, dur, gain) {
    const hiss = filter("highpass", 2500, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * 0.35, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    noiseSrc(t, dur).connect(hiss).connect(g).connect(bus);
    for (let i = 0; i < dur * 45; i++) {
      const x = Math.random();
      if (Math.random() > Math.sin(Math.PI * x)) continue; // fewer at the ends
      const at = t + x * dur;
      const b = filter("bandpass", rnd(1800, 6500), 2);
      noiseSrc(at, 0.04)
        .connect(b)
        .connect(env(at, 0.001, rnd(0.01, 0.035), gain * rnd(0.3, 1)))
        .connect(bus);
    }
  }
  /** Unroll (open) or roll up the map over `dur` seconds. */
  function paper(t, dur, open) {
    rustle(t, dur, 0.06);
    if (open) air(t + dur - 0.15, 0.25, { f0: 900, f1: 380, gain: 0.05 }); // the sheet settles flat
    else tap(t + dur - 0.05, 260, 0.05); // the roll closes
  }

  // ── the intro's flight in: a soft rush of air as the camera glides down ──
  function landing(t0, dur) {
    air(t0, dur, { f0: 1400, f1: 600, gain: 0.035 });
  }

  return {
    /** The intro's glide, lasting `seconds`; call from the start click. */
    land(seconds) {
      if (!init()) return;
      startAmbience();
      this.stop();
      bus = ctx.createGain();
      bus.gain.value = CUE_GAIN;
      bus.connect(fx);
      landing(ctx.currentTime + 0.03, seconds);
    },
    /** Play the cue of step i (0-based); call from a click or key handler. */
    play(i) {
      if (!CUES[i] || !init()) return;
      startAmbience();
      this.stop();
      bus = ctx.createGain();
      bus.gain.value = CUE_GAIN;
      bus.connect(fx);
      const t0 = ctx.currentTime + 0.03;
      pluck(t0, note(MELODY[i]), 0.09, 2.4);
      CUES[i]((frame) => t0 + frame * FRAME);
    },
    /** The map unrolling (true) or rolling up (false) over `seconds`; call from the click. */
    paper(open, seconds) {
      if (!init()) return;
      startAmbience();
      this.stop();
      bus = ctx.createGain();
      bus.gain.value = CUE_GAIN;
      bus.connect(fx);
      paper(ctx.currentTime + 0.03, seconds, open);
    },
    /** Open (true) or close (false) the door; call from the click that does it. */
    door(open) {
      if (!init()) return;
      startAmbience();
      this.stop();
      bus = ctx.createGain();
      bus.gain.value = CUE_GAIN;
      bus.connect(fx);
      const t0 = ctx.currentTime + 0.03;
      door((frame) => t0 + frame * FRAME, open);
    },
    /** Fade out the step cue that is playing (when the user jumps to another step). */
    stop() {
      if (!bus) return;
      const old = bus;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => old.disconnect(), 800);
      bus = null;
    },
    /** 0 = day, 1 = night: brings the crickets in and the wind down a little. */
    setNight(n) {
      night = n;
      if (!started) return;
      cricketGain.gain.setTargetAtTime(n * 0.6, ctx.currentTime, 0.5);
    },
    isMuted: () => muted,
    /** Music volume, 0 (off) … 1. */
    getMusicVolume: () => musicVolume,
    setMusicVolume(v) {
      musicVolume = Math.min(1, Math.max(0, v));
      try {
        localStorage.setItem(MUSIC_STORE, String(musicVolume));
      } catch {}
      if (musicBus) musicBus.gain.setTargetAtTime(MUSIC_GAIN * musicVolume, ctx.currentTime, 0.15);
    },
    setMuted(m) {
      muted = m;
      try {
        localStorage.setItem(STORE, m ? "1" : "0");
      } catch {}
      if (ctx) master.gain.setTargetAtTime(m ? 0 : VOLUME, ctx.currentTime, 0.1);
    },
    dispose() {
      clearInterval(musicTimer);
      silentEl?.pause();
      ctx?.close();
      ctx = null;
    },
  };
}
