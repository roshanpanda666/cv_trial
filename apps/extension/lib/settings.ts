import { create } from 'zustand';
import type { RenderOptions } from './engine';

const KEY = 'renderOptions';

export const DEFAULT_OPTIONS: RenderOptions = {
  scale: 1,
  offsetY: 0,
  opacity: 1,
  shading: 0.5,
  silhouette: true,
  skeleton: false,
};

interface SettingsState {
  options: RenderOptions;
  set: (patch: Partial<RenderOptions>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  options: DEFAULT_OPTIONS,
  set: (patch) => {
    const options = { ...get().options, ...patch };
    set({ options });
    browser.storage.local.set({ [KEY]: options });
  },
  reset: () => {
    set({ options: DEFAULT_OPTIONS });
    browser.storage.local.remove(KEY);
  },
}));

// Restore saved settings once on load.
browser.storage.local.get(KEY).then((r) => {
  if (r[KEY]) useSettings.setState({ options: { ...DEFAULT_OPTIONS, ...(r[KEY] as RenderOptions) } });
});
