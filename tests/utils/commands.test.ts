/**
 * Tests for the command list behind the palette.
 *
 * The palette's value is that every action is reachable from one place, so
 * these tests are mostly about *coverage of the surface*: that each kind of
 * command is present, that each one actually calls the store action it claims
 * to, and that the topic commands cover the same panel kinds as the sidebar.
 * A command that silently does nothing is the failure mode worth guarding.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildCommands, parseTimeQuery } from '../../src/utils/commands';
import { panelOptionsFor } from '../../src/utils/panelOptions';
import { useLayoutStore, getAllPanels } from '../../src/store/layoutStore';
import { useBagStore } from '../../src/store/bagStore';
import { usePlayheadStore } from '../../src/store/playheadStore';
import { useAnnotationStore } from '../../src/store/annotationStore';
import { usePresetStore } from '../../src/store/presetStore';
import { useThemeStore } from '../../src/store/themeStore';
import type { TopicInfo } from '../../src/types/bag';

function makeTopic(name: string, type: string): TopicInfo {
  return { name, type, messageCount: 10, serializationFormat: 'cdr' };
}

/** A minimal in-memory bag with a couple of topics, as the palette sees it. */
function seedBag(topics: TopicInfo[], bagId = 'bag1') {
  useBagStore.setState({
    bag: {
      id: bagId,
      fileName: 'test.mcap',
      fileSize: 1024,
      topics,
    } as NonNullable<ReturnType<typeof useBagStore.getState>['bag']>,
    bags: new Map([
      [
        bagId,
        {
          id: bagId,
          kind: 'file',
          color: '#fff',
          liveConn: null,
          source: null,
          summary: { topics, format: 'mcap', fileName: 'test.mcap' },
        },
      ],
    ]),
    focusBagId: bagId,
  });
}

function clearBag() {
  useBagStore.setState({ bag: null, bags: new Map(), focusBagId: null });
}

describe('parseTimeQuery', () => {
  it('accepts a plain number of seconds', () => {
    expect(parseTimeQuery('12')).toBe(12);
    expect(parseTimeQuery('12.5')).toBe(12.5);
    expect(parseTimeQuery('  7 ')).toBe(7);
    expect(parseTimeQuery('0')).toBe(0);
  });

  it('rejects anything that is not only a number', () => {
    // The important one: a command containing a digit must not grow a
    // time-jump twin, so "open /scan 3" is not a time query.
    expect(parseTimeQuery('12s')).toBeNull();
    expect(parseTimeQuery('abc')).toBeNull();
    expect(parseTimeQuery('1.2.3')).toBeNull();
    expect(parseTimeQuery('')).toBeNull();
  });
});

