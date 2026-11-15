# CV Trial — virtual trial room for any shopping site

A Chrome extension that puts clothes from Amazon, Flipkart, Zara, Myntra (and most other stores) onto you, live, through your webcam.

- **Live try-on:** MediaPipe tracks your body; the garment is cut out of the product photo and warped onto you in real time.
- **Works on any store:** auto-detects the product on known sites, and on everything else you can right-click a clothing image → **Try this on in CV Trial**.
- **Private:** all video processing happens on your computer. Nothing is uploaded.

> Status: early preview (v0.1). Tops work best. A photorealistic "Snap HD" mode (AI try-on on a GPU server) is on the roadmap.

## Install (no build needed)

1. Go to [**Releases**](../../releases) and download the latest `cv-trial-extension-vX.Y.Z.zip`.
2. Unzip it. You'll get a folder called `cv-trial-extension`.
3. Open `chrome://extensions` in Chrome (or Edge/Brave: `edge://extensions`, `brave://extensions`).
4. Turn on **Developer mode** (top-right switch).
5. Click **Load unpacked** and pick the `cv-trial-extension` folder.
6. Click the puzzle-piece icon in the toolbar and pin **CV Trial**.

> Don't use GitHub's green "Code → Download ZIP" button. That's the source code and has to be built first. Use the zip from Releases.

## Use it

1. Open a clothing product page, e.g. a T-shirt on Amazon.
2. Click the CV Trial icon. The trial room opens in the side panel.
3. Click **Start camera**. The first time, a tab opens asking for camera access. Click **Allow**; the tab closes by itself.
4. Stand back so your shoulders and hips are visible. The garment follows you.
5. Switch **Top / Bottom / Dress** if the type was guessed wrong, and adjust **Size** and **Height** under **Fit**.

Tips: stand far enough back that your shoulders, elbows and hips are in view, face the camera, and use good front lighting. Product photos of a model facing the camera work best: the garment's shoulders and sleeves are read from the model's pose.

## How it works

```
Product photo ──► MediaPipe multiclass segmentation ──► keep only "clothes" pixels
              │                                         (shirt vs trousers split by colour, or by
              │                                          position when they're the same colour;
              │                                          holes left by the model's hands filled in)
              └─► MediaPipe Pose ──► where the garment's shoulders / elbows / wrists / hips are

Garment ──► triangle mesh (~4k triangles) skinned to a 2D skeleton
            (torso, upper arms, forearms / pelvis, thighs, shins)

Webcam ──► MediaPipe Pose (smoothed) ──► per-bone transforms ──► deform the mesh (WebGL2)
       └─► MediaPipe multiclass segmentation ──► trim cloth to your outline,
                                                 hands & hair drawn in front,
                                                 folds/shadows of your own clothes shaded onto it
```

Sleeves follow your arms and the cloth bends at the joints. The view behaves like a real mirror, so printed text on a garment appears reversed.

All MediaPipe WebAssembly and model files ship inside the extension: Manifest V3 doesn't allow loading code from the internet.

## Develop

Requirements: Node 20+.

```bash
npm install
npm run dev        # opens Chrome with the extension loaded and hot reload
npm run build      # production build → apps/extension/.output/chrome-mv3
npm run zip        # build + release zip → apps/extension/.output/cv-trial-extension-vX.Y.Z.zip
```

`npm run build` first downloads the MediaPipe models (~6 MB) into `apps/extension/public/models/`. They're git-ignored.

### Project layout

```
apps/extension/
├── entrypoints/
│   ├── background.ts      # opens side panel, right-click "Try this on" menu
│   ├── content.ts         # finds the product image/title on shopping pages
│   ├── sidepanel/         # the trial room UI (React + Tailwind)
│   └── permission/        # one-time camera permission page
├── components/            # CameraStage, ProductPanel, Controls
├── lib/
│   ├── engine.ts          # per-frame loop: pose + segmentation → skin mesh → render
│   ├── garment.ts         # cut the garment out of the product photo + find its joints
│   ├── rig.ts             # garment mesh, skinning weights, per-bone transforms
│   ├── renderer.ts        # WebGL2: mirrored video + deformed garment + masks + shading
│   ├── classify.ts        # garment type from the product title
│   └── vision.ts          # MediaPipe setup (GPU with CPU fallback)
└── scripts/               # asset download, release zip, icon generator
```

### Releasing

Push a version tag; GitHub Actions builds the zip and attaches it to a Release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The extension ID is pinned with the `key` field in `wxt.config.ts`, so every unpacked install gets the same ID: `ihgjhaefhldkeijaioeooeiahbfilcdj`.

## Roadmap

- [x] Side panel, webcam, live body tracking
- [x] Product detection (Amazon, Flipkart, Zara, Myntra + generic) and right-click picking
- [x] Garment cut out of model photos (segmentation), shirt/trousers split, hole filling
- [x] Skinned mesh warp: sleeves follow arms, cloth bends at joints (WebGL2)
- [x] Hands/hair in front of the cloth, fold shading from the user's own clothes
- [ ] Back view / side turns (needs a back photo of the garment)
- [ ] **Snap HD:** Python FastAPI backend with diffusion try-on (CatVTON / IDM-VTON) for photorealistic results
- [ ] Next.js companion app: saved looks and history
- [ ] Chrome Web Store release
