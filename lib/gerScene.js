// ── three.js scene: loads the ger parts exported from ger.blend and plays the build steps ──

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  UNI,
  UNI_FRAMES,
  TUURGA,
  TUURGA_FRAMES,
  DEEVER,
  GADAR,
  FALL_FRAMES,
  BUSLUR,
  BUSLUR_FRAMES,
  patchMaterial,
  canvasFragment,
  FELT_DETAIL,
  CANVAS_DETAIL,
} from "./gerShaders";
import { BARE } from "./bare";
import { createSky } from "./env/sky";
import { createClouds } from "./env/clouds";
import { loadSteppe, updateSteppe, wind } from "./env/steppe";

const FPS = 24; // the timings below are Blender frames
const SPEED = 1.5; // play a little faster than in Blender
const REST = 1e4; // a frame long after every animation has settled
// the old map (map_paper.blend) hangs rolled up between the two poles, facing the door; a click
// unrolls it and brings the camera up to read it, another click rolls it up and steps back.
// Its geometry-nodes roll is baked into shape keys; userData.rollCurve is the roll per frame.
const MAP_POS = new THREE.Vector3(0, 0.55, 0); // the sheet spans y 0.9 … 1.8 between the poles
const MAP_CENTER = new THREE.Vector3(0, 1.35, 0);
const MAP_SIZE = { w: 0.6, h: 0.9 };
const MAP_OPEN = [185, 295]; // Blender frames of the unroll…
const MAP_CLOSE = [30, 140]; // …and of the roll up
const MAP_SPEED = 1.6; // play them a little faster than in Blender
const MAP_FLY_MS = 1300;
const MAP_FIT = 0.53; // reading distance: half the view height in sheet heights (smaller = closer)
const MAP_CLEAR = 0.35; // walking keeps this far from the sheet
const MAP_GLOW = 0.85; // at night the open sheet lights itself (as if by a lamp) so its page reads

