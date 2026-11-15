import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Category } from './types';
import { SEG, getVision } from './vision';

export type Pt = [number, number];

/** A garment cut out of a product photo, plus where its body joints are. */
export interface GarmentAsset {
  canvas: HTMLCanvasElement; // transparent everywhere except the garment
  /** Body joints (MediaPipe pose indices) in canvas pixels. */
  keypoints: Map<number, Pt>;
  category: Category;
  /** true = cut from a photo of a model, false = flat product shot. */
  fromModel: boolean;
}

const MAX_SIZE = 768;
const BG_TOLERANCE = 30;
const KP_VISIBILITY = 0.3;

// MediaPipe pose landmark indices
export const J = {
  lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
} as const;

export async function prepareGarment(url: string, category: Category): Promise<GarmentAsset> {
  const src = await loadImage(url);
  const { width: w, height: h } = src;
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);

  const vision = await getVision();
  const pose = vision.imagePose.detect(src).landmarks[0];
  // Masks are only valid inside the callback, so copy them out.
  const seg: { conf?: Float32Array; w: number; h: number } = { w: 0, h: 0 };
  vision.imageSegmenter.segment(src, (res) => {
    const m = res.confidenceMasks?.[SEG.clothes];
    if (m) Object.assign(seg, { conf: m.getAsFloat32Array().slice(), w: m.width, h: m.height });
  });

  const clothesAlpha = seg.conf ? resampleMask(seg.conf, seg.w, seg.h, w, h) : null;
  const coverage = clothesAlpha ? clothesAlpha.reduce((n, a) => n + (a > 0.5 ? 1 : 0), 0) / (w * h) : 0;
  const fromModel = !!pose && !!clothesAlpha && coverage > 0.03;

  let keypoints: Map<number, Pt>;
  if (fromModel) {
    keypoints = poseKeypoints(pose!, w, h);
    // Solid fabric: a pixel is either garment or not. (Using the model's confidence as
    // opacity made patterned/shadowed areas semi-transparent.)
    const alpha = clothesAlpha!.map((c) => (c > 0.45 ? 1 : 0));
    splitGarment(img, alpha, keypoints, category);
    closeGaps(alpha, w, h, 2);
    fillHoles(img, alpha);
    featherEdges(alpha, w, h);
    for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = Math.round(img.data[i * 4 + 3] * alpha[i]);
  } else {
    removeBackground(img);
    keypoints = new Map();
  }
  ctx.putImageData(img, 0, 0);

  const crop = cropToContent(src, img);
  const canvas = crop?.canvas ?? src;
  if (crop) for (const [k, [x, y]] of keypoints) keypoints.set(k, [x - crop.x, y - crop.y]);
  if (!fromModel) keypoints = flatLayKeypoints(category, canvas.width, canvas.height);

  return { canvas, keypoints, category, fromModel };
}

async function loadImage(url: string): Promise<HTMLCanvasElement> {
  // Extension pages with host permissions can fetch cross-origin images without CORS,
  // and a blob-backed bitmap doesn't taint the canvas.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function poseKeypoints(lm: NormalizedLandmark[], w: number, h: number): Map<number, Pt> {
  const kp = new Map<number, Pt>();
  for (const i of Object.values(J)) {
    if ((lm[i]?.visibility ?? 0) >= KP_VISIBILITY) kp.set(i, [lm[i].x * w, lm[i].y * h]);
  }
  return kp;
}

/** Guessed joint positions for a flat product shot (no person in the photo). */
function flatLayKeypoints(cat: Category, w: number, h: number): Map<number, Pt> {
  const kp = new Map<number, Pt>();
  const set = (i: number, x: number, y: number) => kp.set(i, [x * w, y * h]);
  if (cat === 'bottom') {
    set(J.rHip, 0.3, 0.04); set(J.lHip, 0.7, 0.04);
    set(J.rKnee, 0.28, 0.52); set(J.lKnee, 0.72, 0.52);
    set(J.rAnkle, 0.27, 0.97); set(J.lAnkle, 0.73, 0.97);
  } else if (cat === 'dress') {
    set(J.rShoulder, 0.3, 0.06); set(J.lShoulder, 0.7, 0.06);
    set(J.rHip, 0.33, 0.42); set(J.lHip, 0.67, 0.42);
  } else {
    set(J.rShoulder, 0.25, 0.1); set(J.lShoulder, 0.75, 0.1);
    set(J.rHip, 0.3, 0.92); set(J.lHip, 0.7, 0.92);
  }
  return kp;
}

