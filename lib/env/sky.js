// ── sky: a full day cycle — sunrise → day → sunset → moonrise → night → back to sunrise ─
//
// `time` runs 0 → 1 over CYCLE_SECONDS and wraps:
//   0.00 sunrise · 0.25 noon · 0.50 sunset + moonrise · 0.75 midnight · 1.00 moonset + sunrise
// The sun and moon travel opposite arcs (one rises as the other sets). Sky, fog, the
// directional light and the hemisphere fill all follow the sun's (and moon's) height.
// Ported from the geree project; createSky() wires it to a scene's sun / hemi lights and
// also returns a small copy of the dome for baking the environment map.

import * as THREE from "three";

const CYCLE_SECONDS = 120; // one whole day + night
const GLIDE_SPEED = 0.35; // cycle per second when jumping to day / night with a button or N
const SUN_MAX = 45; // sun height at noon, degrees
const MOON_MAX = 35; // moon height at midnight, degrees
const AZ_MID = 0.6; // azimuth at noon / midnight (≈ straight ahead from the start camera)
const AZ_SWING = 1.3; // rises this far to the left of AZ_MID, sets this far to the right

const NIGHT = {
  zenith: new THREE.Color("#030814"),
  horizon: new THREE.Color("#16233f"),
  moon: new THREE.Color("#a9bce8"), // moonlight colour (cool blue-white)
  moonI: 0.75, // moonlight strength with the moon high
  hemiSky: new THREE.Color("#2b3d6b"),
  hemiGround: new THREE.Color("#0c1610"),
  hemiI: 0.45,
};
const DUSK = new THREE.Color("#e0835a"); // extra horizon glow while day and night blend
const DUSK_STRENGTH = 0.3;
const CLOUD_COVER = 0.5; // 0 clear sky … 1 overcast
const CLOUD_SPEED = 0.02; // how fast the clouds drift

// value-noise fbm for the dome's cloud layer
const CLOUD_NOISE = /* glsl */ `
float cloudHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float cloudNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), f.x),
             mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cloudFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * cloudNoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
`;

// sky colours by sun elevation (degrees); everything in between is interpolated
const KEYS = [
  {
    e: -6,
    zenith: "#15203d",
    horizon: "#c98a78",
    sky: "#6a78a8",
    sun: "#ff6a2a",
    sunI: 0,
    hemiI: 0.5,
  },
  {
    e: 0,
    zenith: "#2e4a7c",
    horizon: "#ff9a5c",
    sky: "#d9a890",
    sun: "#ff8a3c",
    sunI: 0.5,
    hemiI: 0.6,
  },
  {
    e: 8,
    zenith: "#5a86bd",
    horizon: "#ffc898",
    sky: "#ffe8cc",
    sun: "#ffc27a",
    sunI: 1.5,
    hemiI: 0.75,
  },
  {
    e: 25,
    zenith: "#7fb4e0",
    horizon: "#cfe6f1",
    sky: "#fff6e0",
    sun: "#ffe2b0",
    sunI: 2.1,
    hemiI: 0.9,
  },
  {
    e: 45,
    zenith: "#6aa8dc",
    horizon: "#d4eaf4",
    sky: "#fffaf0",
    sun: "#fff0d6",
    sunI: 2.3,
    hemiI: 0.95,
  },
].map((k) => ({
  ...k,
  zenith: new THREE.Color(k.zenith),
  horizon: new THREE.Color(k.horizon),
  sky: new THREE.Color(k.sky),
  sun: new THREE.Color(k.sun),
}));

const START_TIME = 0.09; // mid-morning, a good light to build in

