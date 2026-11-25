// ── stone: procedural shading for the mountains and rocks of the steppe ──────
//
// Both materials keep three's lighting/shadows (onBeforeCompile) and add, in world space:
//   colour from 3D noise (slope/height for the mountains, granite + lichen for rocks),
//   a noise bump on the normal, and for the mountains an aerial haze that fades them
//   into the fog colour with distance — the main cue that they are far away.
// rockShape() also chips flat faces into the round Blender rocks.

import * as THREE from "three";

const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

const NOISE = `
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
                   mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
                   mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < ${isMobile ? 3 : 5}; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return s;
  }
  // sharp crests where the noise crosses 0.5: cracks and ridgelines
  float ridged(vec3 p) { return 1.0 - abs(2.0 * fbm(p) - 1.0); }
  vec3 bumpGrad(vec3 p, float h, float e) {
    return vec3(bumpH(p + vec3(e, 0, 0)) - h, bumpH(p + vec3(0, e, 0)) - h, bumpH(p + vec3(0, 0, e)) - h) / e;
  }
`;

/**
 * Patch a MeshStandardMaterial: `bumpH` (GLSL body of float bumpH(vec3 p)) is the bump height
 * field, `colour` (GLSL) sets diffuseColor.rgb and vec3 bumpG from P (world pos), N (world normal),
 * O (object pos); `haze` > 0 replaces the fog with a stronger distance haze. With `ridge`, the
 * geometry's aRidge attribute (1 on crests, 0 in gullies) reaches `colour` as vRidge.
 */
function stoneMaterial(m, key, { bumpH, colour, haze = 0, ridge = false }) {
  m.vertexColors = false;
  m.color.set("#ffffff");
  m.map = null;
  m.roughness = 1;
  m.metalness = 0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHaze = { value: haze };
    sh.vertexShader =
      `
      varying vec3 vWPos, vWNrm, vOPos;
      ${ridge ? "attribute float aRidge; varying float vRidge;" : ""}
    ` +
      sh.vertexShader.replace(
        "#include <project_vertex>",
        `
      #include <project_vertex>
      vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWNrm = normalize(transpose(inverse(mat3(modelMatrix))) * objectNormal);
      vOPos = transformed;
      ${ridge ? "vRidge = aRidge;" : ""}
    `,
      );
    sh.fragmentShader =
      `
      varying vec3 vWPos, vWNrm, vOPos;
      ${ridge ? "varying float vRidge;" : ""}
      uniform float uHaze;
      float bumpH(vec3 p);
      ${NOISE}
      float bumpH(vec3 p) { ${bumpH} }
    ` +
      sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          `
        vec3 P = vWPos, N = normalize(vWNrm), O = vOPos;
        vec3 bumpG = vec3(0.0);
        ${colour}
      `,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `
        #include <normal_fragment_maps>
        {
          vec3 nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          nw = normalize(nw - (bumpG - dot(bumpG, nw) * nw));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }
      `,
        )
        .replace(
          "#include <fog_fragment>",
          haze
            ? `
        #ifdef USE_FOG
          // thicker air low down, thinner toward the peaks; distant air is a little blue
          float hz = 1.0 - exp(-length(P - cameraPosition) * uHaze);
          hz *= mix(1.0, 0.7, smoothstep(0.0, 60.0, P.y));
          vec3 air = fogColor * vec3(0.8, 0.9, 1.04);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, air, clamp(hz, 0.0, 0.28));
        #endif
      `
            : "#include <fog_fragment>",
        );
  };
  // three caches programs by onBeforeCompile's source text, which is the same for every stone material
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
  return m;
}

/**
 * Mountains, as in the Khangai: steppe grass on the sunny slopes, dark larch forest on the
 * north-facing ones, bare rock and scree on steep faces and crests, a little old snow up top.
 */
