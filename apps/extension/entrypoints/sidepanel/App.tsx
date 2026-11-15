import { Shirt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CameraStage } from '@/components/CameraStage';
import { Controls } from '@/components/Controls';
import { ProductPanel } from '@/components/ProductPanel';
import { prepareGarment, type GarmentAsset } from '@/lib/garment';
import type { Category, ProductInfo } from '@/lib/types';
import { useActiveProduct } from '@/lib/useActiveProduct';

export type GarmentState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; asset: GarmentAsset }
  | { status: 'error'; message: string };

export default function App() {
  const { state, picked, refresh, clearPicked } = useActiveProduct();
  const product: ProductInfo | null = picked ?? (state.status === 'found' ? state.product : null);

  const [category, setCategory] = useState<Category>('top');
  const [garment, setGarment] = useState<GarmentState>({ status: 'idle' });

  // Follow the detected garment type whenever the product changes.
  useEffect(() => {
    if (product?.category) setCategory(product.category);
  }, [product?.imageUrl, product?.category]);

  useEffect(() => {
    if (!product) return setGarment({ status: 'idle' });
    let cancelled = false;
    setGarment({ status: 'loading' });
    // Cuts the garment out of the photo and finds its shoulders/elbows/hips.
    prepareGarment(product.imageUrl, category)
      .then((asset) => !cancelled && setGarment({ status: 'ready', asset }))
      .catch((e: Error) => !cancelled && setGarment({ status: 'error', message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [product?.imageUrl, category]);

  return (
    <div className="flex min-h-screen flex-col gap-3 p-3">
      <header className="flex items-center gap-2">
        <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-violet-600">
          <Shirt className="size-4.5" />
        </div>
        <div className="leading-tight">
          <h1 className="text-sm font-semibold">CV Trial</h1>
          <p className="text-xs text-zinc-400">Virtual trial room</p>
        </div>
      </header>

      <CameraStage garment={garment.status === 'ready' ? garment.asset : null} />

      <ProductPanel
        state={state}
        product={product}
        picked={!!picked}
        garment={garment}
        category={category}
        onCategory={setCategory}
        onRescan={refresh}
        onClearPicked={clearPicked}
      />

      <Controls />

      <footer className="mt-auto pt-2 text-center text-[11px] text-zinc-500">
        Everything runs on your device. No video leaves your computer.
      </footer>
    </div>
  );
}
