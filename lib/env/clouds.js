// ── clouds: the volumetric cumulus from anhniih.blend (collection "Uul_Clouds") ──────────
//
// Each Blender cloud is a cube with a Principled Volume whose density is a noise-eroded
// ellipsoid with a flat base. glTF cannot carry volumes, so the cubes are rebuilt here from
// their Blender transforms and the same density is ray-marched in the fragment shader.
// Lit by whichever of sun / moon the sky is using, so they follow the day / night cycle.
//
// The Blender clouds sit 0.8–2.3 km out, past the camera's far plane, so they are pulled toward
// the origin by PULL and shrunk by the same factor. stone.js pushes the mountain range out and
// lifts it ~2×, so the cloud heights get LIFT to stay above the crests as they do in Blender.

import * as THREE from "three";

const PULL = 0.53; // nearest cloud just past the mountain range, farthest inside the far plane
const LIFT = 2.0;
const SIGMA = 0.12 / PULL; // Blender's volume density per metre, scaled with the clouds
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const STEPS = isMobile ? 24 : 40; // samples along each view ray through a cloud
const CHURN = 0.012; // how fast the cloud shapes boil
const WIND = 7; // drift along +x, metres per second
const SPAN = 700; // clouds wrap from +SPAN back to -SPAN (inside the far plane)…
const FADE = 180; // …fading out over this many metres before the edge and in after it
const SHADE = 0.8; // how much a cloud dims the sunlight on the ground (0 … 1)

