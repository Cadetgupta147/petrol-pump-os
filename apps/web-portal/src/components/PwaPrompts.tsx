import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import '../styles/pwa.css';

// Surfaces the two pieces of PWA feedback a dealer actually needs:
//  1. "Offline" banner — so a failed save is understood as "no network", not
//     "the app is broken".
//  2. "New version — Reload" prompt — because registerType is 'prompt', an
//     update installs in the background but only activates on this explicit
//     click, so a half-typed bill is never reloaded away mid-entry.
export function PwaPrompts() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const dismiss = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <>
      {!online && (
        <div className="pwa-offline" role="status">
          Offline — showing last-synced data. Changes can’t be saved until you
          reconnect.
        </div>
      )}

      {needRefresh && (
        <div className="pwa-toast" role="alert">
          <span className="pwa-toast__text">A new version is available.</span>
          <button
            className="pwa-toast__btn"
            onClick={() => void updateServiceWorker(true)}
          >
            Reload
          </button>
          <button className="pwa-toast__btn pwa-toast__btn--ghost" onClick={dismiss}>
            Later
          </button>
        </div>
      )}

      {offlineReady && !needRefresh && (
        <div className="pwa-toast" role="status">
          <span className="pwa-toast__text">Ready to work offline.</span>
          <button
            className="pwa-toast__btn pwa-toast__btn--ghost"
            onClick={dismiss}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
