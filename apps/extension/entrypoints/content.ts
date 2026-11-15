import { classifyGarment } from '@/lib/classify';
import type { Message, ProductInfo } from '@/lib/types';

/**
 * Finds the main product image + title on the current page.
 * Site-specific rules first (Amazon, Flipkart, Zara, Myntra), then generic fallbacks
 * that work on most stores: schema.org Product data, Open Graph tags, largest image.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let watching = false;
    let lastKey = '';

    browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
      if (msg.type !== 'GET_PRODUCT') return;
      const product = detectProduct();
      lastKey = product?.imageUrl ?? '';
      if (!watching) startWatching();
      sendResponse(product);
    });

    // Only poll once the side panel has asked — so normal browsing pays nothing.
    // Catches single-page-app navigation and colour/variant switches.
    function startWatching() {
      watching = true;
      setInterval(() => {
        if (document.hidden) return;
        const key = detectProduct()?.imageUrl ?? '';
        if (key !== lastKey) {
          lastKey = key;
          browser.runtime.sendMessage({ type: 'PRODUCT_CHANGED' } satisfies Message).catch(() => {});
        }
      }, 1500);
    }
  },
});

function detectProduct(): ProductInfo | null {
  const host = location.hostname;
  const site = host.replace(/^www\./, '');
  const ld = jsonLdProduct();

  let imageUrl: string | null = null;
  let title: string | null = null;

  if (/amazon\./.test(host)) {
    imageUrl = amazonImage();
    title = text('#productTitle');
  } else if (/flipkart\.com$/.test(host)) {
    imageUrl = largestImage((src) => src.includes('rukminim'));
    if (imageUrl) imageUrl = imageUrl.replace(/\/image\/\d+\/\d+\//, '/image/832/832/');
    title = text('h1 span') ?? text('h1');
  } else if (/zara\.com$/.test(host)) {
    imageUrl = ld?.image ?? largestImage((src) => src.includes('static.zara.net'));
  } else if (/myntra\.com$/.test(host)) {
    imageUrl = bgImage('.image-grid-image') ?? largestImage();
    title = [text('.pdp-title'), text('.pdp-name')].filter(Boolean).join(' ') || null;
  }

  imageUrl ??= ld?.image ?? meta('og:image') ?? largestImage();
  title ??= ld?.name ?? meta('og:title') ?? document.title;
  if (!imageUrl) return null;

  const context = [title, breadcrumbText()].join(' ');
  return {
    title: title.trim().slice(0, 200),
    imageUrl: new URL(imageUrl, location.href).href,
    category: classifyGarment(title) ?? classifyGarment(context),
    site,
    pageUrl: location.href,
    source: 'page',
  };
}

const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() || null;
const meta = (prop: string) =>
  document.querySelector<HTMLMetaElement>(`meta[property="${prop}"], meta[name="${prop}"]`)?.content || null;

function amazonImage(): string | null {
  const img = document.querySelector<HTMLImageElement>('#landingImage, #imgBlkFront, #main-image');
  if (!img) return null;
  if (img.dataset.oldHires) return img.dataset.oldHires;
  try {
    // { "url": [w, h], ... } — pick the biggest.
    const dyn = JSON.parse(img.dataset.aDynamicImage ?? '{}') as Record<string, [number, number]>;
    const best = Object.entries(dyn).sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1])[0];
    if (best) return best[0];
  } catch {}
  return img.currentSrc || img.src || null;
}

function jsonLdProduct(): { name?: string; image?: string } | null {
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = findProduct(JSON.parse(s.textContent ?? ''));
      if (found) {
        const img = found.image;
        const image = typeof img === 'string' ? img : Array.isArray(img) ? pickUrl(img[0]) : pickUrl(img);
        return { name: found.name, image: image ?? undefined };
      }
    } catch {}
  }
  return null;
}

function pickUrl(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'url' in v) return String((v as { url: unknown }).url);
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findProduct(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findProduct(n);
      if (r) return r;
    }
    return null;
  }
  const t = node['@type'];
  if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return node;
  if (t === 'ProductGroup' && node.hasVariant) return findProduct(node.hasVariant) ?? node;
  return findProduct(node['@graph'] ?? null);
}

function bgImage(sel: string): string | null {
  const el = document.querySelector<HTMLElement>(sel);
  const m = el && getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
  return m?.[1] ?? null;
}

/** The biggest visible image in the top part of the page — usually the product shot. */
function largestImage(filter: (src: string) => boolean = () => true): string | null {
  let best: { src: string; area: number } | null = null;
  for (const img of document.images) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:') || !filter(src)) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 150 || r.height < 150 || r.top > innerHeight * 1.5) continue;
    const area = r.width * r.height;
    if (!best || area > best.area) best = { src, area };
  }
  return best?.src ?? null;
}

function breadcrumbText(): string {
  const el = document.querySelector(
    '#wayfinding-breadcrumbs_feature_div, nav[aria-label*="readcrumb" i], [class*="breadcrumb" i]',
  );
  return el?.textContent?.replace(/\s+/g, ' ').slice(0, 300) ?? '';
}
