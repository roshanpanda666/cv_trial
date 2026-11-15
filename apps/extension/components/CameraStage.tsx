import { Camera, Loader2, ShieldAlert, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { TryOnEngine, type EngineIssue, type EngineStats } from '@/lib/engine';
import { useSettings } from '@/lib/settings';
import type { GarmentAsset } from '@/lib/garment';
import type { Message } from '@/lib/types';
import { getVision, resetVision } from '@/lib/vision';

type CamState =
  | { status: 'off' }
  | { status: 'starting'; step: string }
  | { status: 'live' }
  | { status: 'needs-permission' }
  | { status: 'error'; message: string };

export function CameraStage({ garment }: { garment: GarmentAsset | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TryOnEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<CamState>({ status: 'off' });
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [recovering, setRecovering] = useState<string | null>(null);
  const recoveries = useRef<number[]>([]);
  const options = useSettings((s) => s.options);

  // Push the latest garment/settings into the running engine.
  useEffect(() => {
    engineRef.current?.setGarment(garment);
  }, [garment, cam.status]);
  useEffect(() => {
    if (engineRef.current) engineRef.current.options = options;
  }, [options, cam.status]);

  async function openStream() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = stream;
    // The OS can end the track (camera unplugged, driver reset, another app took it).
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (streamRef.current === stream) recover('camera-stalled');
    });
    const video = videoRef.current!;
    video.srcObject = stream;
    await video.play();
  }

  /** Self-healing: reopen the camera or reload the models without user action. */
  async function recover(issue: EngineIssue) {
    const engine = engineRef.current;
    if (!engine) return;
    const now = Date.now();
    recoveries.current = recoveries.current.filter((t) => now - t < 60_000).concat(now);
    if (recoveries.current.length > 4) {
      stop();
      setCam({
        status: 'error',
        message:
          issue === 'vision-error'
            ? 'Body tracking keeps crashing (GPU problem). Try closing other heavy tabs, then start again.'
            : 'The camera keeps going black. Check that no other app is using it, then start again.',
      });
      return;
    }
    console.warn('[cv-trial] recovering from', issue);
    try {
      if (issue === 'vision-error') {
        setRecovering('Restarting body tracking…');
        await resetVision();
        engine.setVision(await getVision());
      } else {
        setRecovering('Reconnecting camera…');
        await openStream();
        engine.resetHealth();
      }
    } catch (err) {
      console.error('[cv-trial] recovery failed', err);
    } finally {
      setRecovering(null);
    }
  }

  async function start() {
    try {
      setCam({ status: 'starting', step: 'Opening camera…' });
      await openStream();
      const video = videoRef.current!;

      setCam({ status: 'starting', step: 'Loading body-tracking models…' });
      const vision = await getVision();

      const engine = new TryOnEngine(video, canvasRef.current!, overlayRef.current!, vision);
      engine.onStats = setStats;
      engine.onIssue = recover;
      engineRef.current = engine;
      engine.start();
      setCam({ status: 'live' });
    } catch (err) {
      stop();
      const e = err as DOMException;
      if (e.name === 'NotAllowedError') setCam({ status: 'needs-permission' });
      else setCam({ status: 'error', message: e.message || String(err) });
    }
  }

  function stop() {
    engineRef.current?.stop();
    engineRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStats(null);
    setCam({ status: 'off' });
  }

  // The side panel can't show Chrome's camera prompt, so permission is granted once
  // in a normal tab; it then applies to the whole extension. Retry when that's done.
  useEffect(() => {
    const onMsg = (msg: Message) => {
      if (msg.type === 'CAMERA_GRANTED') start();
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => {
      browser.runtime.onMessage.removeListener(onMsg);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = cam.status === 'live';

  return (
    <section className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="relative aspect-[4/3] w-full">
        {/* Not display:none: Chrome may stop updating frames of a video that isn't rendered. */}
        <video ref={videoRef} className="pointer-events-none absolute size-px opacity-0" playsInline muted />
        <canvas ref={canvasRef} className={`absolute inset-0 size-full object-cover ${live ? '' : 'hidden'}`} />
        <canvas ref={overlayRef} className={`pointer-events-none absolute inset-0 size-full object-cover ${live ? '' : 'hidden'}`} />

        {!live && (
          <div className="absolute inset-0 grid place-items-center p-4 text-center">
            {cam.status === 'off' && (
              <button
                onClick={start}
                className="flex items-center gap-2 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium hover:bg-fuchsia-500"
              >
                <Camera className="size-4" /> Start camera
              </button>
            )}
            {cam.status === 'starting' && (
              <p className="flex items-center gap-2 text-sm text-zinc-300">
                <Loader2 className="size-4 animate-spin" /> {cam.step}
              </p>
            )}
            {cam.status === 'needs-permission' && (
              <div className="space-y-3">
                <ShieldAlert className="mx-auto size-6 text-amber-400" />
                <p className="text-sm text-zinc-300">Chrome needs your OK to use the camera.</p>
                <button
                  onClick={() => browser.tabs.create({ url: browser.runtime.getURL('/permission.html') })}
                  className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium hover:bg-fuchsia-500"
                >
                  Allow camera
                </button>
              </div>
            )}
            {cam.status === 'error' && (
              <div className="space-y-3">
                <VideoOff className="mx-auto size-6 text-red-400" />
                <p className="text-sm text-zinc-300">{cam.message}</p>
                <button onClick={start} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700">
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {live && (
        <div className="flex items-center justify-between border-t border-zinc-800 px-3 py-1.5 text-xs">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className={`size-2 rounded-full ${stats?.tracking ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {recovering ?? (stats?.tracking ? 'Tracking you' : 'Step back so your upper body is visible')}
            {stats && <span className="text-zinc-600">· {stats.fps} fps</span>}
          </span>
          <button onClick={stop} className="text-zinc-400 hover:text-zinc-100">
            Stop
          </button>
        </div>
      )}

    </section>
  );
}
