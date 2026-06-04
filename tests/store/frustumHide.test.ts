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

    // Hide a topic.
    const hidden = new Set(['']);
    hidden.add('/camera_front/camera_info');
    update(panelId, { hiddenFrustumTopics: Array.from(hidden).sort() });
    expect(
      useThreeDPanelStore.getState().byId[panelId]?.hiddenFrustumTopics,
    ).toContain('/camera_front/camera_info');

    // Show it again.
    hidden.delete('/camera_front/camera_info');
    update(panelId, { hiddenFrustumTopics: Array.from(hidden).sort() });
    expect(
      useThreeDPanelStore.getState().byId[panelId]?.hiddenFrustumTopics,
    ).not.toContain('/camera_front/camera_info');
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