describe('buildCommands', () => {
  beforeEach(() => {
    useLayoutStore.setState({ root: null, openOrder: [], maximizedId: null, lastClosed: null });
    usePlayheadStore.setState({ timeNs: 0n, startNs: 0n, endNs: 30_000_000_000n, playing: false });
    useAnnotationStore.setState({ annotations: [] });
    clearBag();
    try {
      window.localStorage.clear();
    } catch {
      // Not every environment gives us localStorage; the store tolerates it.
    }
  });

  it('always offers the core actions even with no bag loaded', () => {
    const ids = buildCommands().map((c) => c.id);
    expect(ids).toContain('action:theme');
    expect(ids).toContain('action:shortcuts');
    expect(ids).toContain('action:open-bag');
    expect(ids).toContain('action:connect-live');
  });

  it('offers no topic commands when no bag is loaded', () => {
    expect(buildCommands().some((c) => c.group === 'Topics')).toBe(false);
  });

  it('creates one topic command per panel option, matching the sidebar buttons', () => {
    const topics = [
      makeTopic('/camera/image_raw', 'sensor_msgs/msg/Image'),
      makeTopic('/scan', 'sensor_msgs/msg/LaserScan'),
      makeTopic('/odom', 'nav_msgs/msg/Odometry'),
    ];
    seedBag(topics);

    const commands = buildCommands();
    const topicCommands = commands.filter((c) => c.group === 'Topics');

    const expected = topics.reduce((sum, t) => sum + panelOptionsFor(t).length, 0);
    expect(topicCommands).toHaveLength(expected);

    // Spot-check the mapping rather than only the count.
    expect(
      topicCommands.some((c) => c.label === 'Open /camera/image_raw in Image viewer'),
    ).toBe(true);
    expect(topicCommands.some((c) => c.label === 'Open /scan in 3D scene')).toBe(true);
  });

  it('a topic command really opens the panel when run', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    const command = buildCommands().find((c) => c.label === 'Open /scan in 3D scene');
    expect(command).toBeDefined();

    command!.run();

    const open = getAllPanels(useLayoutStore.getState().root);
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe('3d');
    expect(open[0].topicName).toBe('/scan');
    // bagId is threaded through, so a multi-bag setup binds to the right bag.
    expect(open[0].bagId).toBe('bag1');
  });

  it('adds a go-to command only when the query is purely a time', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    expect(buildCommands('12.5').some((c) => c.id === 'goto:time')).toBe(true);
    expect(buildCommands('12.5').find((c) => c.id === 'goto:time')!.label).toBe('Go to 12.5s');
    expect(buildCommands('open /scan').some((c) => c.id === 'goto:time')).toBe(false);
  });

  it('the go-to-time command seeks relative to the bag start', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    usePlayheadStore.setState({ startNs: 1_000n, endNs: 31_000_000_000n, timeNs: 1_000n });

    buildCommands('10').find((c) => c.id === 'goto:time')!.run();

    // startNs + 10s, not an absolute epoch time.
    expect(usePlayheadStore.getState().timeNs).toBe(1_000n + 10_000_000_000n);
  });

  it('a go-to-time command for a time past the end clamps instead of breaking', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    buildCommands('9999').find((c) => c.id === 'goto:time')!.run();
    expect(usePlayheadStore.getState().timeNs).toBe(usePlayheadStore.getState().endNs);
  });

  it('offers a go-to command per bookmark', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    useAnnotationStore.setState({
      annotations: [
        { id: 'a1', timeNs: 4_000_000_000n, label: 'crash' },
        { id: 'a2', timeNs: 9_000_000_000n, label: 'camera drop' },
      ],
    });

    const bookmarks = buildCommands().filter((c) => c.group === 'Go to' && c.id.startsWith('bookmark:'));
    expect(bookmarks).toHaveLength(2);
    expect(bookmarks.map((b) => b.label)).toContain('Go to bookmark "crash"');
  });

  it('a bookmark command seeks and shows the relative time', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    useAnnotationStore.setState({ annotations: [{ id: 'a1', timeNs: 7_000_000_000n, label: 'crash' }] });

    const command = buildCommands().find((c) => c.id === 'bookmark:a1')!;
    expect(command.hint).toBe('7.00s');
    command.run();
    expect(usePlayheadStore.getState().timeNs).toBe(7_000_000_000n);
  });

  it('appends one action per saved preset', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    usePresetStore.setState({
      presets: [
        { id: 'p1', name: 'SLAM debug', tree: { node: 'slot', kind: '3d', type: 'sensor_msgs/msg/LaserScan' } },
      ],
    });

    expect(buildCommands().some((c) => c.label === 'Apply layout preset "SLAM debug"')).toBe(true);
  });

  it('applies a preset when its command is run', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan'), makeTopic('/map', 'nav_msgs/msg/OccupancyGrid')]);
    // Preset trees store type-based slots, not literal topic names - that is
    // the whole point of presets (they survive a different bag).
    usePresetStore.setState({
      presets: [
        {
          id: 'p1',
          name: 'Preset',
          tree: { node: 'slot', kind: '3d', type: 'sensor_msgs/msg/LaserScan' },
        },
      ],
    });

    buildCommands().find((c) => c.id === 'preset:p1')!.run();
    expect(getAllPanels(useLayoutStore.getState().root)).toHaveLength(1);
  });

  it('toggling theme actually toggles it', () => {
    // Assert on the store, not the DOM: `applyTheme` is called from App's effect,
    // and the test environment is Node with no document.
    useThemeStore.setState({ theme: 'dark' });
    buildCommands().find((c) => c.id === 'action:theme')!.run();
    expect(useThemeStore.getState().theme).toBe('light');
    buildCommands().find((c) => c.id === 'action:theme')!.run();
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('play/pause flips the playing flag', () => {
    usePlayheadStore.setState({ playing: false });
    buildCommands().find((c) => c.id === 'action:play-pause')!.run();
    expect(usePlayheadStore.getState().playing).toBe(true);
    buildCommands().find((c) => c.id === 'action:play-pause')!.run();
    expect(usePlayheadStore.getState().playing).toBe(false);
  });

  it('close-every-panel empties the layout', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    useLayoutStore.getState().openPanel({ kind: '3d', topicName: '/scan', type: 't' });
    expect(getAllPanels(useLayoutStore.getState().root)).toHaveLength(1);

    buildCommands().find((c) => c.id === 'action:close-all')!.run();
    expect(useLayoutStore.getState().root).toBeNull();
  });

  it('reopen-last-closed restores a closed panel', () => {
    useLayoutStore.getState().openPanel({ kind: 'plot', topicName: '/imu', type: 't' });
    const id = useLayoutStore.getState().openOrder[0];
    useLayoutStore.getState().closePanel(id);

    buildCommands().find((c) => c.id === 'action:undo-close')!.run();
    expect(getAllPanels(useLayoutStore.getState().root)).toHaveLength(1);
  });

  it('goes to bag start and end', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    usePlayheadStore.setState({ startNs: 0n, endNs: 30_000_000_000n, timeNs: 15_000_000_000n });

    buildCommands().find((c) => c.id === 'goto:end')!.run();
    expect(usePlayheadStore.getState().timeNs).toBe(30_000_000_000n);

    buildCommands().find((c) => c.id === 'goto:start')!.run();
    expect(usePlayheadStore.getState().timeNs).toBe(0n);
  });

  it('gives every command a unique id', () => {
    seedBag([
      makeTopic('/scan', 'sensor_msgs/msg/LaserScan'),
      makeTopic('/map', 'nav_msgs/msg/OccupancyGrid'),
    ]);
    useAnnotationStore.setState({ annotations: [{ id: 'a1', timeNs: 1n, label: 'x' }] });
    const ids = buildCommands('12').map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every command has a runnable action', () => {
    seedBag([makeTopic('/scan', 'sensor_msgs/msg/LaserScan')]);
    for (const command of buildCommands()) {
      expect(typeof command.run, command.id).toBe('function');
      expect(command.label.length, command.id).toBeGreaterThan(0);
      expect(['Topics', 'Actions', 'Go to'], command.id).toContain(command.group);
    }
  });
});