const MODELS = [
  "khaalga_khuree",
  "khaalga_khavtas",
  "khana",
  "bagana",
  "toono",
  "uni",
  "tuurga",
  "deever",
  "gadar",
  "buslur",
];
// door hinge, Blender (-0.414, -3.1867, 0) in three's Y-up coordinates
const HINGE = new THREE.Vector3(-0.414, 0, 3.1867);
const DOOR_OPEN = THREE.MathUtils.degToRad(105);
const DOOR_FRAMES = 40; // opening or closing the finished ger's door
const CLICK_SLOP = 6; // px a press may move and still count as a click, not an orbit
const ENV_EVERY = 250; // ms between environment-map bakes while the sky is changing
// quality levels (the radio top left): what each one draws
export const QUALITY = {
  low: { pixelRatio: 1, grass: 0.3, cloudShadows: false, ao: false },
  medium: { pixelRatio: 1.5, grass: 0.6, cloudShadows: true, ao: false },
  high: { pixelRatio: 2, grass: 1, cloudShadows: true, ao: true },
};
const LOOK_MAX = 1.15; // how far the view can tilt up toward the sky, radians (~66°)
const GRASS_LAYER = 1; // the grass (and the clouds) are drawn on this layer and hidden from the AO pass

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const HOME_VIEW = [4.2, 2.63, 14.06, 0, 0.7, 0]; // camera x,y,z + target x,y,z for building
const INTRO_VIEW = [13.46, 8.54, 25.64, 0, 0.7, 0]; // wide shot of the finished ger
const INTRO_FLY_MS = 2200;
// going inside: round to the door, straight in between the two poles, and the reverse to leave
const DOOR_VIEW = [0, 1.3, 7, 0, 1.1, 0];
// inside, the target sits just ahead of the eye, so dragging turns the head (first person)
const INSIDE_VIEW = [0, 1.5, 2.2, 0, 1.48, 1.9];
const LEAVE_VIEW = [0, 1.5, 2.2, 0, 1.45, 3.0]; // back at the door, looking out
// walking with W A S D (inside only) — switched off for now: set WALK to true to bring it back
const WALK = true;
const WALK_SPEED = 1.3; // metres per second
const WALK_RADIUS = 2.4; // stop this far from the centre: a comfortable step back from the wall (3.13)
const POLES = [new THREE.Vector2(0.86, 0), new THREE.Vector2(-0.86, 0)];
const POLE_CLEAR = 0.4; // keep this far from each pole's centre
const MOUSE_TURN = 0.0022; // radians per pixel of mouse movement while the pointer is locked
const PITCH_MAX = 1.35; // how far up / down the head turns
const isNearDoor = (p) => p.z > 1.6 && Math.abs(p.x) < 1; // just inside the doorway
const WALK_KEYS = { KeyW: [1, 0], KeyS: [-1, 0], KeyA: [0, -1], KeyD: [0, 1] }; // forward, right
const LIMITS = {
  // camera distance and up / down angle allowed by the orbit controls
  outside: { min: 4, max: 30, minPolar: 0, maxPolar: 1.5 },
  inside: { min: 0.3, max: 0.3, minPolar: 0.05, maxPolar: Math.PI - 0.05 }, // the mouse turns the head
};
const FLOOR_RADIUS = 3.15; // the wall's radius: no grass inside the finished ger
// a step's camera move: drift closer and look at the part's height while it goes in, then back
const STEP_FOCUS_Y = [1.0, 0.9, 2.6, 2.4, 1.2, 2.6, 2.6, 1.6]; // per step, in STEPS order
const FOCUS_ZOOM = 0.2; // share of the distance the camera drifts in
const FOCUS_IN_MS = 900;
const FOCUS_OUT_MS = 1400;
const IDLE_MS = 20000; // untouched this long, the camera starts its slow orbit
const INTRO_SPIN = 0.6; // slow orbit round the ger during the intro (2 = one turn in 30 s)
const easeOutCubic = (x) => 1 - (1 - x) ** 3;
const easeInOut = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const easeOutBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
function easeOutBounce(x) {
  const n = 7.5625,
    d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

export class GerScene {
  constructor(canvas, onProgress) {
    this.canvas = canvas;
    this.onProgress = onProgress;
    this.active = null;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    const scene = (this.scene = new THREE.Scene());

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1500);
    this.camera.layers.enable(GRASS_LAYER);
    this.camera.position.fromArray(HOME_VIEW);
    const c = (this.controls = new OrbitControls(this.camera, canvas));
    c.target.fromArray(HOME_VIEW, 3); // low, so the ger sits above the step panel
    c.enableDamping = true;
    c.minDistance = 4;
    c.maxDistance = 30;
    c.maxPolarAngle = 1.5;
    this.minPolar = c.minPolarAngle;

    // the sky moves the sun, recolours both lights and the fog through the day / night cycle
    const hemi = new THREE.HemisphereLight("#fff6e0", "#7aa457", 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff0d8", 3.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 45 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    scene.add(sun);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.sky = createSky({ scene, camera: this.camera, sun, hemi, reduced });
    this.clouds = BARE
      ? null
      : createClouds({ scene, camera: this.camera, sky: this.sky, layer: GRASS_LAYER, reduced });
    // night: a soft cool light on the ger so it stays readable, and a warm hearth glow inside
    // that shows through the open door and the toono; both follow sky.nightAmount()
    this.nightFill = new THREE.SpotLight("#9fb6ff", 0, 40, 0.55, 0.9, 1.2);
    this.nightFill.position.set(4, 9, 12);
    this.nightFill.target.position.set(0, 1.4, 0);
    scene.add(this.nightFill, this.nightFill.target);
    this.hearth = new THREE.PointLight("#ffa24a", 0, 9, 1.6);
    this.hearth.position.set(0, 0.9, 0);
    scene.add(this.hearth);
    // the sky also lights the ger through an environment map, re-baked as the sky changes
    this.pmrem = new THREE.PMREMGenerator(r);
    scene.environmentIntensity = 0.6;
    this.envAt = -Infinity;
    this.lastNow = performance.now();
    this.lookUp = 0;
    this.lookGoal = null;
    this.onPointerMove = (e) => {
      this.dragLook(e);
      this.hoverDoor(e);
    };
    canvas.addEventListener("pointermove", this.onPointerMove);
    // once the ger is built, a click (not a drag) on the door opens or closes it
    this.raycaster = new THREE.Raycaster();
    this.lastInput = performance.now();
    this.onPointerDown = (e) => {
      this.press = { x: e.clientX, y: e.clientY };
      this.poke();
    };
    this.onWheel = () => this.poke();
    canvas.addEventListener("wheel", this.onWheel, { passive: true });
    this.walkKeys = new Set();
    this.onKeyDown = (e) => {
      if (!WALK || !this.inside || this.fly || !WALK_KEYS[e.code]) return;
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      this.walkKeys.add(e.code);
      this.poke();
    };
    this.onKeyUp = (e) => this.walkKeys.delete(e.code);
    this.onBlur = () => this.walkKeys.clear(); // a key released in another window
    // inside: click to lock the pointer, then the mouse turns the head (Esc lets go)
    this.yaw = 0;
    this.pitch = 0;
    this.onClick = (e) => {
      if (!this.inside || this.fly) return;
      if (this.hitsMap(e)) return this.toggleMap();
      if (this.mapFocused) return; // reading the map: only a click on it does anything
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
    };
    this.onLockChange = () => this.onLock?.(document.pointerLockElement === canvas);
    this.onMouseLook = (e) => {
      if (document.pointerLockElement !== canvas || this.fly || this.mapFocused) return;
      this.yaw -= e.movementX * MOUSE_TURN;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - e.movementY * MOUSE_TURN,
        -PITCH_MAX,
        PITCH_MAX,
      );
      this.applyHead();
      this.poke();
    };
    canvas.addEventListener("click", this.onClick);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseLook);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.onPointerUp = (e) => {
      const p = this.press;
      this.press = null;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < CLICK_SLOP && this.hitsDoor(e))
        this.toggleDoor();
    };
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);

    // ambient occlusion: contact shadows in the lattice, under the eave and round the ropes
    this.useAO =
      !BARE &&
      !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) &&
      new URLSearchParams(location.search).get("ao") !== "0";
    if (this.useAO) {
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(scene, this.camera));
      this.gtao = new GTAOPass(scene, this.camera, 1, 1);
      this.gtao.updateGtaoMaterial({
        radius: 0.6,
        distanceExponent: 1.5,
        thickness: 1.5,
        scale: 1.2,
        samples: 16,
      });
      // the AO depth pass would draw the instanced grass blades without their vertex shader
      const aoRender = this.gtao.render.bind(this.gtao);
      this.gtao.render = (...args) => {
        this.camera.layers.disable(GRASS_LAYER);
        aoRender(...args);
        this.camera.layers.enable(GRASS_LAYER);
      };
      this.composer.addPass(this.gtao);
      this.composer.addPass(new OutputPass());
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    r.setAnimationLoop((now) => this.tick(now));
  }

  setView([x, y, z, tx, ty, tz]) {
    this.camera.position.set(x, y, z);
    this.controls.target.set(tx, ty, tz);
    this.controls.update();
  }

  // ── intro: the finished ger from afar, then a flight in to the building view ───
  showIntro() {
    this.inIntro = true;
    this.goTo(this.steps.length, false);
    this.setView(INTRO_VIEW);
    this.controls.enabled = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = INTRO_SPIN;
  }

  /** Start the flight in to the building view; returns how long it takes, in ms. */
  leaveIntro() {
    this.inIntro = false;
    this.poke();
    this.goTo(0, false);
    this.controls.autoRotate = false;
    // fly round the ger (not through it)
    this.flyTo([{ view: HOME_VIEW, ms: INTRO_FLY_MS, arc: true }], () => this.setLimits("outside"));
    return INTRO_FLY_MS;
  }

  // ── going in and out of the finished ger ──────────────────────────────────
  /** Open the door and fly in through it; returns how long it takes, in ms. */
  enterGer() {
    if (!this.doorOpen) this.toggleDoor();
    this.inside = true;
    const legs = [
      { view: DOOR_VIEW, ms: 1600, arc: true },
      { view: INSIDE_VIEW, ms: 1800 },
    ];
    this.flyTo(legs, () => {
      this.holdInside(); // the mouse (pointer lock) and W A S D drive the camera
      this.nearDoor = null; // report it afresh
    });
    return legs.reduce((t, l) => t + l.ms, 0);
  }

  /** Back out through the door and round to the usual view; returns how long it takes, in ms. */
  leaveGer() {
    this.inside = false;
    this.mapOpen = this.mapFocused = false;
    this.mapAnim = null;
    this.onMapFocus?.(false);
    this.onMapShown?.(false);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.onNearDoor?.(false);
    this.nearDoor = false;
    this.walkKeys.clear();
    const legs = [
      { view: LEAVE_VIEW, ms: 1200 }, // walk back to the door (the floor is round, so the line stays in)
      { view: DOOR_VIEW, ms: 1600 },
      { view: HOME_VIEW, ms: 1600, arc: true },
    ];
    this.flyTo(legs, () => this.setLimits("outside"));
    return legs.reduce((t, l) => t + l.ms, 0);
  }

  setLimits(where) {
    const l = LIMITS[where];
    const c = this.controls;
    c.enableZoom = where === "outside"; // inside the distance is fixed: the wheel would do nothing
    c.minDistance = l.min;
    c.maxDistance = l.max;
    c.maxPolarAngle = l.maxPolar;
    this.minPolar = l.minPolar;
  }

  /**
   * Fly the camera through `legs` ({ view, ms, arc }): an arc leg eases the orbit angles round
   * the target (so it goes round the ger, not through it), the others move in a straight line.
   */
  flyTo(legs, onDone) {
    const c = this.controls;
    c.enabled = false;
    c.autoRotate = false;
    // free limits while flying, or the controls would clamp the camera mid-way
    Object.assign(c, {
      minDistance: 0.01,
      maxDistance: 100,
      minPolarAngle: 0,
      maxPolarAngle: Math.PI,
    });
    this.minPolar = 0;
    this.focus = null;
    const from = [...this.camera.position.toArray(), ...c.target.toArray()];
    this.fly = { legs, i: 0, from, start: performance.now(), onDone };
  }

  updateFly(now) {
    const f = this.fly;
    if (!f) return;
    const leg = f.legs[f.i];
    const k = easeInOut(clamp01((now - f.start) / leg.ms));
    const v = (a, i) => new THREE.Vector3().fromArray(a, i);
    const [fromPos, fromTarget, toPos, toTarget] = [
      v(f.from, 0),
      v(f.from, 3),
      v(leg.view, 0),
      v(leg.view, 3),
    ];
    const c = this.controls;
    c.target.lerpVectors(fromTarget, toTarget, k);
    if (leg.arc) {
      const lerp = THREE.MathUtils.lerp;
      const a = new THREE.Spherical().setFromVector3(fromPos.sub(fromTarget));
      const b = new THREE.Spherical().setFromVector3(toPos.sub(toTarget));
      // take the short way round
      b.theta =
        a.theta +
        THREE.MathUtils.euclideanModulo(b.theta - a.theta + Math.PI, 2 * Math.PI) -
        Math.PI;
      const s = new THREE.Spherical(
        lerp(a.radius, b.radius, k),
        lerp(a.phi, b.phi, k),
        lerp(a.theta, b.theta, k),
      );
      this.camera.position.setFromSpherical(s).add(c.target);
    } else this.camera.position.lerpVectors(fromPos, toPos, k);
    if (k < 1) return;
    if (f.i < f.legs.length - 1) {
      f.i++;
      f.from = leg.view;
      f.start = now;
      return;
    }
    this.fly = null;
    c.enabled = true;
    this.poke();
    f.onDone?.();
  }

  getView() {
    const r = (n) => Math.round(n * 100) / 100;
    return [...this.camera.position.toArray(), ...this.controls.target.toArray()].map(r);
  }

  // ── looking up at the sky ─────────────────────────────────────────────────
  // Orbiting stops once the camera is down at ground level. Dragging further up from there
  // tilts the view toward the sky; dragging down brings it back. setSkyLook() glides there.

  dragLook(e) {
    if (this.inside) return;
    if (!(e.buttons & 1) || (e.pointerType === "touch" && !e.isPrimary)) return;
    const atGround = this.controls.getPolarAngle() >= this.controls.maxPolarAngle - 0.01;
    if (!atGround && this.lookUp === 0) return;
    this.lookUp = Math.min(
      LOOK_MAX,
      Math.max(0, this.lookUp - e.movementY * (Math.PI / window.innerHeight) * 1.2),
    );
    this.lookGoal = null;
  }

  setSkyLook(on) {
    if (on && this.inside) return; // no sky to look at under the roof
    if (on) this.controls.minPolarAngle = this.controls.maxPolarAngle; // drop to ground level first
    this.lookGoal = on ? LOOK_MAX * 0.85 : 0;
  }

  isLookingUp() {
    return this.lookUp > 0.3;
  }

  updateLook(dt) {
    if (this.lookGoal !== null) {
      this.lookUp += (this.lookGoal - this.lookUp) * Math.min(1, dt * 4);
      if (Math.abs(this.lookGoal - this.lookUp) < 0.002) {
        this.lookUp = this.lookGoal;
        this.lookGoal = null;
      }
    }
    // while tilted, hold the camera at ground level so dragging down un-tilts instead of orbiting up
    this.controls.minPolarAngle =
      this.lookUp > 0 || this.lookGoal ? this.controls.maxPolarAngle : this.minPolar;
  }

  bakeEnvironment(now) {
    if (now - this.envAt < ENV_EVERY || !this.sky.takeChanged()) return;
    this.envAt = now;
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.sky.envScene, 0.04);
    this.scene.environment = this.envTarget.texture;
    old?.dispose();
  }

  resize() {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.camera.aspect = w / h;
    // keep the ger's full width on narrow (portrait) screens: hold the horizontal field of view
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) * 1.4);
    const vfov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(hHalf) / this.camera.aspect));
    this.camera.fov = Math.min(72, Math.max(40, vfov));
    this.camera.updateProjectionMatrix();
  }

  /** The landscape: ground, rocks, mountains and the grass. */
  loadSteppe(manager) {
    return loadSteppe(this.renderer, manager).then(({ group, grass }) => {
      grass.layers.set(GRASS_LAYER);
      this.grass = grass;
      this.grassCount = grass.geometry.instanceCount;
      if (this.quality)
        grass.geometry.instanceCount = Math.round(this.grassCount * this.quality.grass);
      this.scene.add(group);
    });
  }

  /** Bare mode's stand-in for the landscape: a plain floor to stand the ger on. */
  addPlainFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: "#9a9a8c", roughness: 1 }),
    );
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  async load() {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => this.onProgress?.(loaded / total);
    const steppe = BARE ? Promise.resolve(this.addPlainFloor()) : this.loadSteppe(manager);
    const draco = new DRACOLoader(manager).setDecoderPath("/draco/");
    const loader = new GLTFLoader(manager).setDRACOLoader(draco);
    const kheeTex = new THREE.TextureLoader(manager).loadAsync("/textures/gadar_khee.png");
    const mapGltf = loader.loadAsync("/models/map_paper.glb");
    const gltfs = await Promise.all(MODELS.map((m) => loader.loadAsync(`/models/${m}.glb`)));
    const m = Object.fromEntries(MODELS.map((name, i) => [name, gltfs[i].scene]));
    for (const root of Object.values(m)) {
      root.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
    }
    const khee = await kheeTex;
    khee.colorSpace = THREE.SRGBColorSpace;
    khee.wrapS = THREE.RepeatWrapping;
    khee.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    // door: fixed frame plus a leaf turning on its hinge
    const door = new THREE.Group();
    const leafPivot = new THREE.Group();
    leafPivot.position.copy(HINGE);
    m.khaalga_khavtas.position.copy(HINGE).negate();
    leafPivot.add(m.khaalga_khavtas);
    door.add(m.khaalga_khuree, leafPivot);
    // an invisible box over the doorway, so a click on the open doorway also shuts the door
    const opening = new THREE.Box3().setFromObject(m.khaalga_khuree);
    const doorway = new THREE.Mesh(
      new THREE.BoxGeometry(...opening.getSize(new THREE.Vector3()).toArray()),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    opening.getCenter(doorway.position);
    door.add(doorway);
    this.door = door;
    this.leafPivot = leafPivot;

    const felt = new THREE.MeshStandardMaterial({
      color: "#ddd5c6",
      roughness: 1,
      side: THREE.DoubleSide,
      userData: { detail: FELT_DETAIL },
    });
    const rope = new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 0.9 });
    const canvas = (opts) =>
      new THREE.MeshStandardMaterial({
        color: "#f6f3ec",
        roughness: 0.9,
        side: THREE.DoubleSide,
        map: khee,
        userData: { ...opts, detail: CANVAS_DETAIL },
      });
    const wallCanvas = { tiles: 39, v0: 0.1, bandH: 0.14 };
    const roofCanvas = { tiles: 20, v0: 3.28892, bandH: 0.28394, edge: 3.82163 };

    /** Give every mesh under root an animated copy of its material; returns the step's frame uniform. */
    const animate = (root, key, body, pick) => {
      const uT = { value: REST };
      root.traverse((o) => {
        if (!o.isMesh) return;
        const src = o.material.name;
        const mat = pick ? pick(src) : o.material.clone();
        const pattern = mat.userData.tiles ? canvasFragment(mat.userData) : null;
        o.material = patchMaterial(mat, {
          key: `${key}:${src}`,
          uT,
          body,
          mapFragment: pattern,
          detail: mat.userData.detail,
        });
      });
      return uT;
    };
    const uniT = animate(m.uni, "uni", UNI);
    const tuurgaT = animate(m.tuurga, "tuurga", TUURGA, () => felt.clone());
    const deeverT = animate(m.deever, "deever", DEEVER, () => felt.clone());
    const gadarT = animate(m.gadar, "gadar", GADAR, (name) =>
      canvas(name === "Gadar_Deever" ? roofCanvas : wallCanvas),
    );
    const buslurT = animate(m.buslur, "buslur", BUSLUR, () => rope.clone());
    const shaderStep = (root, uT, frames) => ({
      roots: [root],
      frames,
      shadowsAfter: true,
      apply: (t) => (uT.value = t),
    });

    this.steps = [
      {
        roots: [door],
        frames: 36,
        apply: (t) => (door.position.y = 1.4 * (1 - easeOutBounce(clamp01(t / 36)))),
      },
      {
        roots: [m.khana],
        frames: 36,
        apply: (t) => m.khana.scale.set(1, Math.max(0.001, easeOutCubic(clamp01(t / 36))), 1),
      },
      {
        roots: [m.bagana, m.toono],
        frames: 66,
        apply: (t) => {
          m.bagana.position.y = -3.4 * (1 - easeOutCubic(clamp01(t / 34)));
          m.toono.position.y = 3 * (1 - easeOutBack(clamp01((t - 26) / 40)));
        },
      },
      shaderStep(m.uni, uniT, UNI_FRAMES),
      shaderStep(m.tuurga, tuurgaT, TUURGA_FRAMES),
      shaderStep(m.deever, deeverT, FALL_FRAMES),
      shaderStep(m.gadar, gadarT, FALL_FRAMES),
      shaderStep(m.buslur, buslurT, BUSLUR_FRAMES),
    ];
    for (const st of this.steps) for (const root of st.roots) this.scene.add(root);
    await steppe;
    const map = (await mapGltf).scene;
    map.position.copy(MAP_POS);
    this.mapMeshes = []; // one per material (front, back), all sharing the shape keys
    map.traverse((o) => {
      if (o.userData.rollCurve) this.mapRoll = o.userData;
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
        if (o.morphTargetInfluences) this.mapMeshes.push(o);
        // the paper's own picture as emission, turned up at night (updateMap)
        for (const m of [o.material].flat()) {
          m.emissive = new THREE.Color("#ffffff");
          m.emissiveMap = m.map;
          m.emissiveIntensity = 0;
        }
      }
    });
    map.visible = false; // only in the finished ger
    this.map = map;
    this.scene.add(map);
    this.scene.traverse((o) => {
      if (o.isMesh && this.clouds) for (const mt of [o.material].flat()) this.clouds.addShadows(mt);
    });
    if (BARE) {
      this.goTo(this.steps.length, false); // the finished ger
    } else this.goTo(0, false);
  }

  /** Switch to "low" | "medium" | "high" (see QUALITY); safe to call before load() finishes. */
  setQuality(level) {
    const q = QUALITY[level] ?? QUALITY.medium;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.resize();
    if (this.grass) this.grass.geometry.instanceCount = Math.round(this.grassCount * q.grass);
    this.clouds?.setShadows(q.cloudShadows);
  }

  setShadows(step, on) {
    if (!step.shadowsAfter) return;
    for (const root of step.roots) root.traverse((o) => o.isMesh && (o.castShadow = on));
  }

  finish(step) {
    step.apply(step.shadowsAfter ? REST : step.frames);
    this.setShadows(step, true);
  }

  // ── the finished ger's door ─────────────────────────────────────────────
  /** True when the pointer event is over the door (only once the ger is finished). */
  hitsDoor(e) {
    if (!this.built || !this.door) return false;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const ger = this.steps.flatMap((st) => st.roots); // the ger hides the door from behind
    const hit = this.raycaster.intersectObjects(ger, true).find((h) => h.object.visible);
    return !!hit && this.isDoorPart(hit.object);
  }
  isDoorPart(o) {
    for (; o; o = o.parent) if (o === this.door) return true;
    return false;
  }
  hoverDoor(e) {
    if (e.buttons) return;
    const now = performance.now();
    if (now - (this.hoverAt ?? 0) < 60) return; // raycasting the whole scene is not free
    this.hoverAt = now;
    this.canvas.style.cursor = this.hitsDoor(e) || this.hitsMap(e) ? "pointer" : "";
  }
  /** Swing the door open or shut from wherever it is now; onDoor(open) is told (for the sound). */
  toggleDoor() {
    this.doorOpen = !this.doorOpen;
    const from = -this.leafPivot.rotation.y / DOOR_OPEN;
    this.doorAnim = { from, to: this.doorOpen ? 1 : 0, start: performance.now() };
    this.onDoor?.(this.doorOpen);
  }

  /** Show steps 0..s-1 built; with `animate`, step s-1 plays instead of appearing finished. */
  /** Any input: holds off the idle orbit. */
  poke() {
    this.lastInput = performance.now();
  }

  idleFor(now = performance.now()) {
    return now - this.lastInput;
  }

  /** Relax mode once the ger is built: the sky turns by itself. */
  setChill(on) {
    this.chill = on;
    this.sky.setPlaying(on);
    this.poke();
  }

  /** Lean the view toward a part: n = 0 is `base`, 1 is fully in (closer, looking at y). */
  applyFocus(base, n, y = base.y) {
    const c = this.controls;
    const dir = this.camera.position.clone().sub(c.target).normalize();
    c.target.y = base.y + (y - base.y) * n;
    this.camera.position.copy(c.target).addScaledVector(dir, base.radius * (1 - FOCUS_ZOOM * n));
  }

  updateFocus(now) {
    const f = this.focus;
    if (!f) return;
    const el = now - f.start;
    const ease = (x) => easeInOut(clamp01(x));
    const n = el < f.animMs ? ease(el / FOCUS_IN_MS) : 1 - ease((el - f.animMs) / FOCUS_OUT_MS);
    this.applyFocus(f.base, n, f.y);
    if (el >= f.animMs + FOCUS_OUT_MS) this.focus = null;
  }

  // ── the map: click to unroll and read it, click again to roll it up ──────────
  /** Is the pointer (or, with the pointer locked, the crosshair) on the map? */
  hitsMap(e) {
    if (!this.inside || !this.map?.visible) return false;
    const r = this.canvas.getBoundingClientRect();
    const locked = document.pointerLockElement === this.canvas;
    const ndc = locked
      ? new THREE.Vector2(0, 0)
      : new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObject(this.map, true).length > 0;
  }

  toggleMap() {
    if (this.mapAnim || this.fly) return; // let the roll / the camera finish first
    const r = this.mapRoll;
    const open = !this.mapOpen;
    const [f0, f1] = open ? MAP_OPEN : MAP_CLOSE;
    this.mapAnim = { f0, f1, start: performance.now(), ms: ((f1 - f0) / r.fps / MAP_SPEED) * 1000 };
    this.mapOpen = open;
    this.onMapRoll?.(open, this.mapAnim.ms);
    if (open) {
      // step up to the sheet, close enough that it fills most of the view
      this.mapBack = [...this.camera.position.toArray(), ...this.controls.target.toArray()];
      const fit = Math.max(MAP_SIZE.h, MAP_SIZE.w / this.camera.aspect) * MAP_FIT;
      const d = fit / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const eye = MAP_CENTER.clone().add(new THREE.Vector3(0, 0, d));
      const view = [
        ...eye.toArray(),
        ...eye
          .clone()
          .add(new THREE.Vector3(0, 0, -0.3))
          .toArray(),
      ];
      this.mapFocused = true;
      this.onMapFocus?.(true);
      // the page on the sheet has buttons and a text box: give the mouse back to click them
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.flyTo([{ view, ms: MAP_FLY_MS }], () => this.holdInside());
    } else {
      this.onMapShown?.(false);
      this.flyTo([{ view: this.mapBack, ms: MAP_FLY_MS }], () => {
        this.holdInside();
        this.mapFocused = false;
        this.onMapFocus?.(false);
      });
    }
  }

  /** Where the flat sheet is on screen (CSS pixels), to lay the page over it. */
  mapRect() {
    const r = this.canvas.getBoundingClientRect();
    const corners = [
      [-MAP_SIZE.w / 2, MAP_CENTER.y - MAP_SIZE.h / 2],
      [MAP_SIZE.w / 2, MAP_CENTER.y + MAP_SIZE.h / 2],
    ].map(([x, y]) => {
      const v = new THREE.Vector3(x, y, MAP_POS.z).project(this.camera);
      return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
    });
    const [[x0, y1], [x1, y0]] = corners;
    return { left: r.left + x0, top: r.top + y0, width: x1 - x0, height: y1 - y0 };
  }

  /** After a flight inside: first person again (mouse + W A S D), the orbit controls off. */
  holdInside() {
    this.setLimits("inside");
    this.controls.enabled = false;
    this.readHead();
  }

  /** The map's roll at this moment: rolled up, unrolling, open or rolling up (Blender's curve). */
  updateMap(now) {
    const r = this.mapRoll;
    if (!r || !this.mapMeshes.length || !this.map.visible) return;
    const curve = r.rollCurve;
    let roll = this.mapOpen ? 0 : r.rollMax;
    const a = this.mapAnim;
    if (a) {
      const k = clamp01((now - a.start) / a.ms);
      const f = a.f0 - 1 + (a.f1 - a.f0) * k; // curve[0] is frame 1
      const i = Math.min(Math.floor(f), curve.length - 2);
      roll = THREE.MathUtils.lerp(curve[i], curve[i + 1], f - i);
      if (k >= 1) {
        this.mapAnim = null;
        if (this.mapOpen) this.onMapShown?.(true); // flat and in front of the camera: show the page
      }
    }
    // at night the sheet glows by its own picture, most when it is open to be read
    const glow = this.sky.nightAmount() * MAP_GLOW * (1 - (roll / r.rollMax) * 0.85);
    for (const o of this.mapMeshes) for (const m of [o.material].flat()) m.emissiveIntensity = glow;
    // blend the two baked shape keys either side of this roll (key k is roll max·k/steps, 0 = flat)
    const t = (roll / r.rollMax) * r.rollSteps;
    const k = Math.min(Math.floor(t), r.rollSteps - 1);
    for (const { morphTargetInfluences: w } of this.mapMeshes) {
      w.fill(0);
      if (k >= 1) w[k - 1] = 1 - (t - k);
      w[k] = t - k;
    }
  }

  /** Point the target just ahead of the eye along yaw / pitch (yaw 0 looks down -z). */
  applyHead() {
    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cp,
    );
    this.controls.target.copy(this.camera.position).addScaledVector(dir, 0.3);
  }

  /** Take yaw / pitch from where the camera looks now. */
  readHead() {
    const d = this.controls.target.clone().sub(this.camera.position).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  }

  /** W A S D inside the ger: move eye and target together, kept off the wall and the poles. */
  updateWalk(dt) {
    if (!this.inside || this.fly || this.mapFocused || !this.walkKeys.size) return;
    let fwd = 0,
      right = 0;
    for (const k of this.walkKeys) {
      fwd += WALK_KEYS[k][0];
      right += WALK_KEYS[k][1];
    }
    if (!fwd && !right) return;
    const c = this.controls;
    const look = c.target.clone().sub(this.camera.position);
    const f = new THREE.Vector2(look.x, look.z).normalize(); // facing, on the floor
    const r = new THREE.Vector2(-f.y, f.x); // to the right of it
    const step = f
      .multiplyScalar(fwd)
      .add(r.multiplyScalar(right))
      .normalize()
      .multiplyScalar(WALK_SPEED * dt);
    const at = new THREE.Vector2(this.camera.position.x, this.camera.position.z);
    const next = at.clone().add(step);
    if (next.length() > WALK_RADIUS) next.setLength(WALK_RADIUS); // slide along the wall
    // the sheet hangs across x -0.3 … 0.3 at z = MAP_POS.z: keep off its nearest point
    const onSheet = new THREE.Vector2(
      THREE.MathUtils.clamp(next.x, -MAP_SIZE.w / 2, MAP_SIZE.w / 2),
      MAP_POS.z,
    );
    const fromSheet = next.clone().sub(onSheet);
    if (fromSheet.length() < MAP_CLEAR) {
      if (fromSheet.lengthSq() === 0) fromSheet.set(0, 1); // right on it: step back toward the door
      next.copy(onSheet).add(fromSheet.setLength(MAP_CLEAR));
    }
    for (const p of POLES) {
      const d = next.clone().sub(p);
      if (d.length() < POLE_CLEAR) next.copy(p).add(d.setLength(POLE_CLEAR)); // slide round the pole
    }
    const dx = next.x - at.x,
      dz = next.y - at.y;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
    c.target.x += dx;
    c.target.z += dz;
    this.poke();
  }

  updateOrbit(now) {
    if (this.inIntro || BARE) return; // the intro keeps its own orbit; bare mode has none
    const c = this.controls;
    c.autoRotate = !this.inside && !this.fly && !this.active && this.idleFor(now) > IDLE_MS;
    c.autoRotateSpeed = INTRO_SPIN;
  }

  goTo(s, animate) {
    this.active = null;
    this.poke();
    // the camera's step move: put the view back first, then drift in on the new part
    const base = this.focus?.base;
    if (base) this.applyFocus(base, 0);
    this.focus = null;
    if (animate && s > 0 && s <= this.steps.length) {
      const c = this.controls;
      this.focus = {
        base: base ?? { radius: this.camera.position.distanceTo(c.target), y: c.target.y },
        y: STEP_FOCUS_Y[s - 1] ?? c.target.y,
        start: performance.now(),
        animMs: (this.steps[s - 1].frames / (FPS * SPEED)) * 1000,
      };
    }
    // the door only works on the finished ger, and starts shut
    this.built = s === this.steps.length;
    if (this.map) this.map.visible = this.built;
    wind.uClear.value = this.built ? FLOOR_RADIUS : 0;
    this.doorOpen = false;
    this.doorAnim = null;
    if (this.leafPivot) this.leafPivot.rotation.y = 0;
    if (!this.built) this.canvas.style.cursor = "";
    this.steps.forEach((st, i) => {
      const shown = i < s;
      for (const root of st.roots) root.visible = shown;
      if (!shown) st.apply(0);
      else if (i === s - 1 && animate) {
        st.apply(0);
        this.setShadows(st, false);
        this.active = { step: st, start: performance.now() };
        this.aoFadeFrom = null;
      } else this.finish(st);
    });
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.sky.update(now);
    this.clouds?.update(now);
    const night = this.sky.nightAmount();
    this.nightFill.intensity = 28 * night;
    // the hearth flickers a little
    this.hearth.intensity =
      night * (14 + 1.5 * Math.sin(now * 0.011) + Math.sin(now * 0.027 + 1.3));
    this.bakeEnvironment(now);
    updateSteppe(dt);
    this.updateLook(dt);
    if (this.active) {
      const { step, start } = this.active;
      const t = ((now - start) / 1000) * FPS * SPEED;
      if (t >= step.frames) {
        this.finish(step);
        this.active = null;
        this.aoFadeFrom = now;
        this.onStepDone?.();
      } else step.apply(t);
    }
    if (this.doorAnim) {
      const { from, to, start } = this.doorAnim;
      const k = clamp01(
        (((now - start) / 1000) * FPS * SPEED) / (DOOR_FRAMES * Math.abs(to - from) || 1),
      );
      this.leafPivot.rotation.y = -DOOR_OPEN * (from + (to - from) * easeInOut(k));
      if (k >= 1) this.doorAnim = null;
    }
    this.updateFly(now);
    this.updateWalk(dt);
    this.updateMap(now);
    if (this.inside && !this.fly) {
      const near = isNearDoor(this.camera.position);
      if (near !== this.nearDoor) this.onNearDoor?.((this.nearDoor = near));
    }
    this.updateFocus(now);
    this.updateOrbit(now);
    this.controls.update(dt); // aims the camera at the ger (dt paces the intro's slow orbit)…
    if (this.lookUp > 0) this.camera.rotateX(this.lookUp); // …then tilts it up toward the sky
    if (this.composer && this.quality?.ao !== false) {
      // GTAO renders depth without the vertex animation, so it is off while a step plays
      const k = this.active
        ? 0
        : this.aoFadeFrom == null
          ? 1
          : clamp01((now - this.aoFadeFrom) / 600);
      this.gtao.blendIntensity = k;
      this.gtao.enabled = k > 0;
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.canvas.removeEventListener("click", this.onClick);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseLook);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.composer?.dispose();
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.sky.dispose();
    this.clouds?.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        for (const mat of [].concat(o.material)) mat.dispose();
      }
    });
    this.renderer.dispose();
  }
}
