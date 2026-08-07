import { useEffect, useState } from 'react';
import { Share, PlusSquare, Download, X } from 'lucide-react';
import '../styles/pwa.css';

// The `beforeinstallprompt` event isn't in the standard DOM lib types.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

// Once the user dismisses (or installs), don't nag on every subsequent visit.
const DISMISS_KEY = 'pumpos.pwaInstallDismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's non-standard installed flag
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = window.navigator.userAgent;
  const iPhoneish = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as desktop Safari ("MacIntel") — disambiguate by touch.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iPhoneish || iPadOS;
}

// Announces that PumpOS can be installed to the device, and shows how.
// Self-managing: mounts once at the app root and decides its own visibility.
export function InstallPwaModal() {
  // iOS Safari never fires beforeinstallprompt — the only way in is the manual
  // Share → Add to Home Screen flow, so decide its initial visibility up front
  // (rather than setState-in-effect) when we're on iOS and not yet installed.
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (isStandalone()) return false;
    if (localStorage.getItem(DISMISS_KEY) === '1') return false;
    return isIos();
  });
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return; // already installed — nothing to offer
    if (localStorage.getItem(DISMISS_KEY) === '1') return; // user already declined

    // Android / desktop Chromium: capture the native prompt so we can drive it
    // from our own "Install app" button instead of Chrome's mini-infobar.
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setOpen(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const onInstalled = () => {
      setOpen(false);
      localStorage.setItem(DISMISS_KEY, '1');
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setOpen(false);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  const handleInstall = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice; // resolves once the user accepts/dismisses
    setPromptEvent(null);
    dismiss();
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={dismiss}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="pwa-install-head">
          <img
            src="/pwa-192x192.png"
            alt=""
            width={48}
            height={48}
            className="pwa-install-icon"
          />
          <div>
            <h3 style={{ margin: 0 }}>Install PumpOS</h3>
            <span className="section-note">
              Add it to your device for full-screen, offline access.
            </span>
          </div>
        </div>

        {promptEvent && (
          <button
            type="button"
            className="export-btn pwa-install-cta"
            onClick={() => void handleInstall()}
          >
            <Download size={16} /> Install app
          </button>
        )}

        <p className="section-note" style={{ marginTop: 16, marginBottom: 0 }}>
          On iPhone or iPad, add it from Safari in two steps:
        </p>
        <ol className="pwa-steps">
          <li className="pwa-step">
            <span className="pwa-step__icon">
              <Share size={18} />
            </span>
            <span>
              Click on <strong>Share</strong>
            </span>
          </li>
          <li className="pwa-step">
            <span className="pwa-step__icon">
              <PlusSquare size={18} />
            </span>
            <span>
              Click on <strong>Add to Home Screen</strong>
            </span>
          </li>
        </ol>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={dismiss}>
            <X size={14} /> Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