/** Build the sky dome into `scene` and drive `sun` / `hemi` from it; returns the controls. */
export function createSky({ scene, camera, sun, hemi, reduced = false }) {
  let time = START_TIME;
  let playing = false; // the time only moves when the user moves it
  let glideTo = null; // a time we are gliding forward to, or null
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog("#d9ebf2", 80, 900); // the landscape is at full size here, 2.5× geree

  const u = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uMoonCol: { value: NIGHT.moon.clone() },
    uMoonDir: { value: new THREE.Vector3() },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uCloudTime: { value: 0 },
    uCloudCover: { value: THREE.MathUtils.clamp(CLOUD_COVER, 0, 1) },
  };
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: u,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: `
        uniform vec3 uZenith, uHorizon, uSunCol, uSunDir, uMoonCol, uMoonDir;
        uniform float uNight, uTime, uCloudTime, uCloudCover;
        varying vec3 vDir;

        ${CLOUD_NOISE}

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        // one layer of stars: each grid cell on the sky may hold one star at a random spot
        float stars(vec3 d, float scale, float thresh) {
          vec3 p = d * scale;
          vec3 c = floor(p);
          float h = hash(c);
          if (h < thresh) return 0.0;
          vec3 o = vec3(hash(c + 1.7), hash(c + 3.1), hash(c + 5.3)) * 0.6 + 0.2;
          float r = length(fract(p) - o);
          float twinkle = 0.7 + 0.3 * sin(uTime * (1.5 + h * 3.0) + h * 80.0);
          float bright = mix(0.25, 1.0, pow((h - thresh) / (1.0 - thresh), 2.0));
          return smoothstep(0.24, 0.0, r) * bright * twinkle;
        }

        void main() {
          vec3 d = normalize(vDir);
          vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.05, 0.6, d.y), 0.7));

          // sun: wide warm glow, tighter halo, disc (the ground hides it once it has set)
          float sunUp = 1.0 - smoothstep(0.6, 1.0, uNight);
          float s = max(dot(d, uSunDir), 0.0);
          col += uSunCol * (pow(s, 8.0) * 0.35 + pow(s, 300.0) * 0.6) * sunUp;
          col = mix(col, vec3(1.0, 0.97, 0.9) * 1.4, smoothstep(0.9994, 0.9997, s) * sunUp);

          // night: moon comes out first, stars a little later
          float moonOn = smoothstep(0.2, 0.7, uNight);
          float starsOn = smoothstep(0.45, 1.0, uNight);
          if (moonOn > 0.0) {
            float m = max(dot(d, uMoonDir), 0.0);
            float above = smoothstep(0.0, 0.18, d.y);                 // fade stars into the horizon haze
            // Milky Way: a faint band along a tilted great circle, with extra stars inside it
            float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.45, 0.82))), 2.0) * 30.0);
            col += vec3(0.05, 0.06, 0.09) * band * above * starsOn;
            float st = stars(d, 260.0, 0.985) + stars(d, 520.0, 0.993) * 0.8 + stars(d, 520.0, 0.96) * band * 0.6;
            col += vec3(0.85, 0.9, 1.0) * st * above * starsOn * (1.0 - smoothstep(0.995, 0.9996, m));
            // moon: soft glow, tight halo, then a slightly mottled disc
            col += uMoonCol * (pow(m, 40.0) * 0.10 + pow(m, 600.0) * 0.30) * moonOn;
            float maria = 0.86 + 0.14 * sin(d.x * 820.0 + 1.3) * sin(d.z * 690.0 - d.y * 410.0);
            col = mix(col, vec3(0.93, 0.94, 0.98) * 1.35 * maria, smoothstep(0.99955, 0.99965, m) * moonOn);
          }

          // clouds: noise on a flat layer overhead, drifting slowly; lit by the sun by day, the moon by night
          if (d.y > 0.0) {
            vec2 cp = d.xz / (d.y + 0.12) * 1.1 + vec2(uCloudTime, uCloudTime * 0.4) * ${CLOUD_SPEED.toFixed(4)};
            float n = cloudFbm(cp);
            float c = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.3, n);
            c *= smoothstep(0.0, 0.2, d.y); // thin out into the horizon haze
            float thick = smoothstep(0.0, 1.0, (n - (1.0 - uCloudCover)) * 2.5); // darker undersides
            vec3 dayCloud = mix(vec3(1.0, 0.99, 0.97), uSunCol, 0.2) * mix(1.0, 0.72, thick);
            dayCloud = mix(dayCloud, uHorizon, 0.25) + uSunCol * pow(s, 6.0) * 0.45 * sunUp; // bright edges near the sun
            float mGlow = pow(max(dot(d, uMoonDir), 0.0), 8.0);
            vec3 nightCloud = vec3(0.1, 0.12, 0.18) * mix(1.0, 0.6, thick) + uMoonCol * mGlow * 0.25;
            col = mix(col, mix(dayCloud, nightCloud, smoothstep(0.2, 0.8, uNight)), c * 0.92);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMaterial);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);
  // the same sky, small enough for the PMREM cube camera (its far plane is 100 m)
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial));
  let changed = true;

  /** Jump to a time of the cycle (0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight). */
  function setTime(v) {
    time = ((v % 1) + 1) % 1;
    glideTo = null;
    apply();
  }
  const getTime = () => time;

  /** Run the cycle forward quickly until it reaches `v`. */
  function glideToTime(v) {
    if (reduced) return setTime(v);
    glideTo = ((v % 1) + 1) % 1;
  }

  const setPlaying = (v) => {
    playing = v;
  };
  const isPlaying = () => playing;

  /** Is it (mostly) night right now? */
  const isNight = () => nightAmount(sunElev(time)) >= 0.5;
  /** Glide to noon (false) or midnight (true). */
  const setNight = (v) => glideToTime(v ? 0.75 : 0.25);
  /** Switch between day and night. */
  const toggleNight = () => setNight(!isNight());

  /** A short name for a moment of the cycle, for labels / screen readers. */
  function phaseName(t = time) {
    const e = sunElev(t);
    if (e > 8) return "Өдөр";
    if (e > -8) return t < 0.25 || t > 0.75 ? "Нар мандаж байна" : "Нар жаргаж байна";
    return t > 0.5 && t < 0.62 ? "Сар гарч байна" : "Шөнө";
  }

  // ── sun / moon positions ────────────────────────────────────────────────────

  const sunElev = (t) => SUN_MAX * Math.sin(2 * Math.PI * t);
  const moonElev = (t) => MOON_MAX * Math.sin(2 * Math.PI * (t - 0.5));
  // azimuth swings from left (rise) through AZ_MID to right (set)
  const sunAz = (t) => AZ_MID + AZ_SWING * Math.cos(2 * Math.PI * t);
  const moonAz = (t) => AZ_MID + AZ_SWING * Math.cos(2 * Math.PI * (t - 0.5));
  // 0 while the sun is well up, 1 once it is well below the horizon
  const nightAmount = (e) => 1 - THREE.MathUtils.smoothstep(e, -12, 4);

  function dirFrom(out, elevDeg, az) {
    const er = THREE.MathUtils.degToRad(elevDeg);
    return out.set(-Math.sin(az) * Math.cos(er), Math.sin(er), -Math.cos(az) * Math.cos(er));
  }

  // ── apply the current time to sky, fog and lights ───────────────────────────

  const day = {
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sun: new THREE.Color(),
    sky: new THREE.Color(),
    sunI: 0,
    hemiI: 0,
  };
  function daySky(e) {
    e = THREE.MathUtils.clamp(e, KEYS[0].e, KEYS[KEYS.length - 1].e);
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const a = KEYS[i],
      b = KEYS[i + 1];
    const f = THREE.MathUtils.clamp((e - a.e) / (b.e - a.e), 0, 1);
    day.zenith.lerpColors(a.zenith, b.zenith, f);
    day.horizon.lerpColors(a.horizon, b.horizon, f);
    day.sun.lerpColors(a.sun, b.sun, f);
    day.sky.lerpColors(a.sky, b.sky, f);
    day.sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, f);
    day.hemiI = THREE.MathUtils.lerp(a.hemiI, b.hemiI, f);
  }

  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const lightDir = new THREE.Vector3();
  const dayGround = hemi.groundColor.clone();

  function apply() {
    const es = sunElev(time),
      em = moonElev(time);
    dirFrom(sunDir, es, sunAz(time));
    dirFrom(moonDir, em, moonAz(time));
    daySky(es);
    const m = nightAmount(es);
    const dusk = Math.sin(Math.PI * m) * DUSK_STRENGTH; // 0 at full day / night, strongest in between

    u.uNight.value = m;
    u.uSunDir.value.copy(sunDir);
    u.uSunCol.value.copy(day.sun);
    u.uMoonDir.value.copy(moonDir);
    u.uZenith.value.lerpColors(day.zenith, NIGHT.zenith, m);
    u.uHorizon.value.lerpColors(day.horizon, NIGHT.horizon, m).lerp(DUSK, dusk);
    scene.background.copy(u.uHorizon.value);
    scene.fog.color.copy(u.uHorizon.value);

    // one directional light, cast by whichever of sun / moon is brighter right now
    const sunI = day.sunI; // already 0 once the sun is 6° down
    const moonI = NIGHT.moonI * THREE.MathUtils.smoothstep(em, -2, 12) * m; // rises in as the moon climbs
    const moonShare = moonI / Math.max(1e-4, sunI + moonI);
    lightDir.copy(moonShare > 0.5 ? moonDir : sunDir);
    lightDir.y = Math.max(lightDir.y, 0.08); // never light from below the ground
    sun.position.copy(lightDir.normalize()).multiplyScalar(20);
    sun.color.lerpColors(day.sun, NIGHT.moon, moonShare);
    sun.intensity = sunI + moonI;
    hemi.color.lerpColors(day.sky, NIGHT.hemiSky, m);
    hemi.groundColor.lerpColors(dayGround, NIGHT.hemiGround, m);
    hemi.intensity = THREE.MathUtils.lerp(day.hemiI, NIGHT.hemiI, m);
    changed = true;
  }
  apply();

  let lastNow = performance.now();
  /** Advance the cycle (or a glide), twinkle the stars; called once per frame. */
  function updateSky(now) {
    dome.position.copy(camera.position);
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    let step = 0;

    if (glideTo !== null) {
      const left = (glideTo - time + 1) % 1; // always forward, so the sun / moon never run backwards
      step = Math.min(left, GLIDE_SPEED * dt);
      if (left <= GLIDE_SPEED * dt) glideTo = null;
    } else if (playing) {
      step = dt / CYCLE_SECONDS;
    }
    if (step > 0) {
      time = (time + step) % 1;
      apply();
    }
    if (u.uNight.value > 0.2 && !reduced) u.uTime.value = now / 1000; // star twinkle
    if (!reduced) u.uCloudTime.value = now / 1000; // cloud drift
  }

  /** True once since the last call if the sky changed, so the environment map needs re-baking. */
  function takeChanged() {
    const c = changed;
    changed = false;
    return c;
  }

  return {
    envScene,
    /** Sun / moon / sky colour uniforms, for things lit like the sky (the volumetric clouds). */
    skyUniforms: {
      uSunDir: u.uSunDir,
      uSunCol: u.uSunCol,
      uMoonDir: u.uMoonDir,
      uMoonCol: u.uMoonCol,
      uZenith: u.uZenith,
      uHorizon: u.uHorizon,
      uNight: u.uNight,
    },
    update: updateSky,
    takeChanged,
    /** 0 in full day, 1 in full night. */
    nightAmount: () => u.uNight.value,
    setTime,
    getTime,
    glideToTime,
    setPlaying,
    isPlaying,
    isNight,
    setNight,
    toggleNight,
    phaseName,
    dispose() {
      dome.geometry.dispose();
      envScene.children[0].geometry.dispose();
      skyMaterial.dispose();
    },
  };
}
