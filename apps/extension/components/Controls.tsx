import { RotateCcw } from 'lucide-react';
import { useSettings } from '@/lib/settings';

export function Controls() {
  const { options: o, set, reset } = useSettings();

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Fit</h2>
        <button onClick={reset} className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200">
          <RotateCcw className="size-3.5" /> Reset
        </button>
      </div>
      <Slider label="Size" value={o.scale} min={0.6} max={1.6} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(scale) => set({ scale })} />
      <Slider label="Height" value={o.offsetY} min={-0.4} max={0.4} step={0.01} fmt={(v) => (v > 0 ? `+${Math.round(v * 100)}` : `${Math.round(v * 100)}`)} onChange={(offsetY) => set({ offsetY })} />
      <Slider label="Opacity" value={o.opacity} min={0.3} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => set({ opacity })} />
      <Slider label="Fabric shading" value={o.shading} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(shading) => set({ shading })} />
      <Toggle label="Shape to body" hint="Trim to your silhouette, hands in front" checked={o.silhouette} onChange={(silhouette) => set({ silhouette })} />
      <Toggle label="Show skeleton" hint="Debug view of tracked joints" checked={o.skeleton} onChange={(skeleton) => set({ skeleton })} />
    </section>
  );
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex justify-between text-zinc-400">
        {p.label} <span className="tabular-nums text-zinc-300">{p.fmt(p.value)}</span>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(+e.target.value)} />
    </label>
  );
}

function Toggle(p: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-zinc-300">{p.label}</span>
        <span className="block text-zinc-500">{p.hint}</span>
      </span>
      <input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} className="size-4 accent-fuchsia-500" />
    </label>
  );
}
