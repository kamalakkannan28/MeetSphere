import { useEffect, useState } from 'react';

/** Captures the browser's install prompt so we can show our own "Install app" button. */
export function usePwaInstall() {
  const [evt, setEvt] = useState(null);
  const [installed, setInstalled] = useState(window.matchMedia?.('(display-mode: standalone)').matches);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setEvt(e); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);

  return {
    canInstall: !!evt && !installed,
    installed,
    install: async () => { if (!evt) return; evt.prompt(); await evt.userChoice; setEvt(null); },
  };
}
