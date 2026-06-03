/**
 * Tests for the v1.3.2 CameraInfo pairing + parsing helpers.
 *
 * The React side of `useCameraInfo` (the actual hook) is exercised via the
 * panel manually + the verify skill - here we cover the pure helpers
 * `pickPairedCameraInfo`, `parseCameraInfo`, and the manual-pair persistence
 * through the per-panel store, which give us the most coverage value
 * without dragging in a React renderer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseCameraInfo,
  pickPairedCameraInfo,
} from '../../src/hooks/useCameraInfo';
import {
  DEFAULT_IMAGE_SETTINGS,
  useImagePanelStore,
} from '../../src/store/panelUiStores';

describe('pickPairedCameraInfo - auto-pair convention', () => {
  it('matches /camera/image with /camera/camera_info', () => {
    const candidates = ['/camera/camera_info'];
    expect(pickPairedCameraInfo('/camera/image', candidates)).toBe(
      '/camera/camera_info',
    );
  });

  it('matches /camera/image_raw with /camera/camera_info (last-segment replace)', () => {
    const candidates = ['/camera/camera_info'];
    expect(pickPairedCameraInfo('/camera/image_raw', candidates)).toBe(
      '/camera/camera_info',
    );
  });

  it('matches stereo namespaces /stereo/left/image_raw with /stereo/left/camera_info', () => {
    const candidates = ['/stereo/left/camera_info', '/stereo/right/camera_info'];
    expect(pickPairedCameraInfo('/stereo/left/image_raw', candidates)).toBe(
      '/stereo/left/camera_info',
    );
  });

  it('falls back to the sole bag-wide candidate when no namespace match', () => {
    const candidates = ['/odd/named/camera_info'];
    expect(pickPairedCameraInfo('/raw_topic/image', candidates)).toBe(
      '/odd/named/camera_info',
    );
  });

  it('returns null when multiple candidates exist and none share the prefix', () => {
    const candidates = ['/cam_a/camera_info', '/cam_b/camera_info'];
    expect(pickPairedCameraInfo('/unrelated/image', candidates)).toBeNull();
  });

  it('returns null when the candidate list is empty', () => {
    expect(pickPairedCameraInfo('/any/image', [])).toBeNull();
  });
});

describe('parseCameraInfo', () => {
  it('extracts fx, fy, cx, cy from K and width / height from the message', () => {
    const info = parseCameraInfo(
      {
        header: { frame_id: 'cam_optical_frame', stamp: { sec: 0, nanosec: 0 } },
        width: 640,
        height: 480,
        distortion_model: 'plumb_bob',
        d: [-0.1, 0.2, 0.0, 0.0, 0.05],
        k: [525, 0, 320, 0, 525, 240, 0, 0, 1],
      },
      0n,
    );
    expect(info).not.toBeNull();
    expect(info!.fx).toBe(525);
    expect(info!.fy).toBe(525);
    expect(info!.cx).toBe(320);
    expect(info!.cy).toBe(240);
    expect(info!.width).toBe(640);
    expect(info!.height).toBe(480);
    expect(info!.distortionModel).toBe('plumb_bob');
    expect(info!.distortionCoefficients).toEqual([-0.1, 0.2, 0.0, 0.0, 0.05]);
    expect(info!.frameId).toBe('cam_optical_frame');
  });

  it('falls back to ROS1 uppercase K / D field names', () => {
    const info = parseCameraInfo(
      {
        header: { frame_id: 'cam', stamp: { sec: 0, nanosec: 0 } },
        width: 320,
        height: 240,
        distortion_model: 'plumb_bob',
        D: [0, 0, 0, 0, 0],
        K: [300, 0, 160, 0, 300, 120, 0, 0, 1],
      },
      0n,
    );
    expect(info).not.toBeNull();
    expect(info!.fx).toBe(300);
    expect(info!.cx).toBe(160);
  });

  it('returns null when K is too short or fx / fy is non-positive', () => {
    expect(
      parseCameraInfo({ k: [], width: 100, height: 100 }, 0n),
    ).toBeNull();
    expect(
      parseCameraInfo(
        { k: [0, 0, 0, 0, 0, 0, 0, 0, 0], width: 100, height: 100 },
        0n,
      ),
    ).toBeNull();
  });

  it('returns null when width / height is missing or non-positive', () => {
    expect(
      parseCameraInfo({ k: [1, 0, 0, 0, 1, 0, 0, 0, 1], width: 0, height: 480 }, 0n),
    ).toBeNull();
  });

  it('tolerates TypedArray K (some serializers emit fixed-length arrays as Float64Array)', () => {
    const k = new Float64Array([400, 0, 160, 0, 400, 120, 0, 0, 1]);
    const info = parseCameraInfo(
      { width: 320, height: 240, k, d: new Float64Array([0, 0, 0, 0, 0]) },
      0n,
    );
    expect(info).not.toBeNull();
    expect(info!.fx).toBe(400);
  });
});

describe('distortion-likely-unfilled detection in parseCameraInfo + result wrapper', () => {
  // The check itself is exercised via the hook's calibrationLikelyUnfilled
  // field; here we verify the underlying signal: an all-zero D[0..4] means
  // the publisher left the calibration template alone, which is the v1.3.2
  // overlay's warning-chip trigger.
  it('returns all-zero coefficients verbatim when the publisher left them blank', () => {
    const info = parseCameraInfo(
      {
        width: 640,
        height: 480,
        k: [525, 0, 320, 0, 525, 240, 0, 0, 1],
        d: [0, 0, 0, 0, 0],
      },
      0n,
    );
    expect(info!.distortionCoefficients).toEqual([0, 0, 0, 0, 0]);
  });

  it('preserves non-zero coefficients (calibration was run)', () => {
    const info = parseCameraInfo(
      {
        width: 640,
        height: 480,
        k: [525, 0, 320, 0, 525, 240, 0, 0, 1],
        d: [-0.31, 0.15, 0.001, -0.002, -0.04],
      },
      0n,
    );
    expect(info!.distortionCoefficients[0]).toBeCloseTo(-0.31, 3);
    expect(info!.distortionCoefficients.some((c) => c !== 0)).toBe(true);
  });
});

describe('ImagePanelSettings - manual pair persistence', () => {
  beforeEach(() => {
    // Reset between tests so each starts from defaults.
    useImagePanelStore.setState({ byId: {} });
  });

  it('keeps the manual override per panelId across "remount" reads', () => {
    const panelId = 'image:bag1:%2Fcamera%2Fimage';
    const update = useImagePanelStore.getState().update;
    update(panelId, { cameraInfoManualPair: '/odd_pair/camera_info' });

    // Simulate a remount: a fresh read against the same id returns the
    // persisted value (the same code path the panel takes after a dock).
    const value =
      useImagePanelStore.getState().byId[panelId] ?? DEFAULT_IMAGE_SETTINGS;
    expect(value.cameraInfoManualPair).toBe('/odd_pair/camera_info');
    expect(value.cameraInfoOverlay).toBe(false); // unrelated field untouched
  });

  it('isolates settings between sibling panels', () => {
    const a = 'image:bag1:%2Fa';
    const b = 'image:bag1:%2Fb';
    const update = useImagePanelStore.getState().update;
    update(a, { cameraInfoManualPair: '/cam_a/camera_info' });
    update(b, { cameraInfoOverlay: true });
    const state = useImagePanelStore.getState().byId;
    expect(state[a].cameraInfoManualPair).toBe('/cam_a/camera_info');
    expect(state[a].cameraInfoOverlay).toBe(false);
    expect(state[b].cameraInfoOverlay).toBe(true);
    expect(state[b].cameraInfoManualPair).toBe('');
  });
});