/**
 * The segmenter's "clothes" class covers the whole outfit. Separate the shirt from
 * the trousers by colour: learn the top's colours from the chest and the bottom's
 * from the thighs, then reassign the ambiguous area around the waist.
 */
function splitGarment(img: ImageData, alpha: Float32Array, kp: Map<number, Pt>, cat: Category) {
  if (cat === 'dress') return;
  const rS = kp.get(J.rShoulder), lS = kp.get(J.lShoulder), rH = kp.get(J.rHip), lH = kp.get(J.lHip);
  if (!rH || !lH) return;
  const { width: w, height: h, data } = img;
  const hipY = (rH[1] + lH[1]) / 2;
  const shoulderY = rS && lS ? (rS[1] + lS[1]) / 2 : hipY - (lH[0] - rH[0]) * 2.2;
  const torso = Math.max(10, hipY - shoulderY);
  const knees = [kp.get(J.rKnee), kp.get(J.lKnee)].filter(Boolean) as Pt[];
  const kneeY = knees.length ? knees.reduce((s, k) => s + k[1], 0) / knees.length : hipY + torso;
  const xL = Math.min(rH[0], lH[0]) - torso * 0.2;
  const xR = Math.max(rH[0], lH[0]) + torso * 0.2;

  const BINS = 512;
  const bin = (i: number) => ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
  const topH = new Float32Array(BINS).fill(1);
  const botH = new Float32Array(BINS).fill(1);
  let nTop = 0, nBot = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (alpha[p] < 0.5) continue;
      if (y > shoulderY + torso * 0.25 && y < hipY - torso * 0.15) (topH[bin(p * 4)]++, nTop++);
      else if (y > hipY + (kneeY - hipY) * 0.35 && y < kneeY && x > xL && x < xR) (botH[bin(p * 4)]++, nBot++);
    }
  }
  if (nTop < 200) return;

  // Colour only separates the pieces when they actually differ (teal kurta + black
  // trousers yes, white kurta + white pyjama no). Bhattacharyya overlap of the two palettes:
  let overlap = 0;
  for (let b = 0; b < BINS; b++) overlap += Math.sqrt((topH[b] / (nTop + BINS)) * (botH[b] / (nBot + BINS)));
  const byColour = nBot >= 200 && overlap < 0.55;
  // Otherwise split by position: a top ends around the knees at the longest (kurtas).
  const cutY = knees.length ? kneeY + torso * 0.1 : Infinity;

  const zoneTop = hipY - torso * 0.35; // above this: certainly the top
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (alpha[p] === 0) continue;
      let isTop: boolean;
      if (y < zoneTop) isTop = true;
      else if (byColour) {
        const b = bin(p * 4);
        isTop = topH[b] / (nTop + BINS) >= botH[b] / (nBot + BINS);
      } else isTop = y < cutY;
      if (isTop !== (cat === 'top')) alpha[p] = 0;
    }
  }
}

/**
 * Fills holes inside the garment (e.g. where the model's hand was in front of it)
 * by growing the surrounding fabric colour inwards. Gaps open to the outside are left alone.
 */
