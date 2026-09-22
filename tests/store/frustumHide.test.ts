/**
 * Tests for v1.3.4 per-camera frustum hide toggle.
 *
 * Exercises:
 *  - hiddenFrustumTopics defaults to [] in DEFAULT_THREE_D_SETTINGS.
 *  - update() can add/remove individual topics from the hidden set.
 *  - portableSubset strips hiddenFrustumTopics (topic names are bag-specific).
 *  - Two panels are isolated - hiding a frustum in one does not affect the other.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useThreeDPanelStore, DEFAULT_THREE_D_SETTINGS } from '../../src/store/threeDPanelStore';
import { portableSubset } from '../../src/store/panelDefaultsStore';

beforeEach(() => {
  useThreeDPanelStore.setState({ byId: {} });
});

describe('hiddenFrustumTopics', () => {
  it('defaults to an empty array', () => {
    expect(DEFAULT_THREE_D_SETTINGS.hiddenFrustumTopics).toEqual([]);
  });

  it('can toggle a topic hidden then visible', () => {
    const { update } = useThreeDPanelStore.getState();
    const panelId = '3d:/velodyne';

    // Replicates `toggleFrustumTopicHidden` from
    // src/components/panels/ThreeDScene/index.tsx: read the FRESH store
    // entry (not a render-captured array), mutate a Set from it, and write
    // the sorted array back - so rapid successive toggles each build on the
    // previous write instead of a stale snapshot.
    const toggleFrustumTopicHidden = (topic: string, hidden: boolean) => {
      const freshSettings = () =>
        useThreeDPanelStore.getState().byId[panelId] ?? DEFAULT_THREE_D_SETTINGS;
      const cur = new Set(freshSettings().hiddenFrustumTopics);
      if (hidden) cur.add(topic);
      else cur.delete(topic);
      update(panelId, { hiddenFrustumTopics: Array.from(cur).sort() });
    };

    // Hide a topic (panel entry does not exist yet: update() upserts it).
    toggleFrustumTopicHidden('/camera_front/camera_info', true);
    expect(
      useThreeDPanelStore.getState().byId[panelId]?.hiddenFrustumTopics,
    ).toEqual(['/camera_front/camera_info']);

    // A second toggle builds on the first write, not a stale snapshot.
    toggleFrustumTopicHidden('/camera_back/camera_info', true);
    expect(
      useThreeDPanelStore.getState().byId[panelId]?.hiddenFrustumTopics,
    ).toEqual(['/camera_back/camera_info', '/camera_front/camera_info'].sort());

    // Show the first topic again: only it leaves the set.
    toggleFrustumTopicHidden('/camera_front/camera_info', false);
    expect(
      useThreeDPanelStore.getState().byId[panelId]?.hiddenFrustumTopics,
    ).toEqual(['/camera_back/camera_info']);

    // Show the second topic: the set is empty again.
    toggleFrustumTopicHidden('/camera_back/camera_info', false);
    expect(useThreeDPanelStore.getState().byId[panelId]?.hiddenFrustumTopics).toEqual([]);
  });

  it('portableSubset strips hiddenFrustumTopics (bag-specific)', () => {
    const result = portableSubset({
      ...DEFAULT_THREE_D_SETTINGS,
      hiddenFrustumTopics: ['/cam1/camera_info'],
    });
    expect('hiddenFrustumTopics' in result).toBe(false);
  });

  it('two panels are isolated from each other', () => {
    const { update } = useThreeDPanelStore.getState();
    update('3d:/velodyne', { hiddenFrustumTopics: ['/cam1/camera_info'] });
    update('3d:/lidar', { hiddenFrustumTopics: [] });

    const stateA = useThreeDPanelStore.getState().byId['3d:/velodyne'];
    const stateB = useThreeDPanelStore.getState().byId['3d:/lidar'];
    expect(stateA?.hiddenFrustumTopics).toContain('/cam1/camera_info');
    expect(stateB?.hiddenFrustumTopics).toEqual([]);
  });
});
