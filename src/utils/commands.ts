/**
 * The command list behind the palette.
 *
 * Kept separate from the component so the assembly is pure and testable, and
 * so the list can be reasoned about without rendering anything. Every entry
 * calls an existing store action: the palette adds **discovery**, not
 * behaviour. If a command here does something the toolbar does not already do,
 * that is a bug in the command, not a gap in the palette.
 */

import { useBagStore, resolveBagEntry } from '../store/bagStore';
import { useLayoutStore } from '../store/layoutStore';
import { usePlayheadStore } from '../store/playheadStore';
import { useThemeStore } from '../store/themeStore';
import { useUiStore } from '../store/uiStore';
import { useAnnotationStore } from '../store/annotationStore';
import { usePresetStore } from '../store/presetStore';
import { panelOptionsFor, KIND_PALETTE_LABEL } from '../utils/panelOptions';
import { exportLabels } from './labelsExport';
import { BUNDLED_TOURS, SAMPLE_FILE_NAME, startTourFromUrl } from './tourRunner';

export type CommandGroup = 'Topics' | 'Actions' | 'Go to' | 'Tours';

export interface Command {
  id: string;
  /** Primary text. */
  label: string;
  /** Secondary text shown right-aligned. */
  hint?: string;
  group: CommandGroup;
  /** Extra text the fuzzy matcher searches but that is not displayed. */
  keywords?: string[];
  run: () => void;
}

/**
 * Seconds parsed out of a typed query, so `12.5` jumps the playhead.
 *
 * Only when the query is *nothing but* a number, otherwise every command
 * containing a digit would grow a time-jump twin.
 */
