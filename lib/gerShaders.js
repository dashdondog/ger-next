// ── vertex animations ported from the Geometry Nodes setups in ger.blend ─────
//
// Each body runs per vertex with B = the vertex in Blender coordinates (Z up) and
// uT = Blender frames since the step started. It writes `off` (a Blender-space offset)
// and `hide` (1 = not there yet). The models are exported in their rest pose, so a
// large uT always gives the finished ger.

// prepended before three's own chunks, so PI (defined by three) is not available here yet
const COMMON = /* glsl */ `
  // angle round the ger, 0 at the door, increasing anticlockwise seen from above
  float relAng(vec3 B) { return mod(atan(B.y, B.x) + 1.5707963, 6.2831853); }
`;

/** Uni: one pole at a time from the door round the ger, each sliding up its own axis into the toono. */
export const UNI = /* glsl */ `
  float rel = relAng(B);
  float n = floor(rel / (2.0 * PI / 72.0));
  float since = uT - n * 3.0;
  hide = since < 0.0 ? 1.0 : 0.0;
  float pr = smoothstep(0.0, 16.0, since);
  float ac = (n + 0.5) * (2.0 * PI / 72.0) - PI * 0.5;
  vec3 d = normalize(vec3(cos(ac) * (3.1 - 0.93), sin(ac) * (3.1 - 0.93), 1.95591 - 3.32665));
  off = d * (1.0 - pr) * 0.7;
`;
export const UNI_FRAMES = 71 * 3 + 16;

/** Tuurga: the felt is wrapped round the khana, its free end held off the wall. */
export const TUURGA = /* glsl */ `
  float rel = relAng(B);
  float p = (rel - 0.26004) / (6.02315 - 0.26004);
  float bp = 0.8 / 18.0962;
  float w = clamp(uT / 90.0, 0.0, 1.0) * (1.0 + bp);
  float q = clamp((p - (w - bp)) / bp, 0.0, 1.0);
  float q2 = q * q;
  float lift = q2 * 0.35 + sin(uT * 0.45 + B.z * 3.5) * q * 0.03;
  off = vec3(normalize(B.xy) * lift, q2 * (1.0 - B.z / 1.8691) * -0.06);
  hide = p > w ? 1.0 : 0.0;
`;
export const TUURGA_FRAMES = 92;

/** Roof felt (and canvas): falls, the eave flaps in the air, then bounces and settles. */
function fall({ hem, liftOnly }) {
  return /* glsl */ `
    float fp = clamp(uT / 22.0, 0.0, 1.0);
    float tau = max(uT - 22.0, 0.0);
    float dec = exp(-tau * 0.09);
    float e = pow(max((length(B.xy) - 1.03) / (3.292 - 1.03), 0.0), 1.5);
    ${hem ? "e *= 1.0 + 0.8 * (1.0 - min(B.z / 2.0, 1.0));" : ""}
    float ang = atan(B.y, B.x);
    float drop = 2.5 * (1.0 - fp * fp);
    float flap = fp * (1.0 - fp) * 4.0 * 0.35 * e * (1.0 + 0.35 * sin(ang * 6.0 + uT * 0.5));
    float wave = sin(tau * 0.55) + 0.4 * sin(ang * 8.0 + tau * 0.4);
    float bounce = ${liftOnly ? "abs(wave) * 0.07" : "wave * -0.07"} * dec * e * step(22.0, uT);
    off = vec3(0.0, 0.0, drop + flap + bounce);
  `;
}
export const DEEVER = fall({ hem: false, liftOnly: false });
// the canvas rests on the felt, so it only ever bounces upward
export const GADAR = fall({ hem: true, liftOnly: true });
export const FALL_FRAMES = 84;

/** Buslur: each rope runs round from the knot left of the door, low rope first. */
export const BUSLUR = /* glsl */ `
  float rel = relAng(B);
  float H0 = 0.22687, H1 = 6.05646;
  float p = 1.0 - (rel - (H0 - 0.002)) / ((H1 - H0) + 0.004);
  float bp = 0.7 / 19.2376;
  float w = clamp((uT - B.z * 12.0) / 70.0, 0.0, 1.0) * (1.0 + bp);
  float q = clamp((p - (w - bp)) / bp, 0.0, 1.0);
  float q2 = q * q;
  float anchor = min(p / bp, 1.0);   // the starting knot stays tied to the door
  float lift = (q2 * 0.3 + sin(uT * 0.6 + rel * 9.0) * q * 0.025) * anchor;
  off = vec3(normalize(B.xy) * lift, q2 * -0.05 * anchor);
  hide = p > w ? 1.0 : 0.0;
`;
export const BUSLUR_FRAMES = 95;