export function mountainMaterial(m) {
  return stoneMaterial(m, "mountain", {
    haze: 0.0011, // per metre; geree used 0.0085 with the landscape at 0.4 scale
    ridge: true,
    bumpH: `return fbm(p * 0.35) * 0.8 + ridged(p * 0.12) * 1.4;`,
    colour: `
      float n1 = fbm(P * 0.015), n2 = fbm(P * 0.06), n3 = fbm(P * 0.18);
      float slope = 1.0 - N.y;
      float h = P.y;
      // away from the noon sun (it stands toward -0.57, -0.83)
      float north = dot(normalize(N.xz + 1e-4), vec2(0.565, 0.825)) * length(N.xz);

      // steppe grass: olive, drying to straw on the sunny side and higher up
      vec3 grass = mix(vec3(0.085, 0.115, 0.035), vec3(0.19, 0.18, 0.07), smoothstep(0.3, 0.7, n1));
      grass = mix(grass, vec3(0.2, 0.17, 0.07), smoothstep(0.0, -0.4, north) * 0.3 + smoothstep(40.0, 90.0, h) * 0.25);
      grass *= 0.85 + 0.3 * n3;

      // larch forest in patches on the shaded slopes, below the tree line
      float forest = smoothstep(0.0, 0.2, north + (n2 - 0.5) * 0.6)
                   * smoothstep(8.0, 20.0, h) * (1.0 - smoothstep(70.0, 95.0, h + (n1 - 0.5) * 30.0))
                   * (1.0 - smoothstep(0.5, 0.7, slope));
      forest *= smoothstep(0.47, 0.56, n2 + (n3 - 0.5) * 0.15);   // stands with clearings between
      forest = max(forest, smoothstep(0.35, 0.1, vRidge) * smoothstep(0.3, 0.0, -north) * smoothstep(6.0, 15.0, h) * 0.85);
      vec3 trees = vec3(0.022, 0.036, 0.02) * (0.6 + 0.8 * vnoise(P * 0.8));

      // rock on steep faces and the crests, streaked down the fall line into gullies
      float rockAmt = smoothstep(0.5, 0.72, slope + (n2 - 0.5) * 0.3 + (vRidge - 0.5) * 0.25);
      rockAmt = max(rockAmt, smoothstep(70.0, 90.0, h + (n1 - 0.5) * 30.0) * smoothstep(0.3, 0.5, slope) * 0.8);
      vec3 rock = mix(vec3(0.13, 0.12, 0.11), vec3(0.27, 0.25, 0.22), n2);
      rock *= 0.8 + 0.4 * fbm(vec3(P.x * 0.25, P.y * 0.03, P.z * 0.25));   // vertical streaks
      vec3 scree = vec3(0.27, 0.25, 0.22) * (0.85 + 0.3 * n3);
      float screeAmt = smoothstep(0.35, 0.5, slope) * (1.0 - rockAmt) * smoothstep(0.5, 0.62, n3);

      vec3 col = mix(grass, trees, forest);
      col = mix(col, scree, screeAmt * 0.7);
      col = mix(col, rock, rockAmt);

      // old snow on the highest, flatter ground and in the shaded hollows
      float snow = smoothstep(84.0, 92.0, h + (n2 - 0.5) * 12.0 + north * 6.0) * smoothstep(0.6, 0.3, slope) * smoothstep(0.1, 0.4, north);
      col = mix(col, vec3(0.82, 0.84, 0.86), snow);

      // gullies hold shadow and moisture, crests catch light
      col *= mix(0.62, 1.12, smoothstep(0.0, 0.8, vRidge));

      diffuseColor.rgb = col;
      float hb = bumpH(P);
      bumpG = bumpGrad(P, hb, 0.3) * mix(0.25, 0.8, rockAmt) * (1.0 - forest * 0.5);
    `,
  });
}

/** Rocks: grey granite with darker cracks, yellow lichen, moss on top and soil at the base. */
export function rockMaterial(m) {
  return stoneMaterial(m, "rock", {
    bumpH: `return fbm(p * 9.0) * 0.25 + ridged(p * 2.2) * 0.35 + fbm(p * 28.0) * 0.05;`,
    colour: `
      float n1 = fbm(P * 1.3), n2 = fbm(P * 6.0);
      vec3 col = mix(vec3(0.11, 0.105, 0.1), vec3(0.32, 0.30, 0.275), n1);
      col *= 0.75 + 0.5 * n2;
      // fine speckle of granite grains
      col *= 0.85 + 0.3 * step(0.72, vnoise(P * 60.0));
      float crack = smoothstep(0.93, 0.99, ridged(P * 2.2));
      col *= 1.0 - crack * 0.55;
      float lichen = smoothstep(0.58, 0.63, fbm(P * 8.0 + 7.0));
      col = mix(col, vec3(0.40, 0.37, 0.20), lichen * 0.6);
      float orange = smoothstep(0.66, 0.69, fbm(P * 10.0 + 31.0));
      col = mix(col, vec3(0.45, 0.17, 0.04), orange * 0.4);
      float moss = smoothstep(0.55, 0.95, N.y) * smoothstep(0.45, 0.62, n1);
      col = mix(col, vec3(0.045, 0.07, 0.02), moss * 0.7);
      col = mix(vec3(0.07, 0.055, 0.035), col, smoothstep(-0.45, -0.05, O.y));   // soil at the base
      diffuseColor.rgb = col;
      float hb = bumpH(P);
      bumpG = bumpGrad(P, hb, 0.01) * 0.35;
    `,
  });
}

