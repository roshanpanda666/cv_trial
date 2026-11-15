import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { J, type GarmentAsset, type Pt } from './garment';

/**
 * Turns the flat garment into a mesh "skinned" to a 2D skeleton, the same idea
 * as character animation: every mesh vertex is attached to nearby bones (torso,
 * upper arms, forearms, thighs, shins) with smooth weights. Each frame, every bone
 * gets a transform from the garment's pose to your pose, and vertices blend them —
 * so sleeves follow your arms and the cloth bends smoothly at the joints.
 */

type Affine = [number, number, number, number, number, number]; // a b c d e f (canvas order)

interface BoneDef {
  name: string;
  /** Joint pair for limbs; torso/pelvis are special. */
  joints?: [number, number];
  limb: boolean;
}

export interface FitSettings {
  scale: number;
  offsetY: number;
}

export interface GarmentMesh {
  asset: GarmentAsset;
  bones: BoneDef[];
  src: Float32Array; // vertex positions in garment pixels (x,y)
  uv: Float32Array; // texture coords
  limb: Float32Array; // 0 = torso cloth, 1 = sleeve/leg cloth
  weights: Float32Array; // nVerts * nBones
  indices: Uint16Array;
  out: Float32Array; // skinned positions, reused every frame
  srcFrames: (Pt[] | null)[]; // per bone: triangle in garment space
}

const GRID = 44; // cells along the longest side
const LIMB_OVERSIZE = 1.5;

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const perp = (v: Pt): Pt => [-v[1], v[0]]; // rotates +90°: for a left→right vector it points down

function bonesFor(asset: GarmentAsset): BoneDef[] {
  if (asset.category === 'bottom') {
    return [
      { name: 'pelvis', limb: false },
      { name: 'rThigh', joints: [J.rHip, J.rKnee], limb: true },
      { name: 'rShin', joints: [J.rKnee, J.rAnkle], limb: true },
      { name: 'lThigh', joints: [J.lHip, J.lKnee], limb: true },
      { name: 'lShin', joints: [J.lKnee, J.lAnkle], limb: true },
    ];
  }
  return [
    { name: 'torso', limb: false },
    { name: 'rUpperArm', joints: [J.rShoulder, J.rElbow], limb: true },
    { name: 'rForearm', joints: [J.rElbow, J.rWrist], limb: true },
    { name: 'lUpperArm', joints: [J.lShoulder, J.lElbow], limb: true },
    { name: 'lForearm', joints: [J.lElbow, J.lWrist], limb: true },
  ];
}

type Joints = (i: number) => Pt | null;

/**
 * A reference triangle for each bone in some pose. Mapping the garment's triangle
 * onto the user's triangle gives that bone's transform.
 *  - torso: both shoulders + mid-hip (captures width, length, lean, shear)
 *  - pelvis: both hips + a point below them
 *  - limbs: the two joints + a sideways point scaled by body width, so sleeves
 *    keep their width when an arm is foreshortened
 */
function boneFrame(bone: BoneDef, j: Joints, widthRef: number, cat: GarmentAsset['category']): Pt[] | null {
  const core = coreJoints(j, cat);
  if (!core) return null;
  if (bone.name === 'torso') return [core.rS!, core.lS!, mid(core.rH, core.lH)];
  if (bone.name === 'pelvis') {
    const m = mid(core.rH, core.lH);
    return [core.rH, core.lH, add(m, perp(sub(core.lH, core.rH)))];
  }
  const a = j(bone.joints![0]);
  const b = j(bone.joints![1]);
  if (!a || !b) return null;
  const d = sub(b, a);
  const L = len(d);
  if (L < 1e-3) return null;
  return [a, b, add(a, mul(perp(d), widthRef / L))];
}

/** Shoulders/hips with fallbacks (hips are often cropped out of photos and webcams). */
function coreJoints(j: Joints, cat: GarmentAsset['category']) {
  const rS = j(J.rShoulder), lS = j(J.lShoulder);
  let rH = j(J.rHip), lH = j(J.lHip);
  if (cat === 'bottom') {
    if (!rH || !lH) return null;
    return { rS, lS, rH, lH };
  }
  if (!rS || !lS) return null;
  if (!rH || !lH) {
    const w = len(sub(lS, rS));
    const down = mul(perp(sub(lS, rS)), 1.45);
    rH = add(add(rS, down), [w * 0.08, 0]);
    lH = add(add(lS, down), [-w * 0.08, 0]);
  }
  return { rS, lS, rH, lH };
}

