import { useCallback, useEffect, useState } from 'react';
import { PICKED_GARMENT_KEY, type Message, type ProductInfo } from './types';

export type ProductState =
  | { status: 'loading' }
  | { status: 'unsupported' } // chrome:// pages, the web store, etc.
  | { status: 'needs-reload' } // tab was open before the extension was installed
  | { status: 'none' }
  | { status: 'found'; product: ProductInfo };

/** Tracks the product shown in the active tab, plus anything picked via right-click. */
export function useActiveProduct() {
  const [state, setState] = useState<ProductState>({ status: 'loading' });
  const [picked, setPicked] = useState<ProductInfo | null>(null);

  const refresh = useCallback(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return setState({ status: 'unsupported' });
    try {
      const product = (await browser.tabs.sendMessage(tab.id, { type: 'GET_PRODUCT' } satisfies Message)) as
        | ProductInfo
        | null;
      setState(product ? { status: 'found', product } : { status: 'none' });
    } catch {
      setState({ status: 'needs-reload' });
    }
  }, []);

  useEffect(() => {
    refresh();
    const onActivated = () => {
      setPicked(null);
      refresh();
    };
    const onUpdated = (_id: number, info: { status?: string }, tab: { active?: boolean }) => {
      if (tab.active && info.status === 'complete') refresh();
    };
    const onMessage = (msg: Message, sender: { tab?: { active?: boolean } }) => {
      if (msg.type === 'PRODUCT_CHANGED' && sender.tab?.active) refresh();
    };
    const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && changes[PICKED_GARMENT_KEY]?.newValue) {
        setPicked(changes[PICKED_GARMENT_KEY].newValue as ProductInfo);
      }
    };
    browser.storage.session.get(PICKED_GARMENT_KEY).then((r) => {
      if (r[PICKED_GARMENT_KEY]) setPicked(r[PICKED_GARMENT_KEY] as ProductInfo);
    });
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.runtime.onMessage.addListener(onMessage);
    browser.storage.onChanged.addListener(onStorage);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.runtime.onMessage.removeListener(onMessage);
      browser.storage.onChanged.removeListener(onStorage);
    };
  }, [refresh]);

  const clearPicked = useCallback(() => {
    setPicked(null);
    browser.storage.session.remove(PICKED_GARMENT_KEY);
  }, []);

  return { state, picked, refresh, clearPicked };
}
