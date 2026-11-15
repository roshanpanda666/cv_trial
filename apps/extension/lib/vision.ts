import { FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';

// Everything is loaded from inside the extension package (no CDN): MV3 forbids remote code.
const base = location.origin;
const POSE_MODEL = `${base}/models/pose_landmarker_lite.task`;
const SEG_MODEL = `${base}/models/selfie_multiclass_256x256.tflite`;

/** Classes of the multiclass selfie segmenter. */
export const SEG = { background: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4, others: 5 } as const;

export interface Vision {
  /** Live webcam models (GPU when available). */
  pose: PoseLandmarker;
  segmenter: ImageSegmenter;
  /** Still-image models for analysing product photos (CPU, run once per product). */
  imagePose: PoseLandmarker;
  imageSegmenter: ImageSegmenter;
  delegate: 'GPU' | 'CPU';
}

async function create(delegate: 'GPU' | 'CPU'): Promise<Vision> {
  const fileset = await FilesetResolver.forVisionTasks(`${base}/mediapipe/wasm`);
  const [pose, segmenter, imagePose, imageSegmenter] = await Promise.all([
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    }),
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: SEG_MODEL, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    }),
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numPoses: 1,
    }),
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    }),
  ]);
  return { pose, segmenter, imagePose, imageSegmenter, delegate };
}

let shared: Promise<Vision> | null = null;

/** Loads all models once and shares them between the camera and the garment analyser. */
export function getVision(): Promise<Vision> {
  shared ??= create('GPU').catch((err) => {
    console.warn('[cv-trial] GPU delegate failed, falling back to CPU', err);
    return create('CPU');
  });
  return shared;
}

/** Drops the loaded models (e.g. after the GPU context was lost) so the next getVision() reloads them. */
export async function resetVision() {
  const old = shared;
  shared = null;
  const v = await old?.catch(() => null);
  for (const m of [v?.pose, v?.segmenter, v?.imagePose, v?.imageSegmenter]) {
    try {
      m?.close();
    } catch {}
  }
}