function rand(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Lumpy noise and a few flat cleavage planes, so a smooth blob reads as broken stone. */
export function rockShape(geo, seed) {
  const r = rand(seed * 7919 + 13);
  const planes = [];
  for (let i = 0; i < 6; i++) {
    const n = new THREE.Vector3(r() * 2 - 1, r() * 1.2 - 0.1, r() * 2 - 1).normalize();
    planes.push([n, 0.62 + r() * 0.3]);
  }
  const off = new THREE.Vector3(r() * 50, r() * 50, r() * 50);
  const pos = geo.attributes.position,
    v = new THREE.Vector3(),
    q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    q.copy(v).multiplyScalar(1.8).add(off);
    v.multiplyScalar(
      1 + (noise3(q.x, q.y, q.z) - 0.5) * 0.35 + (noise3(q.x * 3, q.y * 3, q.z * 3) - 0.5) * 0.1,
    );
    for (const [n, d] of planes) {
      const over = v.dot(n) - d;
      if (over > 0) v.addScaledVector(n, -over * 0.9);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
}

/**
 * Make the Blender mountain ring read as a real range: push it out and up (the foothills next to the
 * plain stay put), then carve eroded ridges and gullies into the slopes with ridged noise.
 * `matrix` is the mesh's world matrix; the work is done in world metres (y up).
 */
export function mountainShape(geo, matrix) {
  const R0 = 112; // the plain ends here; nothing inside moves
  const inv = matrix.clone().invert();
  const pos = geo.attributes.position,
    v = new THREE.Vector3();
  const ridge = new Float32Array(pos.count).fill(0.5);
  const fbm = (x, z, oct) => {
    let s = 0,
      a = 0.5;
    for (let i = 0; i < oct; i++) {
      s += a * noise3(x, 0.5 + i * 7.3, z);
      x = x * 2.03 + 1.7;
      z = z * 2.03 + 9.2;
      a *= 0.5;
    }
    return s;
  };
  // ridged multifractal: sharp crests, each octave weighted by the one above it, like erosion leaves
  const ridges = (x, z) => {
    let s = 0,
      a = 0.5,
      w = 1;
    for (let i = 0; i < 5; i++) {
      let n = 1 - Math.abs(2 * noise3(x, 3.1 + i * 5.7, z) - 1);
      n *= n * w;
      w = Math.min(1, n * 1.6);
      s += n * a;
      x = x * 2.1 + 4.3;
      z = z * 2.1 + 1.1;
      a *= 0.5;
    }
    return s;
  };
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    const r = Math.hypot(v.x, v.z);
    const t = THREE.MathUtils.smoothstep(r, R0, 210); // 0 on the plain, 1 in the range proper
    if (t <= 0) continue;
    const k = 1 + 1.2 * t; // radial stretch about R0
    const nr = R0 + (r - R0) * k;
    v.x *= nr / r;
    v.z *= nr / r;
    const h = Math.max(v.y, 0);
    const lift = 1 + 1.15 * t; // up to ~2× taller
    const carve = ridges(v.x / 90, v.z / 90) - 0.35; // spurs and valleys
    const gully = ridges(v.x / 26 + 40, v.z / 26) - 0.35; // the gullies cut into each slope
    const lumps = fbm(v.x / 22, v.z / 22, 3) - 0.5;
    ridge[i] = THREE.MathUtils.lerp(0.5, THREE.MathUtils.clamp((carve + gully) * 1.3 + 0.45, 0, 1), Math.sqrt(t));
    // soft-cap the peaks so the range is rounded like the Khangai, not alpine
    const tc = Math.sqrt(t); // relief reaches further down the foot than the stretch does
    const y = h * lift + tc * (carve * (6 + h * 0.55) + gully * (2 + h * 0.3) + lumps * 4);
    v.y = 95 * Math.tanh(Math.max(y, 0) / 95) + Math.min(y, 0) + Math.min(v.y, 0);
    pos.setXYZ(i, ...v.applyMatrix4(inv).toArray());
  }
  geo.setAttribute("aRidge", new THREE.BufferAttribute(ridge, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
}

function hash(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t);
  const fx = s(x - xi),
    fy = s(y - yi),
    fz = s(z - zi);
  const L = THREE.MathUtils.lerp;
  const c = (a, b, c) => hash(xi + a, yi + b, zi + c);
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), fx), L(c(0, 1, 0), c(1, 1, 0), fx), fy),
    L(L(c(0, 0, 1), c(1, 0, 1), fx), L(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}