/**
 * Canvas pattern from the Gadar_* materials: the meander band where (v - v0) / bandH is in 0..1,
 * repeated `tiles` times round the ger, and a solid blue hem beyond v = edge (roof only).
 */
export function canvasFragment({ tiles, v0, bandH, edge = 0 }) {
  const f = (x) => x.toFixed(5);
  return /* glsl */ `
    vec2 bu = vec2(vMapUv.x, 1.0 - vMapUv.y);   // glTF flips V; back to Blender's
    float vt = (bu.y - ${f(v0)}) / ${f(bandH)};
    float inside = step(0.0, vt) * step(vt, 1.0);
    vec3 col = mix(vec3(0.88, 0.87, 0.83), texture2D(map, vec2(bu.x * ${f(tiles)}, vt)).rgb, inside);
    ${edge ? `if (bu.y > ${f(edge)}) col = vec3(0.02, 0.12, 0.42);` : ""}
    diffuseColor.rgb *= col;
  `;
}

const NOISE = /* glsl */ `
  float gHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float gNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(gHash(i), gHash(i + vec3(1, 0, 0)), f.x), mix(gHash(i + vec3(0, 1, 0)), gHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(gHash(i + vec3(0, 0, 1)), gHash(i + vec3(1, 0, 1)), f.x), mix(gHash(i + vec3(0, 1, 1)), gHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float gFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * gNoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
  // bump from a height field via screen-space derivatives (no UVs needed)
  vec3 gBump(vec3 pos, vec3 n, float h, float faceDir) {
    vec3 sx = dFdx(pos), sy = dFdy(pos);
    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
    float det = dot(sx, r1) * faceDir;
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    return normalize(abs(det) * n - grad);
  }
`;

/** Wool felt: patchy off-white, fibre bump, soiled toward the ground. */
export const FELT_DETAIL = {
  color: /* glsl */ `
    diffuseColor.rgb *= 0.86 + 0.22 * gFbm(vB * 2.5);
    diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(0.0, 0.45, vB.z));
  `,
  height: /* glsl */ `0.004 * gFbm(vB * 28.0) + 0.001 * gFbm(vB * 95.0)`,
};

/** Cotton canvas: wrinkles, weathered streaks, dust at the hem, smoke soot round the toono. */
export const CANVAS_DETAIL = {
  color: /* glsl */ `
    float rr = length(vB.xy);
    diffuseColor.rgb *= 0.86 + 0.2 * gFbm(vec3(vB.xy * 5.0, vB.z * 0.7));
    diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.02, 0.55, vB.z + 0.12 * gFbm(vB * 4.0)));
    // soot only on the roof (the wall canvas is below 2.4 m)
    diffuseColor.rgb *= mix(0.35, 1.0, min(1.0, smoothstep(1.05, 1.75, rr + 0.25 * gFbm(vB * 3.0)) + step(vB.z, 2.4)));
  `,
  height: /* glsl */ `0.014 * gFbm(vB * vec3(2.6, 2.6, 1.3)) + 0.0008 * gFbm(vB * 110.0)`,
};

/**
 * Inject a vertex animation into a standard material, optionally replacing map_fragment and
 * adding surface detail (colour GLSL working on diffuseColor, and a bump height in metres).
 * vB, the vertex's rest position in Blender coordinates, is available to both.
 */
export function patchMaterial(mat, { key, uT, body, mapFragment, detail }) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    sh.vertexShader =
      `uniform float uT;\nvarying float vHide;\nvarying vec3 vB;\n${COMMON}\n` +
      sh.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
      {
        vec3 B = vec3(position.x, -position.z, position.y);
        vB = B;
        vec3 off = vec3(0.0);
        float hide = 0.0;
        ${body}
        transformed += vec3(off.x, off.z, -off.y);
        vHide = hide;
      }`,
      );
    let fs =
      `varying float vHide;\nvarying vec3 vB;\n${detail ? NOISE : ""}\n` +
      sh.fragmentShader.replace("void main() {", "void main() {\n  if (vHide > 0.5) discard;");
    if (mapFragment) fs = fs.replace("#include <map_fragment>", mapFragment);
    if (detail) {
      fs = fs
        .replace("#include <color_fragment>", `#include <color_fragment>\n${detail.color}`)
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>\nnormal = gBump(-vViewPosition, normal, ${detail.height}, faceDirection);`,
        );
    }
    sh.fragmentShader = fs;
  };
  // three caches programs by onBeforeCompile's source, which is the same function for every patch
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}
