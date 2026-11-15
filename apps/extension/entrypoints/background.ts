import { PICKED_GARMENT_KEY, type ProductInfo } from '@/lib/types';
import { classifyGarment } from '@/lib/classify';

const MENU_ID = 'cv-trial-try-on';

export default defineBackground(() => {
  // Clicking the toolbar icon opens the trial room side panel.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: 'Try this on in CV Trial',
      contexts: ['image'],
    });
  });

  // Right-click any image → try it on. Works on sites the auto-detection doesn't know.
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
    // sidePanel.open must run synchronously inside the user gesture.
    if (tab?.windowId !== undefined) browser.sidePanel.open({ windowId: tab.windowId }).catch(() => {});

    const title = tab?.title ?? '';
    const picked: ProductInfo = {
      title,
      imageUrl: info.srcUrl,
      category: classifyGarment(title),
      site: tab?.url ? new URL(tab.url).hostname.replace(/^www\./, '') : '',
      pageUrl: tab?.url ?? '',
      source: 'context-menu',
    };
    browser.storage.session.set({ [PICKED_GARMENT_KEY]: { ...picked, at: Date.now() } });
  });
});
