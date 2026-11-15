import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Public key that pins the extension ID when loaded unpacked, so every install
// gets the same ID: ihgjhaefhldkeijaioeooeiahbfilcdj
// (The Chrome Web Store assigns its own key; drop this field when publishing there.)
const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA16ZYWf5PAcKxd0sz7aHjUOXUC9OyCOEbMuaFgQSymfYEOCa7AJz0Z+siRJ5FX3a6iSJPcL6/2M/R56JcqVREvsBEELO9fbhAByhjFbNSQh0tgpZP25zcAyaVY/fTqCJQ9wo9rRD4PWVZH1X2y2pCj9sLltJG8+wa1VHeoYKVwz+zYm/aFdyaTHfDFBcICxMmoLjsPdlsq+Lt7l3br72+swbg1289Fn9Ld+e5uq+PITWHMVETYrFXySMKIfxStWiYupVaEMSkuXbOVTSBEkSFF6Q9fv5hERKWa43VNysYhl/cHpF/HEdmW9vsKGPb1NWF7zLsUD+2n8URCyRfkIhB0QIDAQAB';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'CV Trial – Virtual Try-On',
    description: 'Try clothes from any shopping site on yourself, live, using your webcam.',
    key: EXTENSION_KEY,
    permissions: ['sidePanel', 'storage', 'contextMenus'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open virtual trial room' },
    content_security_policy: {
      // MediaPipe runs as WebAssembly; all of it is bundled locally (no remote code).
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [],
  },
});
