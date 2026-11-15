import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { OneEuroFilter } from './oneEuro';
import { Renderer } from './renderer';
import { buildMesh, skinMesh, type FitSettings, type GarmentMesh } from './rig';
import type { GarmentAsset } from './garment';
import type { Vision } from './vision';

export interface RenderOptions extends FitSettings {
  opacity: number;
  shading: number; // 0..1, how much of the user's clothing folds/lighting to transfer
  silhouette: boolean; // trim to the body + hands in front
  skeleton: boolean;
}

export interface EngineStats {
  fps: number;
  tracking: boolean;
}

/** Problems the engine can't fix by itself; the UI restarts the camera or models. */
export type EngineIssue = 'camera-black' | 'camera-stalled' | 'vision-error';

const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

/** Per frame: webcam → pose + segmentation → skin the garment mesh to the body → render. */
export class TryOnEngine {
  options: RenderOptions = { scale: 1, offsetY: 0, opacity: 1, shading: 0.5, silhouette: true, skeleton: false };
  onStats?: (s: EngineStats) => void;
  onIssue?: (issue: EngineIssue) => void;

  private renderer: Renderer;
  private glLost = false;
  private visionErrors = 0;
  private blackChecks = 0;
  private lastFrameAt = performance.now();
  private lastHealthCheck = performance.now();
  private lastTickAt = performance.now();
  private probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  private overlay: CanvasRenderingContext2D;
  private mesh: GarmentMesh | null = null;
  private filters = new Map<number, [OneEuroFilter, OneEuroFilter]>();
  private raf = 0;
  private lastVideoTime = -1;
  private frames = 0;
  private tracked = 0;
  private fpsStart = performance.now();

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private overlayCanvas: HTMLCanvasElement,
    private vision: Vision,
  ) {
    this.renderer = new Renderer(canvas);
    this.overlay = overlayCanvas.getContext('2d')!;
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  // Chrome can drop a page's GPU context under memory/driver pressure; the canvas
  // goes black. Ask for it back and rebuild the renderer when it returns.
  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.glLost = true;
    console.warn('[cv-trial] WebGL context lost — waiting for it to be restored');
  };

  private onContextRestored = () => {
    console.warn('[cv-trial] WebGL context restored — rebuilding renderer');
    this.renderer = new Renderer(this.canvas);
    this.renderer.setMesh(this.mesh);
    this.glLost = false;
  };

  setGarment(asset: GarmentAsset | null) {
    this.mesh = asset ? buildMesh(asset) : null;
    if (asset && !this.mesh) console.warn('[cv-trial] could not rig garment (no shoulders/hips found)');
    this.renderer.setMesh(this.mesh);
  }

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
  }

  setVision(v: Vision) {
    this.vision = v;
    this.filters.clear();
    this.resetHealth();
  }

  /** Called after the UI swaps in a fresh camera stream. */
  resetHealth() {
    this.blackChecks = 0;
    this.visionErrors = 0;
    this.lastFrameAt = performance.now();
  }

  private tick() {
    const v = this.video;
    const now = performance.now();
    this.checkHealth(now);
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    this.lastFrameAt = now;
    if (this.glLost) return;
    const W = v.videoWidth;
    const H = v.videoHeight;
    const o = this.options;

    let lm: NormalizedLandmark[] | null = null;
    try {
      const raw = this.vision.pose.detectForVideo(v, now).landmarks[0];
      lm = raw ? this.smooth(raw, now / 1000) : null;
      if (!raw) this.filters.clear();

      if (o.silhouette && this.mesh && lm) {
        this.vision.segmenter.segmentForVideo(v, now, (res) => {
          const m = res.categoryMask;
          if (m) this.renderer.setMask(m.getAsUint8Array(), m.width, m.height);
        });
      }
      this.visionErrors = 0;
    } catch (err) {
      // MediaPipe throws once its own GPU context is gone; the UI reloads the models.
      if (++this.visionErrors === 1) console.warn('[cv-trial] body tracking failed', err);
      if (this.visionErrors === 15) this.onIssue?.('vision-error');
    }

    const posed = !!(this.mesh && lm && skinMesh(this.mesh, lm, W, H, o));
    // Inspectable from DevTools (Inspect the side panel → console: __cvTrial).
    (globalThis as Record<string, unknown>).__cvTrial = { mesh: this.mesh, landmarks: lm, size: [W, H] };
    this.renderer.render(v, posed, { opacity: o.opacity, shading: o.shading, useMask: o.silhouette });
    this.drawOverlay(lm, W, H);
    this.countFrame(!!lm);
  }

  /** Once a second: is the camera still sending real frames? */
  private checkHealth(now: number) {
    // Chrome pauses animation frames while the panel is hidden; don't mistake that for a dead camera.
    if (now - this.lastTickAt > 1500) {
      this.lastFrameAt = now;
      this.blackChecks = 0;
    }
    this.lastTickAt = now;
    if (now - this.lastHealthCheck < 1000) return;
    this.lastHealthCheck = now;
    const v = this.video;

    if (now - this.lastFrameAt > 2500) {
      console.warn('[cv-trial] camera stopped sending frames');
      this.lastFrameAt = now;
      this.onIssue?.('camera-stalled');
      return;
    }
    if (v.readyState < 2) return;
    // Average brightness of a tiny thumbnail: an all-black feed means the camera died
    // (driver hiccup, privacy shutter, another app took it).
    const c = this.probe;
    c.canvas.width = 16;
    c.canvas.height = 12;
    c.drawImage(v, 0, 0, 16, 12);
    const d = c.getImageData(0, 0, 16, 12).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    const avg = sum / (d.length / 4) / 3;
    this.blackChecks = avg < 4 ? this.blackChecks + 1 : 0;
    if (this.blackChecks === 3) {
      console.warn('[cv-trial] camera feed is black');
      this.onIssue?.('camera-black');
    }
  }

  private smooth(lm: NormalizedLandmark[], t: number): NormalizedLandmark[] {
    return lm.map((p, i) => {
      let f = this.filters.get(i);
      if (!f) this.filters.set(i, (f = [new OneEuroFilter(), new OneEuroFilter()]));
      return { ...p, x: f[0].filter(p.x, t), y: f[1].filter(p.y, t) };
    });
  }

  private drawOverlay(lm: NormalizedLandmark[] | null, W: number, H: number) {
    const c = this.overlayCanvas;
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = this.overlay;
    ctx.clearRect(0, 0, W, H);
    if (!lm || !this.options.skeleton) return;
    const p = (i: number) => [(1 - lm[i].x) * W, lm[i].y * H] as const;
    const ok = (i: number) => (lm[i].visibility ?? 0) >= 0.5;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.fillStyle = '#f472b6';
    for (const [a, b] of SKELETON) {
      if (!ok(a) || !ok(b)) continue;
      ctx.beginPath();
      ctx.moveTo(...p(a));
      ctx.lineTo(...p(b));
      ctx.stroke();
    }
    for (const i of new Set(SKELETON.flat())) {
      if (!ok(i)) continue;
      ctx.beginPath();
      ctx.arc(...p(i), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private countFrame(tracking: boolean) {
    this.frames++;
    if (tracking) this.tracked++;
    const now = performance.now();
    if (now - this.fpsStart >= 1000) {
      const fps = Math.round((this.frames * 1000) / (now - this.fpsStart));
      this.onStats?.({ fps, tracking: this.tracked > this.frames / 2 });
      this.frames = 0;
      this.tracked = 0;
      this.fpsStart = now;
    }
  }
}
