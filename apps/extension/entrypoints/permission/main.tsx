import { Camera, CheckCircle2, XCircle } from 'lucide-react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Message } from '@/lib/types';
import '@/assets/style.css';

// Chrome can't show the camera prompt inside the side panel, so this tab asks once.
// The permission is saved for the extension, and the side panel can then use the camera.
function PermissionPage() {
  const [status, setStatus] = useState<'asking' | 'granted' | 'denied'>('asking');

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        setStatus('granted');
        browser.runtime.sendMessage({ type: 'CAMERA_GRANTED' } satisfies Message).catch(() => {});
        setTimeout(() => window.close(), 1200);
      })
      .catch(() => setStatus('denied'));
  }, []);

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        {status === 'asking' && (
          <>
            <Camera className="mx-auto size-10 text-fuchsia-400" />
            <h1 className="text-lg font-semibold">Allow camera access</h1>
            <p className="text-sm text-zinc-400">
              Click <b>Allow</b> in Chrome's prompt. Your video is processed on this computer and never uploaded.
            </p>
          </>
        )}
        {status === 'granted' && (
          <>
            <CheckCircle2 className="mx-auto size-10 text-emerald-400" />
            <h1 className="text-lg font-semibold">Camera enabled</h1>
            <p className="text-sm text-zinc-400">You can go back to the trial room. This tab will close.</p>
          </>
        )}
        {status === 'denied' && (
          <>
            <XCircle className="mx-auto size-10 text-red-400" />
            <h1 className="text-lg font-semibold">Camera blocked</h1>
            <p className="text-sm text-zinc-400">
              Click the camera icon in the address bar, choose <b>Allow</b>, then reload this page.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PermissionPage />
  </StrictMode>,
);
