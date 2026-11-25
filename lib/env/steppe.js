// ── steppe: Blender landscape (ground, mountains, rocks) + shader grass ─────
// Ported from the geree project; the landscape is used at its modelled size (1 unit = 1 m),
// the same scale as the ger exported from ger.blend.
//
// public/models/tal_base.glb   ground / mountains / rocks exported from Blender
// public/models/tal_grass.bin  one record per grass tuft: x, y, z, scale, type (5 × float32, metres, Y-up)
// Each tuft is grown into 10–24 blades here; every blade is one instance of an 8-vertex strip,
// bent by wind in the vertex shader (the same technique as screen.toys/firewood).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mountainMaterial, mountainShape, rockMaterial, rockShape } from "./stone.js";

const LAND_SCALE = 1; // landscape size; 1 = as modelled in Blender
const CLEAR_R = 3.6; // radius around the ger kept free of grass (scene units)
const GROUND_TILE = 2.5; // metres of ground covered by one copy of the grass photo
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const DENSITY = isMobile ? 0.35 : 1; // share of blades drawn

// tuft types exported from Blender: green / dry / feather grass (khyalgana)
const TYPES = [
  { blades: 24, h: 0.28, w: 0.008, bend: 1.0, spread: 0.06 },
  { blades: 18, h: 0.35, w: 0.006, bend: 1.3, spread: 0.05 },
  { blades: 10, h: 0.75, w: 0.003, bend: 0.9, spread: 0.025 },
].map((t, i) => ({ ...t, look: i }));
// types 3–5: the same grasses for the far field, fewer but wider blades per tuft
TYPES.push(
  ...TYPES.map((t) => ({
    ...t,
    blades: Math.min(t.blades, 8),
    w: t.w * 2,
    spread: t.spread * 2.5,
  })),
);

const FILE_EDGE = 30; // landscape metres where the Blender tufts start thinning out
const FAR_EDGE = 147; // the ground ends at ±150
const FAR_TUFTS = isMobile ? 25000 : 60000;

/** Wind uniforms; change `uWind` (0 = calm, ~0.9 = strong) to set the wind. */
const reduced =
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const wind = {
  uTime: { value: 0 },
  uWind: { value: reduced ? 0.1 : 0.45 },
  uSpeed: { value: 1.0 },
  uLandScale: { value: LAND_SCALE },
  uClear: { value: 0 }, // no blades within this radius of the origin (the ger's floor)
};

