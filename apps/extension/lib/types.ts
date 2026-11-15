export type Category = 'top' | 'bottom' | 'dress';

export interface ProductInfo {
  title: string;
  imageUrl: string;
  /** Detected garment type, or null when the page doesn't look like clothing. */
  category: Category | null;
  site: string;
  pageUrl: string;
  source: 'page' | 'context-menu';
}

export type Message =
  | { type: 'GET_PRODUCT' }
  | { type: 'PRODUCT_CHANGED' }
  | { type: 'CAMERA_GRANTED' };

export const PICKED_GARMENT_KEY = 'pickedGarment';