function bodyWidth(j: Joints, cat: GarmentAsset['category']): number | null {
  const c = coreJoints(j, cat);
  if (!c) return null;
  return cat === 'bottom' ? len(sub(c.lH, c.rH)) : len(sub(c.lS!, c.rS!));
}

export function buildMesh(asset: GarmentAsset): GarmentMesh | null {
  const { canvas, keypoints, category } = asset;
  const j: Joints = (i) => keypoints.get(i) ?? null;
  const widthRef = bodyWidth(j, category);
  if (!widthRef) return null;
  const bones = bonesFor(asset);
  const srcFrames = bones.map((b) => boneFrame(b, j, widthRef, category));
  if (!srcFrames[0]) return null;

  const W = canvas.width;
  const H = canvas.height;
  const step = Math.max(W, H) / GRID;
  const nx = Math.ceil(W / step);
  const ny = Math.ceil(H / step);
  const nV = (nx + 1) * (ny + 1);
  const src = new Float32Array(nV * 2);
  const uv = new Float32Array(nV * 2);
  for (let y = 0; y <= ny; y++) {
    for (let x = 0; x <= nx; x++) {
      const v = y * (nx + 1) + x;
      const px = Math.min(W, x * step);
      const py = Math.min(H, y * step);
      src[v * 2] = px;
      src[v * 2 + 1] = py;
      uv[v * 2] = px / W;
      uv[v * 2 + 1] = py / H;
    }
  }

  // Only keep cells that contain some garment.
  const alpha = canvas.getContext('2d')!.getImageData(0, 0, W, H).data;
  const opaque = (x0: number, y0: number) => {
    const s = Math.max(1, Math.floor(step / 4));
    for (let y = Math.floor(y0); y < Math.min(H, y0 + step + 1); y += s)
      for (let x = Math.floor(x0); x < Math.min(W, x0 + step + 1); x += s)
        if (alpha[(y * W + x) * 4 + 3] > 8) return true;
    return false;
  };
  const idx: number[] = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      if (!opaque(x * step, y * step)) continue;
      const a = y * (nx + 1) + x;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }

  // Skinning weights: soft-min over distance to each bone's region.
  const torsoPoly = torsoRegion(j, category, H);
  const sigma = widthRef * 0.12;
  const nB = bones.length;
  const weights = new Float32Array(nV * nB);
  const limb = new Float32Array(nV);
  const dist = new Float32Array(nB);
  for (let v = 0; v < nV; v++) {
    const p: Pt = [src[v * 2], src[v * 2 + 1]];
    let dMin = Infinity;
    for (let b = 0; b < nB; b++) {
      const bone = bones[b];
      let d = Infinity;
      if (!bone.limb) d = torsoPoly ? polygonDistance(p, torsoPoly) : 0;
      else if (srcFrames[b]) d = segmentDistance(p, srcFrames[b]![0], srcFrames[b]![1]);
      dist[b] = d;
      dMin = Math.min(dMin, d);
    }
    let sum = 0;
    for (let b = 0; b < nB; b++) {
      const w = Number.isFinite(dist[b]) ? Math.exp(-(dist[b] ** 2 - dMin ** 2) / (sigma * sigma)) : 0;
      weights[v * nB + b] = w;
      sum += w;
    }
    for (let b = 0; b < nB; b++) weights[v * nB + b] /= sum;
    limb[v] = 1 - weights[v * nB]; // bone 0 is torso/pelvis
  }

  return {
    asset, bones, src, uv, limb, weights, srcFrames,
    indices: new Uint16Array(idx),
    out: new Float32Array(nV * 2),
  };
}

/** Torso cloth region: shoulders down to the garment's hem (or the hips area for trousers). */
function torsoRegion(j: Joints, cat: GarmentAsset['category'], H: number): Pt[] | null {
  const c = coreJoints(j, cat);
  if (!c) return null;
  if (cat === 'bottom') {
    const down = mul(perp(sub(c.lH, c.rH)), 0.35);
    return [add(c.rH, mul(down, -1)), add(c.lH, mul(down, -1)), add(c.lH, down), add(c.rH, down)];
  }
  // Extend the hip line down to the bottom of the image so long kurtas/dresses stay on the torso.
  const torsoDown = sub(mid(c.rH, c.lH), mid(c.rS!, c.lS!));
  const k = Math.max(1, (H - mid(c.rH, c.lH)[1]) / Math.max(1, torsoDown[1]));
  return [c.rS!, c.lS!, add(c.lH, mul(torsoDown, k)), add(c.rH, mul(torsoDown, k))];
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
  return len(sub(p, add(a, mul(ab, t))));
}