/** Give the terrain planar x/z UVs in metres / GROUND_TILE and the grass photo as its colour map. */
function textureGround(mesh, groundTex) {
  const pos = mesh.geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / GROUND_TILE;
    uv[i * 2 + 1] = pos.getZ(i) / GROUND_TILE;
  }
  mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  mesh.material.map = groundTex;
  mesh.material.vertexColors = false;
  mesh.material.color.set("#ffffff");
  // hide the repeat: mix in a second, much larger and rotated copy of the photo
  mesh.material.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <map_fragment>",
      `
      vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.19 + 0.37;
      vec4 texelColor = mix(texture2D(map, vMapUv), texture2D(map, uvB), 0.5);
      // far off the photo reads as a mown lawn: shift it toward the patchy green/dry steppe of the blades
      vec2 m = vMapUv * ${GROUND_TILE.toFixed(2)};
      float far = smoothstep(18.0, 70.0, length(m));
      float dry = 0.5 + 0.5 * sin(m.x * 0.13 + sin(m.y * 0.09) * 2.0) * sin(m.y * 0.11 + sin(m.x * 0.07) * 2.5);
      vec3 steppe = mix(vec3(0.10, 0.14, 0.035), vec3(0.28, 0.24, 0.10), smoothstep(0.3, 0.8, dry));
      float luma = dot(texelColor.rgb, vec3(0.3, 0.6, 0.1));
      texelColor.rgb = mix(texelColor.rgb, steppe * (0.55 + 2.2 * luma), far * 0.75);
      diffuseColor *= texelColor;
    `,
    );
  };
  mesh.material.needsUpdate = true;
}

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bladeGeometry() {
  const pos = [],
    uv = [],
    normal = [],
    idx = [];
  const taper = [1.0, 0.75, 0.47, 0.05];
  for (let r = 0; r <= 3; r++) {
    const t = r / 3,
      w = 0.5 * taper[r];
    pos.push(-w, t, 0, w, t, 0);
    uv.push(0, t, 1, t);
    normal.push(0, 0, 1, 0, 0, 1);
  }
  for (let s = 0; s < 3; s++) {
    const a = s * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function grassMaterial() {
  const m = new THREE.MeshStandardMaterial({
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, wind);
    sh.vertexShader =
      `
      attribute vec4 aA;   // base xyz, height
      attribute vec4 aB;   // rotY, lean, width, phase
      attribute vec2 aC;   // colour mix, type
      uniform float uTime, uWind, uSpeed, uLandScale, uClear;
      varying float vGrassH, vMix, vType;
    ` +
      sh.vertexShader
        .replace(
          "#include <beginnormal_vertex>",
          `
        float cN = cos(aB.x), sN = sin(aB.x);
        vec3 objectNormal = normalize(vec3(-sN, 0.0, cN) * 0.45 + vec3(0.0, 0.55, 0.0));
      `,
        )
        .replace(
          "#include <begin_vertex>",
          `
        float t = uv.y;
        float H = aA.w;
        vec3 base = aA.xyz;
        vec3 p = vec3(position.x * aB.z, t * H, aB.y * t * t);
        // widen distant blades so the field stays full instead of shimmering
        vec3 worldBase = (modelMatrix * vec4(base, 1.0)).xyz;
        p.x *= 1.0 + length(cameraPosition - worldBase) / uLandScale * 0.035;
        float c = cos(aB.x), s = sin(aB.x);
        p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
        // wind: travelling gusts + per-blade flutter, bending from the root (t^2)
        float stiff = aC.y > 1.5 ? 1.6 : (aC.y > 0.5 ? 1.0 : 0.8);
        float g = 0.5 + 0.5 * sin(base.x * 0.11 - uTime * uSpeed * 1.3 + sin(base.z * 0.07 + uTime * 0.21) * 2.0);
        g *= g;
        float flutter = sin(uTime * 3.1 + aB.w + base.x * 0.9) * 0.22 + sin(uTime * 5.3 + aB.w * 1.7) * 0.07;
        float sway = (0.15 + 0.85 * g + flutter) * uWind * stiff * t * t * H;
        p.x += sway;
        p.z += sway * 0.35 * cos(uTime * 0.6 + aB.w);
        p.y -= sway * sway / max(2.0 * H, 0.01) * 0.6;
        vec3 transformed = p + base;
        if (length(worldBase.xz) < uClear) transformed = base; // inside the ger: fold the blade away
        vGrassH = t; vMix = aC.x; vType = aC.y;
      `,
        );
    sh.fragmentShader =
      `
      varying float vGrassH, vMix, vType;
    ` +
      sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          `
        #include <color_fragment>
        vec3 b0, b1;
        if (vType < 0.5)      { b0 = vec3(0.040, 0.085, 0.018); b1 = vec3(0.30, 0.42, 0.080); }
        else if (vType < 1.5) { b0 = vec3(0.130, 0.110, 0.035); b1 = vec3(0.60, 0.48, 0.190); }
        else                  { b0 = vec3(0.200, 0.200, 0.110); b1 = vec3(0.78, 0.75, 0.600); }
        vec3 col = mix(b0, b1, smoothstep(0.0, 1.0, vGrassH));
        col = mix(col, vec3(0.50, 0.42, 0.18) * mix(0.4, 1.0, vGrassH), vMix * 0.35 * step(vType, 0.5));
        col *= 0.8 + 0.4 * vMix;
        diffuseColor.rgb = col;
      `,
        )
        .replace(
          "#include <normal_fragment_begin>",
          `
        // both sides of a blade share one up-leaning normal, so back faces are not dark
        float faceDirection = 1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;
      `,
        )
        .replace(
          "#include <lights_fragment_end>",
          `
        #include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          // light through the blade when looking toward the sun; thin tips glow most
          vec3 Ls = directionalLights[0].direction;
          float sss = pow(max(0.0, dot(-normalize(vViewPosition), Ls)), 3.0) * 1.1 * vGrassH;
          reflectedLight.directDiffuse += vec3(0.55, 0.72, 0.18) * directionalLights[0].color * sss * diffuseColor.rgb;
        #endif
      `,
        );
  };
  return m;
}

/** Terrain height in landscape metres at (x, z), read from the regular vertex grid of the ground mesh. */
function heightField(ground) {
  const pos = ground.geometry.attributes.position;
  ground.geometry.computeBoundingBox();
  const N = Math.round(Math.sqrt(pos.count)),
    lo = ground.geometry.boundingBox.min.x,
    hi = ground.geometry.boundingBox.max.x;
  const step = (hi - lo) / (N - 1);
  const H = new Float32Array(N * N).fill(NaN);
  for (let i = 0; i < pos.count; i++) {
    const ix = Math.round((pos.getX(i) - lo) / step),
      iz = Math.round((pos.getZ(i) - lo) / step);
    H[iz * N + ix] = pos.getY(i);
  }
  return (x, z) => {
    const fx = (x - lo) / step,
      fz = (z - lo) / step;
    const ix = Math.min(N - 2, Math.max(0, Math.floor(fx))),
      iz = Math.min(N - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - ix,
      tz = fz - iz;
    const a = H[iz * N + ix],
      b = H[iz * N + ix + 1],
      c = H[(iz + 1) * N + ix],
      d = H[(iz + 1) * N + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

/** Tuft records (same layout as tal_grass.bin) for the ground beyond the Blender grass, thinning with distance. */
function farTufts(ground) {
  const heightAt = heightField(ground);
  const rand = rng(11);
  const out = new Float32Array(FAR_TUFTS * 5);
  let k = 0;
  for (let guard = 0; k < FAR_TUFTS && guard < FAR_TUFTS * 40; guard++) {
    const x = (rand() * 2 - 1) * FAR_EDGE,
      z = (rand() * 2 - 1) * FAR_EDGE;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge < FILE_EDGE) continue;
    // fade in over the band where the Blender tufts fade out
    if (rand() > Math.min(1, (edge - FILE_EDGE) / 8)) continue;
    if (rand() > Math.pow(FILE_EDGE / Math.hypot(x, z), 1.1)) continue;
    const y = heightAt(x, z);
    if (Number.isNaN(y)) continue;
    const t = rand();
    out.set([x, y, z, 0.8 + rand() * 0.6, 3 + (t < 0.5 ? 0 : t < 0.9 ? 1 : 2)], k * 5);
    k++;
  }
  return out.subarray(0, k * 5);
}

/** Grow blades from the tuft records, skipping the ger's plot. */
function buildGrass(F) {
  const clear = CLEAR_R / LAND_SCALE; // in landscape metres
  const tufts = [];
  for (let i = 0; i < F.length; i += 5) {
    if (F[i] * F[i] + F[i + 2] * F[i + 2] > clear * clear) tufts.push(i);
  }
  let total = 0;
  for (const i of tufts) total += TYPES[F[i + 4]].blades;

  const A = new Float32Array(total * 4),
    B = new Float32Array(total * 4),
    C = new Float32Array(total * 2);
  const rand = rng(7);
  // round-robin order: a lower instance count removes blades evenly from every tuft
  let k = 0;
  for (let r = 0; r < 24; r++) {
    for (const i of tufts) {
      const T = TYPES[F[i + 4]];
      if (r >= T.blades) continue;
      const sc = F[i + 3];
      const ang = rand() * Math.PI * 2,
        rad = Math.sqrt(rand()) * T.spread * sc * 1.25;
      const H = T.h * (0.55 + rand() * 0.55) * sc;
      A.set([F[i] + Math.cos(ang) * rad, F[i + 1], F[i + 2] + Math.sin(ang) * rad, H], k * 4);
      B.set(
        [
          rand() * Math.PI * 2,
          (0.15 + rand() * 0.45) * T.bend * H,
          T.w * (0.7 + rand() * 0.6) * sc * 1.3,
          rand() * Math.PI * 2,
        ],
        k * 4,
      );
      C.set([rand(), T.look], k * 2);
      k++;
    }
  }

  const blade = bladeGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  for (const n of ["position", "normal", "uv"]) geo.setAttribute(n, blade.getAttribute(n));
  geo.setAttribute("aA", new THREE.InstancedBufferAttribute(A, 4));
  geo.setAttribute("aB", new THREE.InstancedBufferAttribute(B, 4));
  geo.setAttribute("aC", new THREE.InstancedBufferAttribute(C, 2));
  geo.instanceCount = Math.round(total * DENSITY);
  const mesh = new THREE.Mesh(geo, grassMaterial());
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Load the landscape and grow the grass. Resolves to { group, grass } where grass is the blade mesh
 * (put it on a layer the AO pass skips: its depth pass would not run the blade vertex shader).
 */
export async function loadSteppe(renderer, manager) {
  const groundTex = new THREE.TextureLoader(manager).load("/textures/grass.jpg");
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.wrapS = groundTex.wrapT = THREE.MirroredRepeatWrapping;
  groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const [gltf, buf] = await Promise.all([
    new GLTFLoader(manager).loadAsync("/models/tal_base.glb"),
    fetch("/models/tal_grass.bin").then((r) => r.arrayBuffer()),
  ]);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.receiveShadow = !/Uul/.test(o.name);
    o.castShadow = /Khad/.test(o.name);
    o.material.roughness = 1;
    o.material.metalness = 0;
  });
  const rocks = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (/Uul/.test(o.name)) {
      mountainShape(o.geometry, o.matrixWorld);
      mountainMaterial(o.material);
    }
    if (/Khad/.test(o.name)) {
      rockShape(o.geometry, rocks.length + 1);
      rockMaterial(o.material);
      rocks.push(o);
    }
  });
  let ground;
  gltf.scene.getObjectByName("Gazar").traverse((o) => {
    if (o.isMesh) {
      textureGround(o, groundTex);
      ground = o;
    }
  });
  const near = new Float32Array(buf),
    far = farTufts(ground);
  const tufts = new Float32Array(near.length + far.length);
  tufts.set(near);
  tufts.set(far, near.length);
  const land = new THREE.Group();
  land.scale.setScalar(LAND_SCALE);
  const grass = buildGrass(tufts);
  land.add(gltf.scene, grass);
  land.updateMatrixWorld(true);
  // lift/lower the landscape so the terrain under the ger (x = z = 0) sits at y = 0
  const terrain = land.getObjectByName("Gazar");
  const hit = new THREE.Raycaster(
    new THREE.Vector3(0, 100, 0),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(terrain, true)[0];
  if (hit) land.position.y = -hit.point.y;
  land.updateMatrixWorld(true);
  land.add(scatterStones(rocks, terrain, land));
  return { group: land, grass };
}

/** Half-buried broken stones around each big rock, so the boulders sit in the ground instead of on it. */
function scatterStones(rocks, terrain, land) {
  const stones = new THREE.Group();
  const toLand = land.matrixWorld.clone().invert();
  const rand = rng(23);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0),
    c = new THREE.Vector3(),
    size = new THREE.Vector3();
  rocks.forEach((rock, ri) => {
    rock.getWorldPosition(c);
    new THREE.Box3().setFromObject(rock).getSize(size);
    const R = Math.max(size.x, size.z) * 0.5;
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2,
        d = R * (0.8 + rand() * 1.4);
      ray.set(new THREE.Vector3(c.x + Math.cos(a) * d, c.y + 50, c.z + Math.sin(a) * d), down);
      const hit = ray.intersectObject(terrain, true)[0];
      if (!hit) continue;
      const s = R * (0.06 + Math.pow(rand(), 2.5) * 0.3);
      const geo = rocks[(ri + i) % rocks.length].geometry;
      const stone = new THREE.Mesh(geo, rock.material);
      stone.scale.set(s * (0.8 + rand() * 0.6), s * (0.5 + rand() * 0.4), s * (0.8 + rand() * 0.6));
      stone.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4);
      stone.position.copy(hit.point).y -= s * 0.15;
      stone.applyMatrix4(toLand); // stones live inside the landscape group
      stone.castShadow = stone.receiveShadow = true;
      stones.add(stone);
    }
  });
  return stones;
}

/** Advance the wind; called once per frame. */
export function updateSteppe(dt) {
  wind.uTime.value += dt;
}