export function parseTimeQuery(query: string): number | null {
  const trimmed = query.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Seek to an absolute second within the bag, clamped by the playhead store. */
function seekToSeconds(seconds: number): void {
  const playhead = usePlayheadStore.getState();
  // Absolute times in the palette are relative to the bag start, matching how
  // the timeline and the URL hash both present time.
  playhead.seek(playhead.startNs + BigInt(Math.round(seconds * 1e9)));
}

export function buildCommands(query = ''): Command[] {
  const commands: Command[] = [];
  const bagState = useBagStore.getState();
  const bag = bagState.bag;

  // Topic commands: one per (topic, panel kind) pair, matching the sidebar's
  // quick-open buttons exactly rather than inventing a second mapping.
  if (bag) {
    const focusBagId = bagState.focusBagId;
    const entry = resolveBagEntry(bagState, focusBagId);
    for (const topic of entry?.summary.topics ?? []) {
      for (const kind of panelOptionsFor(topic)) {
        commands.push({
          id: `topic:${focusBagId ?? ''}:${topic.name}:${kind}`,
          label: `Open ${topic.name} in ${KIND_PALETTE_LABEL[kind]}`,
          hint: topic.type,
          group: 'Topics',
          keywords: [topic.name, topic.type, KIND_PALETTE_LABEL[kind]],
          run: () =>
            useLayoutStore.getState().openPanel({
              kind,
              topicName: topic.name,
              type: topic.type,
              bagId: focusBagId ?? undefined,
            }),
        });
      }
    }
  }

  const focusedEntry = resolveBagEntry(bagState, bagState.focusBagId);
  const bagIsLive = focusedEntry?.kind === 'live';
  const { startNs, endNs } = usePlayheadStore.getState();
  const durationSec = Number(endNs - startNs) / 1e9;

  // Navigation: typed numbers, bookmarks, and the two ends of the timeline.
  const timeTarget = parseTimeQuery(query);
  if (timeTarget !== null) {
    commands.push({
      id: 'goto:time',
      label: `Go to ${timeTarget}s`,
      hint: `of ${durationSec.toFixed(1)}s`,
      group: 'Go to',
      keywords: ['seek', 'time', 'jump'],
      run: () => seekToSeconds(timeTarget),
    });
  }

  for (const annotation of useAnnotationStore.getState().annotations) {
    const seconds = Number(annotation.timeNs - usePlayheadStore.getState().startNs) / 1e9;
    commands.push({
      id: `bookmark:${annotation.id}`,
      label: `Go to bookmark "${annotation.label}"`,
      hint: `${seconds.toFixed(2)}s`,
      group: 'Go to',
      keywords: ['bookmark', 'jump', annotation.label],
      run: () => seekToSeconds(seconds),
    });
  }

  commands.push({
    id: 'goto:start',
    label: 'Go to bag start',
    hint: 'Home',
    group: 'Go to',
    keywords: ['begin', 'home'],
    run: () => usePlayheadStore.getState().seek(usePlayheadStore.getState().startNs),
  });
  commands.push({
    id: 'goto:end',
    label: 'Go to bag end',
    hint: 'End',
    group: 'Go to',
    keywords: ['finish', 'end'],
    run: () => usePlayheadStore.getState().seek(usePlayheadStore.getState().endNs),
  });

  commands.push(
    {
      id: 'action:theme',
      label: 'Toggle light / dark theme',
      group: 'Actions',
      keywords: ['appearance', 'dark', 'light'],
      run: () => useThemeStore.getState().toggleTheme(),
    },
    {
      id: 'action:bookmark',
      label: 'Add bookmark at playhead',
      hint: 'M',
      group: 'Actions',
      keywords: ['marker', 'annotate'],
      run: () => useAnnotationStore.getState().addAnnotation(usePlayheadStore.getState().timeNs, ''),
    },
    {
      id: 'action:undo-close',
      label: 'Reopen last closed panel',
      hint: 'Cmd/Ctrl + Z',
      group: 'Actions',
      keywords: ['undo', 'restore'],
      run: () => useLayoutStore.getState().reopenLastClosed(),
    },
    {
      id: 'action:bag-edit',
      label: 'Edit bag (trim, filter topics, export MCAP)',
      group: 'Actions',
      keywords: ['trim', 'clip', 'export'],
      run: () => useUiStore.getState().setModal('bag-edit'),
    },
    {
      id: 'action:clip-export',
      label: 'Export a panel as video or PNG zip',
      group: 'Actions',
      keywords: ['record', 'video', 'mp4', 'png'],
      run: () => useUiStore.getState().setModal('clip-export'),
    },
    {
      id: 'action:urdf',
      label: 'Load a robot model (URDF)',
      group: 'Actions',
      keywords: ['robot', 'mesh'],
      run: () => useUiStore.getState().setModal('urdf-load'),
    },
    {
      id: 'action:share',
      label: 'Share this view (link or badge)',
      hint: 'Dataset badge',
      group: 'Actions',
      keywords: ['link', 'url', 'embed', 'badge'],
      run: () => useUiStore.getState().setModal('share'),
    },
    {
      id: 'action:health',
      label: 'Open bag health dashboard',
      group: 'Actions',
      keywords: ['diagnostics', 'hz', 'jitter', 'gaps'],
      run: () =>
        useLayoutStore.getState().openPanel({
          kind: 'health',
          topicName: '__health__',
          type: '',
          bagId: useBagStore.getState().focusBagId ?? undefined,
        }),
    },
    {
      id: 'action:play-pause',
      label: 'Play / pause',
      hint: 'Space',
      group: 'Actions',
      keywords: ['playback', 'run'],
      run: () => usePlayheadStore.getState().setPlaying(!usePlayheadStore.getState().playing),
    },
    {
      id: 'action:close-all',
      label: 'Close every panel',
      hint: 'Shift + Esc',
      group: 'Actions',
      keywords: ['clear', 'reset'],
      run: () => useLayoutStore.getState().closeAllPanels(),
    },
    {
      id: 'action:shortcuts',
      label: 'Show keyboard shortcuts',
      hint: '?',
      group: 'Actions',
      keywords: ['help', 'keys', 'hotkeys'],
      run: () => useUiStore.getState().setModal('shortcuts'),
    },
  );

  // Presets are user data, so they are appended after the built-ins rather than
  // hard-coded: an empty preset list contributes nothing.
  for (const preset of usePresetStore.getState().presets) {
    commands.push({
      id: `preset:${preset.id}`,
      label: `Apply layout preset "${preset.name}"`,
      group: 'Actions',
      keywords: ['layout', 'preset', preset.name],
      run: () => usePresetStore.getState().applyPreset(preset.id),
    });
  }

  // Loading another bag returns to the landing page, which owns file and URL
  // input. Doing it from here means the palette cannot get stuck on a workspace
  // the user wants to leave.
  commands.push({
    id: 'action:open-bag',
    label: 'Open a different bag',
    group: 'Actions',
    keywords: ['load', 'file', 'browse'],
    run: () => useBagStore.getState().clearAll(),
  });

  // Driving only makes sense for a live connection, so it is offered only then.
  if (bagState.bags.get(bagState.focusBagId ?? '')?.kind === 'live') {
    commands.push({
      id: 'action:control',
      label: 'Robot control: drive from the browser',
      hint: 'off until you enable it',
      group: 'Actions',
      keywords: ['teleop', 'drive', 'joystick', 'cmd_vel', 'publish', 'twist'],
      run: () => useUiStore.getState().setControlOpen(true),
    });
  }

  commands.push(
    {
      id: 'action:labels',
      label: 'Labels: list, annotate and export',
      hint: 'bookmarks and ranges',
      group: 'Actions',
      keywords: ['label', 'annotate', 'bookmark', 'range', 'note', 'training'],
      run: () => useUiStore.getState().setModal('labels'),
    },
    {
      id: 'action:frames',
      label: 'Export frames as images',
      hint: 'a zip of PNG or JPEG files with a CSV of times',
      group: 'Actions',
      keywords: ['frames', 'images', 'export', 'dataset', 'training', 'png', 'jpeg', 'pcd'],
      run: () => useUiStore.getState().openFrameExport(),
    },
    {
      id: 'action:labels-csv',
      label: 'Export labels as CSV',
      group: 'Actions',
      keywords: ['label', 'export', 'spreadsheet', 'annotations'],
      run: () => exportLabels('csv'),
    },
    {
      id: 'action:labels-json',
      label: 'Export labels as JSON',
      group: 'Actions',
      keywords: ['label', 'export', 'annotations'],
      run: () => exportLabels('json'),
    },
  );

  if (!bagIsLive) {
    commands.push({
      id: 'action:connect-live',
      label: 'Connect to a live robot',
      hint: 'ws:// or wss://',
      group: 'Actions',
      keywords: ['websocket', 'live', 'bridge', 'rosbridge'],
      run: () => requestLiveTab(),
    });
  }

  // Guided tours run on the sample bag, so offer them only where that is safe:
  // with the sample open, or with nothing open (the tour then opens the sample).
  // Never over a bag the person opened themselves.
  if (!bag || bag.fileName === SAMPLE_FILE_NAME) {
    for (const tour of BUNDLED_TOURS) {
      commands.push({
        id: `tour:${tour.id}`,
        label: `Guided tour: ${tour.title}`,
        hint: tour.description,
        group: 'Tours',
        keywords: ['tour', 'learn', 'tutorial', 'teach', 'guide', tour.title],
        run: () => void startTourFromUrl(tour.id),
      });
    }
  }

  return commands;
}

/**
 * Clear the workspace so the landing page returns, remembering that the live
 * tab was the one asked for.
 *
 * The live input lives on the landing page rather than in a modal, so the
 * palette cannot open it directly. A one-shot sessionStorage flag lets
 * LandingPage pick the right tab on mount without threading a cross-component
 * prop through the store, and it is consumed rather than left to expire so a
 * later visit does not reopen on the live tab by accident.
 */
export const PENDING_LIVE_TAB_KEY = 'bagel:pending-live-tab';

export function requestLiveTab(): void {
  useBagStore.getState().clearAll();
  try {
    window.sessionStorage.setItem(PENDING_LIVE_TAB_KEY, '1');
  } catch {
    // sessionStorage can throw in sandboxed iframes; the landing page then
    // opens on its default tab, which is not a failure worth surfacing.
  }
}

/** Read and clear the flag. Returns false when there was nothing pending. */
export function consumePendingLiveTab(): boolean {
  try {
    if (window.sessionStorage.getItem(PENDING_LIVE_TAB_KEY) !== '1') return false;
    window.sessionStorage.removeItem(PENDING_LIVE_TAB_KEY);
    return true;
  } catch {
    return false;
  }
}