// Blender (Z-up): location, scale, rotation about Z — copied from anhniih.blend
const CLOUDS = [
  [-700, 1500, 230, 254.1, 122.3, 77.8, 0.236],
  [-250, 1250, 180, 290.4, 139.8, 89.0, 0.338],
  [250, 1700, 260, 163.3, 89.6, 57.0, 0.355],
  [650, 1350, 200, 275.4, 123.7, 78.7, -0.309],
  [1000, 1900, 300, 184.3, 113.8, 72.4, 0.035],
  [-1100, 2000, 320, 167.8, 119.6, 76.1, -0.227],
  [0, 2300, 380, 231.6, 103.4, 65.8, 0.213],
  [450, 900, 150, 206.1, 96.8, 61.6, -0.289],
  [-500, 800, 140, 184.0, 122.0, 77.6, -0.399],
];

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorldDir;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uCamLocal, uLightLocal, uLightWorld, uScale;
  uniform vec3 uSunCol, uMoonCol, uZenith, uHorizon;
  uniform float uNight, uSeed, uTime, uDist, uFade;
  varying vec3 vLocal;
  varying vec3 vWorldDir;

  float h3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x),
                   mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x),
                   mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p, int octaves) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < octaves; i++) {
      v += a * vnoise(p);
      p = p * 2.02 + vec3(1.7, 9.2, 4.1);
      a *= 0.5;
    }
    return v;
  }
  // the Blender material: noise + (1 - |p|), remapped 0.62…0.85, with the base cut flat
  // (local +y here is Blender's +z)
  float density(vec3 p, int octaves) {
    float shape = 1.0 - length(p);
    if (shape < -0.3) return 0.0;
    float n = fbm(p * 2.2 + uSeed + vec3(uTime * ${CHURN}), octaves);
    float d = clamp((n * 0.9 + shape - 0.62) / 0.23, 0.0, 1.0);
    return d * clamp((p.y + 0.5) / 0.2, 0.0, 1.0);
  }

  void main() {
    vec3 ro = uCamLocal;
    vec3 rd = normalize(vLocal - ro);
    // where the ray crosses the unit cube
    vec3 inv = 1.0 / rd;
    vec3 ta = (-1.0 - ro) * inv, tb = (1.0 - ro) * inv;
    vec3 tmin = min(ta, tb), tmax = max(ta, tb);
    float t0 = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
    float t1 = min(min(tmax.x, tmax.y), tmax.z);
    if (t1 <= t0) discard;

    float dt = (t1 - t0) / float(${STEPS});
    float metres = length(uScale * rd); // world metres per local unit along the ray
    float lightMetres = length(uScale * uLightLocal);
    float t = t0 + dt * h3(vec3(gl_FragCoord.xy, uSeed)); // jitter hides the step banding

    float mu = dot(normalize(vWorldDir), uLightWorld);
    float g = 0.35;
    float phase = 0.5 + 0.5 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
    vec3 light = mix(uSunCol, uMoonCol * 0.25, uNight);
    vec3 ambient = mix(mix(uHorizon, uZenith, 0.6) * 0.55, vec3(0.05, 0.06, 0.09), uNight);

    vec3 col = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < ${STEPS}; i++) {
      vec3 p = ro + rd * t;
      float d = density(p, 5);
      if (d > 0.01) {
        // how much light reaches this point: a few steps toward the sun / moon
        float od = 0.0;
        for (int j = 1; j <= 4; j++) od += density(p + uLightLocal * (0.14 * float(j)), 3);
        float sunT = exp(-od * ${SIGMA.toFixed(4)} * 0.14 * lightMetres);
        float up = clamp(p.y * 0.5 + 0.6, 0.0, 1.0); // tops see more sky than the base
        vec3 c = light * sunT * phase + ambient * (0.6 + 0.6 * up);
        float a = 1.0 - exp(-d * ${SIGMA.toFixed(4)} * dt * metres);
        col += T * a * c;
        T *= 1.0 - a;
        if (T < 0.02) break;
      }
      t += dt;
    }
    col *= uFade;
    float alpha = (1.0 - T) * uFade;
    if (alpha < 0.003) discard;
    // far clouds fade into the horizon haze, like the dome's own clouds
    float haze = smoothstep(400.0, 1300.0, uDist) * 0.45;
    col = mix(col, uHorizon * alpha, haze);
    gl_FragColor = vec4(col, alpha); // premultiplied
    #include <colorspace_fragment>
  }`;

// ground shadows: the sun ray from each lit point is tested against every cloud's ellipsoid
const shadowGlsl = /* glsl */ `
  uniform mat4 uCloudInv[${CLOUDS.length}];
  uniform float uCloudFade[${CLOUDS.length}];
  uniform vec3 uSunDir;
  uniform float uCloudShade;
  uniform mat4 uCamWorld;
  float cloudShHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float cloudShNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cloudShHash(i), cloudShHash(i + vec2(1.0, 0.0)), f.x),
               mix(cloudShHash(i + vec2(0.0, 1.0)), cloudShHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float cloudShadow(vec3 viewPos) {
    if (uCloudShade <= 0.0) return 1.0;
    vec3 wp = (uCamWorld * vec4(viewPos, 1.0)).xyz;
    float lit = 1.0;
    for (int i = 0; i < ${CLOUDS.length}; i++) {
      vec3 o = (uCloudInv[i] * vec4(wp, 1.0)).xyz;   // the point, in the cloud's unit cube
      vec3 l = (uCloudInv[i] * vec4(uSunDir, 0.0)).xyz;
      float t = max(-dot(o, l) / dot(l, l), 0.0);   // where the sun ray passes closest to the centre
      vec3 q = o + l * t;
      if (dot(q, q) > 1.1025) continue; // misses this cloud (even its ragged edge): skip the noise
      // ragged edges, like the cloud's own noise-eroded outline
      float n = cloudShNoise(q.xz * 3.0 + float(i) * 7.3) * 0.6 + cloudShNoise(q.xz * 7.0 - float(i)) * 0.4;
      float cover = smoothstep(0.85, 0.3, length(q) + (n - 0.5) * 0.4);
      lit *= 1.0 - cover * uCloudShade * uCloudFade[i];
    }
    return lit;
  }
`;

/** Add the Blender clouds to `scene`, lit from `sky` (createSky()); returns { update, addShadows, dispose }. */
export function createClouds({ scene, camera, sky, layer = 0, reduced = false }) {
  const s = sky.skyUniforms;
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(2, 2, 2); // Blender's default cube
  const lightWorld = { value: new THREE.Vector3() };
  const time = { value: 0 };
  const invQ = new THREE.Quaternion();
  const shadowUniforms = {
    uCloudInv: { value: CLOUDS.map(() => new THREE.Matrix4()) },
    uCloudFade: { value: CLOUDS.map(() => 1) },
    uSunDir: s.uSunDir,
    uCloudShade: { value: 0 },
    uCamWorld: { value: camera.matrixWorld },
  };
  let last = null;
  let shadowsOn = true;

  CLOUDS.forEach(([x, y, z, sx, sy, sz, rz], i) => {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uCamLocal: { value: new THREE.Vector3() },
        uLightLocal: { value: new THREE.Vector3() },
        uLightWorld: lightWorld,
        uScale: { value: new THREE.Vector3() },
        uSeed: { value: 3.7 * i + 1.3 },
        uDist: { value: 0 },
        uFade: { value: 1 },
        uTime: time,
        uSunCol: s.uSunCol,
        uMoonCol: s.uMoonCol,
        uZenith: s.uZenith,
        uHorizon: s.uHorizon,
        uNight: s.uNight,
      },
      side: THREE.BackSide, // still drawn if the camera ends up inside a cloud
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    });
    const cloud = new THREE.Mesh(geometry, material);
    // Blender Z-up → three Y-up: (x, y, z) → (x, z, -y)
    cloud.position.set(x, z * LIFT, -y).multiplyScalar(PULL);
    cloud.scale.set(sx, sz, sy).multiplyScalar(PULL);
    cloud.rotation.y = rz;
    cloud.layers.set(layer);
    cloud.onBeforeRender = () => {
      const u = material.uniforms;
      cloud.worldToLocal(u.uCamLocal.value.copy(camera.position));
      invQ.copy(cloud.quaternion).invert();
      u.uLightLocal.value
        .copy(lightWorld.value)
        .applyQuaternion(invQ)
        .divide(cloud.scale)
        .normalize();
      u.uScale.value.copy(cloud.scale);
      u.uDist.value = camera.position.distanceTo(cloud.position);
    };
    group.add(cloud);
  });
  scene.add(group);

  return {
    /** Drift the clouds on the wind, point their light at the sun or moon; called once per frame. */
    update(now) {
      const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      lightWorld.value.copy(s.uNight.value > 0.5 ? s.uMoonDir.value : s.uSunDir.value);
      if (!reduced) time.value = now / 1000;
      // no shadows by moonlight, or on the low quality level
      shadowUniforms.uCloudShade.value = shadowsOn ? (1 - s.uNight.value) * SHADE : 0;
      group.children.forEach((cloud, i) => {
        if (!reduced) {
          cloud.position.x += WIND * dt;
          if (cloud.position.x > SPAN) cloud.position.x -= 2 * SPAN;
        }
        const fade = THREE.MathUtils.smoothstep(SPAN - Math.abs(cloud.position.x), 0, FADE);
        cloud.material.uniforms.uFade.value = fade;
        cloud.visible = fade > 0;
        shadowUniforms.uCloudFade.value[i] = fade;
        cloud.updateMatrixWorld();
        shadowUniforms.uCloudInv.value[i].copy(cloud.matrixWorld).invert();
      });
    },
    /** Turn the ground shadows off (true / false) — the shader then skips them entirely. */
    setShadows(on) {
      shadowsOn = on;
    },
    /** Patch a lit material so the sun is dimmed where one of these clouds passes in front of it. */
    addShadows(m) {
      if (!m.isMeshStandardMaterial || m.userData.cloudShadows) return;
      m.userData.cloudShadows = true;
      const key = m.customProgramCacheKey(); // taken before wrapping (the default key is the hook's source)
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        Object.assign(sh.uniforms, shadowUniforms);
        sh.fragmentShader = sh.fragmentShader
          .replace("void main() {", `${shadowGlsl}\nvoid main() {`)
          // the include is still unexpanded here, so expand it to reach the sun inside it
          .replace(
            "#include <lights_fragment_begin>",
            THREE.ShaderChunk.lights_fragment_begin.replace(
              "getDirectionalLightInfo( directionalLight, directLight );",
              "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= cloudShadow( geometryPosition );",
            ),
          );
      };
      m.customProgramCacheKey = () => key + "|clouds";
      m.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      group.children.forEach((c) => c.material.dispose());
      scene.remove(group);
    },
  };
}
