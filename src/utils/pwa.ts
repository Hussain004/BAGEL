/**
 * Installable-app plumbing: the service worker (offline), the OS "Open with"
 * hand-off (`file_handlers` in the manifest), and the install prompt.
 */

import { ingestFromFiles, openBagFiles } from './droppedFiles';

interface LaunchParams {
  files: Array<{ getFile(): Promise<File> }>;
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** The `beforeinstallprompt` event; not in lib.dom because it is Chromium only. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

/** Ask the worker to cache every built asset, so panels never opened online still work offline. */
async function precacheEverything(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: 'precache' });
}

/**
 * Register the service worker in production. Not inside an iframe: an embed
 * should not install anything on a host page's behalf.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || window.self !== window.top) return;
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => {
      // Someone who installed the app expects it to work offline in full.
      if (isStandalone()) return precacheEverything();
    })
    .catch(() => undefined);
  window.addEventListener('appinstalled', () => void precacheEverything().catch(() => undefined));
}

/**
 * Files the OS opened BAGEL with (double-click, "Open with"). Several files at
 * once go through the same grouping as a drop, so split parts open as one bag.
 */
export function consumeLaunchFiles(): void {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer((params) => {
    if (params.files.length === 0) return;
    void Promise.all(params.files.map((h) => h.getFile()))
      .then((files) => openBagFiles(ingestFromFiles(files), 'replace'))
      .catch(() => undefined);
  });
}
