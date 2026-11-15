// Copies MediaPipe's WASM runtime out of node_modules and downloads the model files
// into public/, so they are bundled inside the extension (MV3 forbids remote code).
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, '..', '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'mediapipe', 'wasm');
const modelsDir = join(root, 'public', 'models');

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  // Labels every pixel as background / hair / body skin / face skin / clothes / accessories.
  'selfie_multiclass_256x256.tflite':
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
};

const STALE = ['selfie_segmenter.tflite'];

const exists = (p) => stat(p).then(() => true, () => false);

// Only the classic (non-ES-module) runtime is used by FilesetResolver's default settings;
// skipping the module variant saves ~15 MB in the zip.
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];
const localWasm = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const srcDir = (await exists(localWasm)) ? localWasm : wasmSrc;
await rm(wasmDst, { recursive: true, force: true });
await mkdir(wasmDst, { recursive: true });
for (const f of WASM_FILES) await copyFile(join(srcDir, f), join(wasmDst, f));
console.log('[assets] MediaPipe wasm copied');

await mkdir(modelsDir, { recursive: true });
for (const f of STALE) await rm(join(modelsDir, f), { force: true });
for (const [name, url] of Object.entries(MODELS)) {
  const dst = join(modelsDir, name);
  if (await exists(dst)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  await writeFile(dst, Buffer.from(await res.arrayBuffer()));
  console.log(`[assets] downloaded ${name}`);
}
