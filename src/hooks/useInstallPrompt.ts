import { useSyncExternalStore } from 'react';
import { isStandalone, type InstallPromptEvent } from '../utils/pwa';

// The browser fires `beforeinstallprompt` once, early, so it is captured at
// module load rather than when a component mounts.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A function that shows the browser's install dialog, or null when installing is not possible right now. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const event = useSyncExternalStore(subscribe, () => deferred, () => null);
  if (!event || isStandalone()) return null;
  return async () => {
    await event.prompt();
    await event.userChoice;
    deferred = null;
    emit();
  };
}