function fillHoles(img: ImageData, alpha: Float32Array) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  // Mark everything transparent that is reachable from the border: that's "outside".
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const seed = (p: number) => {
    if (!outside[p] && alpha[p] < 0.5) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) (seed(x), seed((h - 1) * w + x));
  for (let y = 0; y < h; y++) (seed(y * w), seed(y * w + w - 1));
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }
  let holes: number[] = [];
  let garment = 0;
  for (let p = 0; p < n; p++) {
    if (alpha[p] >= 0.5) garment++;
    else if (!outside[p]) holes.push(p);
  }
  if (!holes.length || holes.length > garment * 0.08) return;

  const filled = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (alpha[p] >= 0.5) filled[p] = 1;
  // Grow inwards one ring per pass, averaging already-filled neighbours.
  for (let pass = 0; pass < 200 && holes.length; pass++) {
    const next: number[] = [];
    const done: number[] = [];
    for (const p of holes) {
      let r = 0, g = 0, b = 0, k = 0;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= n || !filled[q]) continue;
        r += data[q * 4];
        g += data[q * 4 + 1];
        b += data[q * 4 + 2];
        k++;
      }
      if (!k) {
        next.push(p);
        continue;
      }
      data[p * 4] = r / k;
      data[p * 4 + 1] = g / k;
      data[p * 4 + 2] = b / k;
      data[p * 4 + 3] = 255;
      done.push(p);
    }
    for (const p of done) {
      filled[p] = 1;
      alpha[p] = 1;
    }
    if (!done.length) break;
    holes = next;
  }
}

function resampleMask(m: Float32Array, mw: number, mh: number, w: number, h: number): Float32Array {
  if (mw === w && mh === h) return m;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1, Math.floor((y * mh) / h));
    for (let x = 0; x < w; x++) out[y * w + x] = m[my * mw + Math.min(mw - 1, Math.floor((x * mw) / w))];
  }
  return out;
}

/** Morphological closing (grow then shrink by r px): seals pinholes and thin cracks. */
function closeGaps(alpha: Float32Array, w: number, h: number, r: number) {
  const pass = (grow: boolean) => {
    const src = alpha.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const a = src[yy * w + xx];
            v = grow ? Math.max(v, a) : Math.min(v, a);
          }
        }
        alpha[y * w + x] = v;
      }
    }
  };
  for (let i = 0; i < r; i++) pass(true);
  for (let i = 0; i < r; i++) pass(false);
}

/** A 1px soft edge so the outline isn't jagged; the inside stays fully opaque. */
function featherEdges(alpha: Float32Array, w: number, h: number) {
  const src = alpha.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (src[p] === 0) continue;
      const n = src[p - 1] + src[p + 1] + src[p - w] + src[p + w];
      if (n < 4) alpha[p] = 0.5 + n / 8; // edge pixel: 0.5–0.875
    }
  }
}

/** Flat product shots: flood-fill from the border, clearing pixels close to the background colour. */
function removeBackground(img: ImageData) {
  const { width: w, height: h, data } = img;
  const bg = borderColor(img);
  const near = (i: number) =>
    Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) <=
      BG_TOLERANCE || data[i + 3] < 10;

  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (!seen[p] && near(p * 4)) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) (push(x, 0), push(x, h - 1));
  for (let y = 0; y < h; y++) (push(0, y), push(w - 1, y));
  while (stack.length) {
    const p = stack.pop()!;
    data[p * 4 + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
}

/** Most common (quantised) colour along the image border. */
function borderColor(img: ImageData): [number, number, number] {
  const { width: w, height: h, data } = img;
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    c.n++;
    c.r += data[i];
    c.g += data[i + 1];
    c.b += data[i + 2];
    counts.set(key, c);
  };
  for (let x = 0; x < w; x++) (add(x, 0), add(x, h - 1));
  for (let y = 0; y < h; y++) (add(0, y), add(w - 1, y));
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

function cropToContent(src: HTMLCanvasElement, img: ImageData) {
  const { width: w, height: h, data } = img;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // If almost everything was removed, the extraction failed: keep the original.
  if (maxX < 0 || (maxX - minX) * (maxY - minY) < w * h * 0.03) return null;
  const pad = 4;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  const cw = Math.min(w, maxX + pad + 1) - x;
  const ch = Math.min(h, maxY + pad + 1) - y;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d')!.drawImage(src, x, y, cw, ch, 0, 0, cw, ch);
  return { canvas, x, y };
}
