import { ImageOff, Loader2, MousePointerClick, RefreshCw, X } from 'lucide-react';
import type { GarmentState } from '@/entrypoints/sidepanel/App';
import type { Category, ProductInfo } from '@/lib/types';
import type { ProductState } from '@/lib/useActiveProduct';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'dress', label: 'Dress' },
];

interface Props {
  state: ProductState;
  product: ProductInfo | null;
  picked: boolean;
  garment: GarmentState;
  category: Category;
  onCategory: (c: Category) => void;
  onRescan: () => void;
  onClearPicked: () => void;
}

export function ProductPanel({ state, product, picked, garment, category, onCategory, onRescan, onClearPicked }: Props) {
  if (!product) {
    const msg = {
      loading: 'Looking for a product on this page…',
      unsupported: 'Open a shopping site like Amazon, Flipkart or Zara.',
      'needs-reload': 'Reload the shopping page so CV Trial can read it.',
      none: 'No product found on this page.',
      found: '',
    }[state.status];
    return (
      <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm">
        <p className="text-zinc-300">{msg}</p>
        <p className="flex items-center gap-1.5 text-xs text-zinc-500">
          <MousePointerClick className="size-3.5" /> Tip: right-click any clothing image → “Try this on”.
        </p>
        <button onClick={onRescan} className="flex items-center gap-1.5 text-xs text-fuchsia-400 hover:text-fuchsia-300">
          <RefreshCw className="size-3.5" /> Scan again
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <div className="flex gap-3">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:12px_12px]">
          {garment.status === 'ready' && (
            <img src={garment.asset.canvas.toDataURL()} alt="" className="max-h-full max-w-full object-contain" />
          )}
          {garment.status === 'loading' && <Loader2 className="size-5 animate-spin text-zinc-400" />}
          {garment.status === 'error' && <ImageOff className="size-5 text-red-400" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="line-clamp-2 text-sm font-medium" title={product.title}>
            {product.title || 'Selected image'}
          </p>
          <p className="text-xs text-zinc-500">
            {product.site}
            {picked && ' · picked by you'}
          </p>
          {garment.status === 'error' && <p className="text-xs text-red-400">{garment.message}</p>}
          {!product.category && (
            <p className="text-xs text-amber-400">Not sure this is clothing — pick a type below.</p>
          )}
        </div>
        {picked ? (
          <button onClick={onClearPicked} title="Back to page product" className="self-start text-zinc-500 hover:text-zinc-200">
            <X className="size-4" />
          </button>
        ) : (
          <button onClick={onRescan} title="Scan page again" className="self-start text-zinc-500 hover:text-zinc-200">
            <RefreshCw className="size-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-950 p-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => onCategory(c.id)}
            className={`rounded-md py-1.5 text-xs font-medium transition ${
              category === c.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}