function polygonDistance(p: Pt, poly: Pt[]): number {
  let inside = false;
  let d = Infinity;
  for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
    const a = poly[i], b = poly[k];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    d = Math.min(d, segmentDistance(p, a, b));
  }
  return inside ? 0 : d;
}

/** Affine transform taking triangle s onto triangle t. */
function triAffine(s: Pt[], t: Pt[]): Affine | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const det = x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1);
  if (Math.abs(det) < 1e-6) return null;
  const solve = (t0: number, t1: number, t2: number) => [
    (t0 * (y1 - y2) - y0 * (t1 - t2) + (t1 * y2 - t2 * y1)) / det,
    (x0 * (t1 - t2) - t0 * (x1 - x2) + (x1 * t2 - x2 * t1)) / det,
    (x0 * (y1 * t2 - y2 * t1) - y0 * (x1 * t2 - x2 * t1) + t0 * (x1 * y2 - x2 * y1)) / det,
  ];
  const [a, c, e] = solve(t[0][0], t[1][0], t[2][0]);
  const [b, d, f] = solve(t[0][1], t[1][1], t[2][1]);
  return [a, b, c, d, e, f];
}

/**
 * Poses the mesh onto the user. All fitting happens in the un-mirrored camera image,
 * which has the same handedness as the product photo (wearer's right on the image's
 * left), so every bone transform is a plain rotate/scale, never a flip. Only the final
 * vertices are mirrored to line up with the mirrored video, exactly like a real mirror.
 * Returns false when the body isn't visible enough.
 */
export function skinMesh(mesh: GarmentMesh, lm: NormalizedLandmark[], W: number, H: number, fit: FitSettings): boolean {
  const cat = mesh.asset.category;
  const j: Joints = (i) => ((lm[i]?.visibility ?? 0) > 0.5 ? [lm[i].x * W, lm[i].y * H] : null);

  // Source limb frames were built with the garment's body width; using the user's body
  // width here makes sleeves/legs scale across the bone like the torso does.
  const dstWidth = bodyWidth(j, cat);
  if (!dstWidth) return false;

  const xf: (Affine | null)[] = mesh.bones.map((bone, b) => {
    const s = mesh.srcFrames[b];
    if (!s) return null;
    // Sleeves/legs are made ~50% wider than the body proportion: they then fully cover
    // the user's own (often baggier) clothes, and the silhouette mask trims the excess.
    const t = boneFrame(bone, j, bone.limb ? dstWidth * LIMB_OVERSIZE : dstWidth, cat);
    return t ? triAffine(s, t) : null;
  });
  const torso = xf[0];
  if (!torso) return false;

  // Fit adjustments: scale around the top centre, shift by a fraction of torso length.
  const core = coreJoints(j, cat)!;
  const anchor = cat === 'bottom' ? mid(core.rH, core.lH) : mid(core.rS!, core.lS!);
  const torsoLen = cat === 'bottom' ? dstWidth * 1.5 : len(sub(mid(core.rH, core.lH), anchor));
  const shiftY = fit.offsetY * torsoLen;

  const { src, weights, out } = mesh;
  const nB = mesh.bones.length;
  const nV = src.length / 2;
  for (let v = 0; v < nV; v++) {
    const x = src[v * 2], y = src[v * 2 + 1];
    let ox = 0, oy = 0;
    for (let b = 0; b < nB; b++) {
      const w = weights[v * nB + b];
      if (w < 1e-4) continue;
      const m = xf[b] ?? torso; // limb not visible → move with the torso
      ox += w * (m[0] * x + m[2] * y + m[4]);
      oy += w * (m[1] * x + m[3] * y + m[5]);
    }
    out[v * 2] = W - (anchor[0] + (ox - anchor[0]) * fit.scale); // mirror for display
    out[v * 2 + 1] = anchor[1] + (oy - anchor[1]) * fit.scale + shiftY;
  }
  return true;
}
