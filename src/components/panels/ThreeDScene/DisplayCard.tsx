import { useMemo, useState, type ReactNode } from 'react';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { OverlayCard } from '../shared/OverlayCard';
import { type MapColorSchemeChoice, type PoseDisplayStyle, type SpatialOverlayStyle, type UpAxis } from '../../../store/threeDPanelStore';
import { detectKind, type SceneKind } from './sceneKind';
import { type RobotSubtreeWarning } from './robotModel';
import { type TFGraph } from '../TFTree/useTFGraph';
import type { ColorMode } from '../../../utils/pointcloud';
import { overlayKey, type SpatialOverlayTopic } from './spatialOverlayTopics';
import { type AccumulationMode } from './accumulator';

const UP_AXIS_OPTIONS: { value: UpAxis; label: string }[] = [
  { value: 'z+', label: '+Z up (ROS default)' },
  { value: 'z-', label: '-Z up (flipped)' },
  { value: 'y+', label: '+Y up' },
  { value: 'y-', label: '-Y up' },
  { value: 'x+', label: '+X up' },
  { value: 'x-', label: '-X up' },
];

export interface ControlsCardProps {
  sceneKind: SceneKind;
  colorMode: ColorMode;
  setColorMode: (m: ColorMode) => void;
  pointSize: number;
  setPointSize: (s: number) => void;
  laserScanColor: string | null;
  setLaserScanColor: (color: string | null) => void;
  showGrid: boolean;
  setShowGrid: (v: boolean) => void;
  showWorldAxes: boolean;
  setShowWorldAxes: (v: boolean) => void;
  graph: TFGraph | null;
  worldFrame: string | null;
  setWorldFrame: (f: string) => void;
  noTf: boolean;
  rangeLimitOn: boolean;
  setRangeLimitOn: (v: boolean) => void;
  maxRange: number;
  setMaxRange: (n: number) => void;
  accumulating: boolean;
  setAccumulating: (v: boolean) => void;
  accumMode: AccumulationMode;
  setAccumMode: (m: AccumulationMode) => void;
  accumBudget: number;
  setAccumBudget: (n: number) => void;
  accumPerFrame: number;
  setAccumPerFrame: (n: number) => void;
  voxelSize: number;
  setVoxelSize: (n: number) => void;
  onClearAccumulator: () => void;
  accumStats: { points: number; frames: number };
  upAxis: UpAxis;
  setUpAxis: (a: UpAxis) => void;
  /** Every namespace the marker stream has ever published - sorted. */
  markerNamespaces: string[];
  /** Namespaces the user has hidden from the marker filter. */
  hiddenMarkerNamespaces: string[];
  onToggleNamespace: (ns: string, hidden: boolean) => void;
  /** Clear the hidden-namespace list in one write ("show all"). */
  onShowAllNamespaces: () => void;
  /** Global alpha multiplier for OccupancyGrid panels (0…1). */
  mapAlpha: number;
  setMapAlpha: (a: number) => void;
  /** OccupancyGrid color scheme for this panel's own primary topic. */
  mapColorScheme: MapColorSchemeChoice;
  setMapColorScheme: (v: MapColorSchemeChoice) => void;
  /** Per-bag colored robot markers - only offered once more than one bag is loaded. */
  showRobotMarkers: boolean;
  setShowRobotMarkers: (v: boolean) => void;
  multiBag: boolean;
  poseDisplayStyle: PoseDisplayStyle;
  setPoseDisplayStyle: (v: PoseDisplayStyle) => void;
  poseFlattenOrientation: boolean;
  setPoseFlattenOrientation: (v: boolean) => void;
  showPoseAxesTripod: boolean;
  setShowPoseAxesTripod: (v: boolean) => void;
  /** Color override for this panel's own pose topic. `null` uses `bagColor`. */
  poseColor: string | null;
  setPoseColor: (v: string | null) => void;
  /** This panel's bag color, used as the pose color picker's "auto" value. */
  bagColor: string;
  spatialOverlayCandidates: SpatialOverlayTopic[];
  spatialOverlayTopics: string[];
  onToggleSpatialOverlay: (bagId: string, topic: string, visible: boolean) => void;
  spatialOverlayStyles: Record<string, SpatialOverlayStyle>;
  onSetSpatialOverlayStyle: (
    bagId: string,
    topic: string,
    patch: Partial<SpatialOverlayStyle>,
  ) => void;
  /** Color + display label per loaded bag, for tagging cross-bag overlay candidates. */
  overlayBagMeta: Map<string, { color: string; label: string }>;
  /** How many overlay candidates are currently selected (drives the "N layers" badges). */
  selectedOverlayCount: number;
  hasPointCloudLayer: boolean;
  hasPointLayer: boolean;
  hasMapLayer: boolean;
  /** A URDF has been loaded app-wide. */
  hasRobotModel: boolean;
  /** Source filename (for the title attribute). */
  robotName: string | null;
  /** This panel hides the robot model. */
  robotHidden: boolean;
  setRobotHidden: (hidden: boolean) => void;
  /** Non-fatal URDF build warnings, surfaced as an amber hint. */
  robotWarnings: RobotSubtreeWarning[];
  /** Bag has a JointState topic the model can ingest. */
  robotHasJointStates: boolean;
  /** Number of `sensor_msgs/CameraInfo` topics in the bag (v1.3.2). */
  cameraFrustumCount: number;
  /** Master toggle for the camera frustum overlay. */
  cameraFrustumsOn: boolean;
  setCameraFrustumsOn: (v: boolean) => void;
  /** Far-plane distance for the frustum, in metres. */
  cameraFrustumFar: number;
  setCameraFrustumFar: (v: number) => void;
  /** All CameraInfo topic names (v1.3.4). Used to render per-camera hide checkboxes. */
  cameraInfoTopics: string[];
  /** Topics whose frustum the user has hidden (v1.3.4). */
  hiddenFrustumTopics: string[];
  onToggleFrustumTopic: (topic: string, hidden: boolean) => void;
  /** Human-readable scene-kind label for the v1.3.3 defaults UI ("PointCloud2"). */
  sceneKindLabel: string;
  /** True when a user default is saved for this scene kind. */
  hasSavedDefault: boolean;
  onSaveAsDefault: () => void;
  onResetToDefault: () => void;
  onClearSavedDefault: () => void;
  /** Per-axis clip box (v1.6.1). */
  clipBoxOn: boolean;
  setClipBoxOn: (v: boolean) => void;
  clipBounds: { xMin: number | null; xMax: number | null; yMin: number | null; yMax: number | null; zMin: number | null; zMax: number | null };
  onSetClipBound: (axis: 'x' | 'y' | 'z', side: 'min' | 'max', v: number | null) => void;
  /** Disclosure-section expand state (v1.7 progressive disclosure). */
  sectionCoordFrameOpen: boolean;
  setSectionCoordFrameOpen: (v: boolean) => void;
  sectionRangeClipOpen: boolean;
  setSectionRangeClipOpen: (v: boolean) => void;
  sectionAccumulationOpen: boolean;
  setSectionAccumulationOpen: (v: boolean) => void;
  sectionOverlaysOpen: boolean;
  setSectionOverlaysOpen: (v: boolean) => void;
}

export function ControlsCard({
  sceneKind,
  colorMode,
  setColorMode,
  pointSize,
  setPointSize,
  laserScanColor,
  setLaserScanColor,
  showGrid,
  setShowGrid,
  showWorldAxes,
  setShowWorldAxes,
  graph,
  worldFrame,
  setWorldFrame,
  noTf,
  rangeLimitOn,
  setRangeLimitOn,
  maxRange,
  setMaxRange,
  accumulating,
  setAccumulating,
  accumMode,
  setAccumMode,
  accumBudget,
  setAccumBudget,
  accumPerFrame,
  setAccumPerFrame,
  voxelSize,
  setVoxelSize,
  onClearAccumulator,
  accumStats,
  upAxis,
  setUpAxis,
  markerNamespaces,
  hiddenMarkerNamespaces,
  onToggleNamespace,
  onShowAllNamespaces,
  mapAlpha,
  setMapAlpha,
  mapColorScheme,
  setMapColorScheme,
  showRobotMarkers,
  setShowRobotMarkers,
  multiBag,
  poseDisplayStyle,
  setPoseDisplayStyle,
  poseFlattenOrientation,
  setPoseFlattenOrientation,
  showPoseAxesTripod,
  setShowPoseAxesTripod,
  poseColor,
  setPoseColor,
  bagColor,
  spatialOverlayCandidates,
  spatialOverlayTopics,
  onToggleSpatialOverlay,
  spatialOverlayStyles,
  onSetSpatialOverlayStyle,
  overlayBagMeta,
  selectedOverlayCount,
  hasPointCloudLayer,
  hasPointLayer,
  hasMapLayer,
  hasRobotModel,
  robotName,
  robotHidden,
  setRobotHidden,
  robotWarnings,
  robotHasJointStates,
  cameraFrustumCount,
  cameraFrustumsOn,
  setCameraFrustumsOn,
  cameraFrustumFar,
  setCameraFrustumFar,
  cameraInfoTopics,
  hiddenFrustumTopics,
  onToggleFrustumTopic,
  sceneKindLabel,
  hasSavedDefault,
  onSaveAsDefault,
  onResetToDefault,
  onClearSavedDefault,
  clipBoxOn,
  setClipBoxOn,
  clipBounds,
  onSetClipBound,
  sectionCoordFrameOpen,
  setSectionCoordFrameOpen,
  sectionRangeClipOpen,
  setSectionRangeClipOpen,
  sectionAccumulationOpen,
  setSectionAccumulationOpen,
  sectionOverlaysOpen,
  setSectionOverlaysOpen,
}: ControlsCardProps) {
  const [open, setOpen] = useState(false);
  // Esc closes the Display card, not the whole panel (see useEscapeToClose).
  useEscapeToClose(open, () => setOpen(false));
  const allFrames = useMemo(() => (graph ? Array.from(graph.frames).sort() : []), [graph]);
  const hiddenSet = useMemo(
    () => new Set(hiddenMarkerNamespaces),
    [hiddenMarkerNamespaces],
  );

  return (
    <OverlayCard elevated className="text-xs mono">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-2.5 py-1.5 flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>Display</span>
        {selectedOverlayCount > 0 && (
          <span className="text-accent-cyan text-[10px]">
            {selectedOverlayCount + 1} layers
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border w-56">
        <div className="p-2.5 space-y-2 max-h-[60vh] overflow-y-auto">
          {hasPointCloudLayer && (
            <div>
              <div className="text-text-tertiary text-[10px] mb-1">color by</div>
              <div className="flex gap-1 flex-wrap">
                {(['height', 'intensity', 'single'] as ColorMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setColorMode(m)}
                    aria-pressed={colorMode === m}
                    className={`px-2 py-0.5 rounded-md transition-colors ${
                      colorMode === m
                        ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40'
                        : 'border border-border text-text-secondary hover:border-accent-blue/40'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
          {sceneKind === 'laserscan' && (
            <div>
              <div className="text-text-tertiary text-[10px] mb-1">scan color</div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="LaserScan color"
                  value={laserScanColor ?? '#22d3ee'}
                  onChange={(event) => setLaserScanColor(event.target.value)}
                  // Chrome anchors the native color picker below the input without
                  // checking whether it fits - inside this scrolling dropdown that
                  // means it can render off the bottom of the screen. Centering the
                  // input first gives it room on both sides.
                  onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center' })}
                  className="w-8 h-6 rounded border border-border bg-transparent cursor-pointer"
                />
                <button
                  type="button"
                  aria-pressed={laserScanColor === null}
                  onClick={() => setLaserScanColor(null)}
                  className={
                    laserScanColor === null
                      ? 'px-2 py-0.5 rounded border border-accent-blue/40 text-accent-blue'
                      : 'px-2 py-0.5 rounded border border-border text-text-secondary hover:border-accent-blue/40'
                  }
                  title="Use the decoded range gradient"
                >
                  range
                </button>
              </div>
            </div>
          )}
          {hasPointLayer && (
            <div>
              <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                <span>point size</span>
                <span className="text-text-secondary">{pointSize.toFixed(1)}px</span>
              </div>
              <input
                type="range"
                aria-label="Point size"
                min={0.2}
                max={8}
                step={0.1}
                value={pointSize}
                onChange={(e) => setPointSize(Number(e.target.value))}
                className="w-full accent-accent-blue"
              />
            </div>
          )}
          {hasMapLayer && (
            <div>
              <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                <span>map alpha</span>
                <span className="text-text-secondary">{Math.round(mapAlpha * 100)}%</span>
              </div>
              <input
                type="range"
                aria-label="Map alpha"
                min={0.05}
                max={1}
                step={0.05}
                value={mapAlpha}
                onChange={(e) => setMapAlpha(Number(e.target.value))}
                className="w-full accent-accent-blue"
                title="Global fade on top of the per-cell unknown/free/occupied ramp"
              />
            </div>
          )}
          {sceneKind === 'occupancygrid' && (
            <div>
              <div className="text-text-tertiary text-[10px] mb-1">map style</div>
              <div className="flex gap-1">
                {(['auto', 'map', 'costmap'] as MapColorSchemeChoice[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setMapColorScheme(v)}
                    aria-pressed={mapColorScheme === v}
                    className={`px-2 py-0.5 rounded-md transition-colors ${
                      mapColorScheme === v
                        ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40'
                        : 'border border-border text-text-secondary hover:border-accent-blue/40'
                    }`}
                    title={
                      v === 'auto'
                        ? 'Costmap palette for topics named "costmap", grayscale otherwise'
                        : v === 'costmap'
                          ? "Nav2/rviz costmap palette - obstacles in cyan/magenta, cost gradient in blue-magenta"
                          : 'Grayscale, for SLAM/static maps'
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Pose display controls only apply to this panel's own pose topic;
              pose-typed *overlays* get their per-candidate style block in the
              Overlays section below, so gating here on the panel kind (rather
              than "any pose layer exists") is what keeps the controls from
              showing up on panels whose settings they don't affect. */}
          {sceneKind === 'pose' && (
            <div>
              <div className="text-text-tertiary text-[10px] mb-1">pose style</div>
              <div className="flex gap-1">
                {(['arrow', 'robot'] as PoseDisplayStyle[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setPoseDisplayStyle(v)}
                    aria-pressed={poseDisplayStyle === v}
                    className={`px-2 py-0.5 rounded-md transition-colors ${
                      poseDisplayStyle === v
                        ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40'
                        : 'border border-border text-text-secondary hover:border-accent-blue/40'
                    }`}
                    title={
                      v === 'arrow'
                        ? 'Thick heading arrow, tinted with the bag color'
                        : 'Small colored robot puck instead of an arrow'
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={poseFlattenOrientation}
                    onChange={(e) => setPoseFlattenOrientation(e.target.checked)}
                    className="accent-accent-blue"
                  />
                  <span title="Ignore roll/pitch so IMU noise doesn't tilt the marker in a top-down view">
                    flatten
                  </span>
                </label>
                <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPoseAxesTripod}
                    onChange={(e) => setShowPoseAxesTripod(e.target.checked)}
                    className="accent-accent-blue"
                  />
                  orientation axes
                </label>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  aria-label="Pose color"
                  value={poseColor ?? bagColor}
                  onChange={(event) => setPoseColor(event.target.value)}
                  onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center' })}
                  className="w-8 h-6 rounded border border-border bg-transparent cursor-pointer"
                />
                <button
                  type="button"
                  aria-pressed={poseColor === null}
                  onClick={() => setPoseColor(null)}
                  className={
                    poseColor === null
                      ? 'px-2 py-0.5 rounded border border-accent-blue/40 text-accent-blue'
                      : 'px-2 py-0.5 rounded border border-border text-text-secondary hover:border-accent-blue/40'
                  }
                  title="Use this bag's color"
                >
                  auto
                </button>
              </div>
            </div>
          )}
          {/* Everyday four, stop here: color by / point size / grid / axes.
              Everything below is one click away in a disclosure section -
              collapsed by default so a first-time user sees four controls,
              not twenty. */}
          <div className="flex items-center justify-between pt-1 border-t border-border/60">
            <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
                className="accent-accent-blue"
              />
              grid
            </label>
            <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showWorldAxes}
                onChange={(e) => setShowWorldAxes(e.target.checked)}
                className="accent-accent-blue"
              />
              axes
            </label>
          </div>

          <DisclosureSection
            label="Coordinate frame"
            open={sectionCoordFrameOpen}
            onToggle={setSectionCoordFrameOpen}
          >
            <div>
              <div className="text-text-tertiary text-[10px] mb-1">up axis</div>
              <select
                value={upAxis}
                onChange={(e) => setUpAxis(e.target.value as UpAxis)}
                className="w-full px-2 py-1 rounded-md bg-surface border border-border text-text-primary text-xs mono focus:outline-none focus:border-accent-blue/50"
                title="Rotates the cloud so the chosen source-frame axis points up in the rendered scene"
              >
                {UP_AXIS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {!noTf && allFrames.length > 0 && (
              <div>
                <div className="text-text-tertiary text-[10px] mb-1">world frame</div>
                <select
                  value={worldFrame ?? ''}
                  onChange={(e) => setWorldFrame(e.target.value)}
                  className="w-full px-2 py-1 rounded-md bg-surface border border-border text-text-primary text-xs mono focus:outline-none focus:border-accent-blue/50"
                >
                  {allFrames.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </DisclosureSection>

          {hasPointCloudLayer && (
            <DisclosureSection
              label="Range and clipping"
              open={sectionRangeClipOpen}
              onToggle={setSectionRangeClipOpen}
            >
              <div>
                <label className="flex items-center justify-between text-text-secondary cursor-pointer mb-1">
                  <span className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={rangeLimitOn}
                      onChange={(e) => setRangeLimitOn(e.target.checked)}
                      className="accent-accent-blue"
                    />
                    limit range
                  </span>
                  <span className="text-text-tertiary text-[10px]">
                    {rangeLimitOn ? `${maxRange.toFixed(0)} m` : 'off'}
                  </span>
                </label>
                <input
                  type="range"
                  aria-label="Maximum range"
                  min={1}
                  max={200}
                  step={1}
                  value={maxRange}
                  disabled={!rangeLimitOn}
                  onChange={(e) => setMaxRange(Number(e.target.value))}
                  className="w-full accent-accent-blue disabled:opacity-40"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer mb-1.5">
                  <input
                    type="checkbox"
                    checked={clipBoxOn}
                    onChange={(e) => setClipBoxOn(e.target.checked)}
                    className="accent-accent-blue"
                  />
                  clip box
                </label>
                {clipBoxOn && (
                  <div className="space-y-1">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <div key={axis} className="grid items-center gap-1" style={{ gridTemplateColumns: '0.75rem 1fr 1fr' }}>
                        <span className="text-text-tertiary uppercase text-center">{axis}</span>
                        <ClipBoundInput
                          value={clipBounds[`${axis}Min`]}
                          onChange={(v) => onSetClipBound(axis, 'min', v)}
                          placeholder="min"
                          label={`${axis} min clip bound`}
                        />
                        <ClipBoundInput
                          value={clipBounds[`${axis}Max`]}
                          onChange={(v) => onSetClipBound(axis, 'max', v)}
                          placeholder="max"
                          label={`${axis} max clip bound`}
                        />
                      </div>
                    ))}
                    <p className="text-text-muted text-[9px] leading-tight pt-0.5">
                      empty = no clip on that side
                    </p>
                  </div>
                )}
              </div>
            </DisclosureSection>
          )}

          {sceneKind === 'pointcloud' && (
            <DisclosureSection
              label="Accumulation"
              open={sectionAccumulationOpen}
              onToggle={setSectionAccumulationOpen}
            >
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-text-secondary cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={accumulating}
                      onChange={(e) => setAccumulating(e.target.checked)}
                      className="accent-accent-blue"
                    />
                    accumulate
                  </span>
                  {accumulating && (
                    <button
                      onClick={onClearAccumulator}
                      className="text-text-tertiary hover:text-accent-rose text-[10px] underline decoration-dotted"
                      title="Clear accumulated points"
                    >
                      clear
                    </button>
                  )}
                </label>
                {/* Mode toggle - ring keeps the last N points, voxel deduplicates
                    by grid cell for a true downsampled map. */}
                <div className="flex gap-1">
                  {(['ring', 'voxel'] as AccumulationMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setAccumMode(m)}
                      disabled={!accumulating}
                      aria-pressed={accumMode === m}
                      title={
                        m === 'ring'
                          ? 'FIFO ring buffer - most recent N points'
                          : 'Voxel grid downsample - one point per cell'
                      }
                      className={`flex-1 px-2 py-0.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        accumMode === m
                          ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40'
                          : 'border border-border text-text-secondary hover:border-accent-blue/40'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                {accumMode === 'voxel' && (
                  <div>
                    <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                      <span>voxel size</span>
                      <span className="text-text-secondary">
                        {voxelSize < 1 ? `${(voxelSize * 100).toFixed(0)} cm` : `${voxelSize.toFixed(2)} m`}
                      </span>
                    </div>
                    <input
                      type="range"
                      aria-label="Voxel size"
                      min={0.05}
                      max={2.0}
                      step={0.05}
                      value={voxelSize}
                      disabled={!accumulating}
                      onChange={(e) => setVoxelSize(Number(e.target.value))}
                      className="w-full accent-accent-blue disabled:opacity-40"
                    />
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                    <span>per-frame pts</span>
                    <span className="text-text-secondary">
                      {accumPerFrame >= 1000 ? `${(accumPerFrame / 1000).toFixed(0)}k` : accumPerFrame}
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Accumulator points per frame"
                    min={1000}
                    max={500_000}
                    step={5000}
                    value={accumPerFrame}
                    disabled={!accumulating}
                    onChange={(e) => setAccumPerFrame(Number(e.target.value))}
                    className="w-full accent-accent-blue disabled:opacity-40"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                    <span>budget</span>
                    <span className="text-text-secondary">
                      {(accumBudget / 1_000_000).toFixed(1)}M pts
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Accumulator point budget"
                    min={250_000}
                    max={10_000_000}
                    step={250_000}
                    value={accumBudget}
                    disabled={!accumulating}
                    onChange={(e) => setAccumBudget(Number(e.target.value))}
                    className="w-full accent-accent-blue disabled:opacity-40"
                  />
                </div>
                {accumulating && (
                  <div className="text-text-tertiary text-[10px] leading-tight">
                    {accumStats.points.toLocaleString()} / {accumBudget.toLocaleString()} pts
                    {accumStats.points >= accumBudget && (
                      <span className="text-accent-amber ml-1">
                        ({accumMode === 'voxel' ? 'oldest cells dropping' : 'oldest dropping'})
                      </span>
                    )}
                  </div>
                )}
                {accumulating && noTf && (
                  <div className="text-accent-amber/80 text-[10px] leading-tight">
                    no /tf - frames will overlap in the sensor frame
                  </div>
                )}
              </div>
            </DisclosureSection>
          )}

          {(spatialOverlayCandidates.length > 0 || hasRobotModel || cameraFrustumCount > 0 || multiBag || (sceneKind === 'markerarray' && markerNamespaces.length > 0)) && (
            <DisclosureSection
              label="Overlays"
              open={sectionOverlaysOpen}
              onToggle={setSectionOverlaysOpen}
            >
              {multiBag && (
                <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showRobotMarkers}
                    onChange={(e) => setShowRobotMarkers(e.target.checked)}
                    className="accent-accent-blue"
                  />
                  robot markers
                  <span className="text-text-tertiary text-[10px]">
                    (colored puck per loaded bag)
                  </span>
                </label>
              )}
              {spatialOverlayCandidates.length > 0 && (
                <div>
                  <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                    <span>scene topics</span>
                    <span>{selectedOverlayCount + 1} layers</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                    {spatialOverlayCandidates.map((candidate) => {
                      const key = overlayKey(candidate.bagId, candidate.name);
                      const checked = spatialOverlayTopics.includes(key);
                      const shortType = candidate.type.split('/').pop() ?? candidate.type;
                      const candidateKind = detectKind(candidate.type);
                      const supportsPointStyle =
                        candidateKind === 'pointcloud' || candidateKind === 'laserscan';
                      const style = spatialOverlayStyles[key] ?? {};
                      const layerPointSize = style.pointSize ?? pointSize;
                      // Only shown once >1 bag is loaded, since a single-bag
                      // panel has nothing to disambiguate.
                      const bagMeta =
                        overlayBagMeta.size > 1 ? overlayBagMeta.get(candidate.bagId) : undefined;
                      const title = bagMeta
                        ? `${bagMeta.label}: ${candidate.name} (${candidate.type})`
                        : `${candidate.name} (${candidate.type})`;
                      // Two bags can expose the same topic name, so prefix the
                      // color input's accessible name with the bag label to
                      // keep the two swatches distinguishable to screen readers.
                      const colorLabel = bagMeta
                        ? `${bagMeta.label}: ${candidate.name} color`
                        : `${candidate.name} color`;
                      return (
                        <div key={key}>
                          <label
                            className={checked ? 'flex items-center gap-1.5 cursor-pointer text-text-secondary' : 'flex items-center gap-1.5 cursor-pointer text-text-tertiary'}
                            title={title}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                onToggleSpatialOverlay(candidate.bagId, candidate.name, event.target.checked)
                              }
                              className="accent-accent-cyan flex-shrink-0"
                            />
                            {bagMeta && (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: bagMeta.color }}
                              />
                            )}
                            <span className="truncate flex-1">{candidate.name}</span>
                            <span className="text-[9px] text-text-tertiary flex-shrink-0">
                              {shortType}
                            </span>
                          </label>
                          {checked && supportsPointStyle && (
                            <div className="ml-5 mt-1 space-y-1 rounded border border-border/70 p-1.5">
                              <label className="flex items-center gap-1.5 text-[9px] text-text-tertiary">
                                <span>size</span>
                                <input
                                  type="range"
                                  aria-label={candidate.name + ' point size'}
                                  min={0.2}
                                  max={8}
                                  step={0.1}
                                  value={layerPointSize}
                                  onChange={(event) =>
                                    onSetSpatialOverlayStyle(candidate.bagId, candidate.name, {
                                      pointSize: Number(event.target.value),
                                    })
                                  }
                                  className="min-w-0 flex-1 accent-accent-cyan"
                                />
                                <span className="w-8 text-right text-text-secondary">
                                  {layerPointSize.toFixed(1)}
                                </span>
                              </label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  aria-label={colorLabel}
                                  value={style.color ?? '#22d3ee'}
                                  onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center' })}
                                  onChange={(event) =>
                                    onSetSpatialOverlayStyle(candidate.bagId, candidate.name, {
                                      color: event.target.value,
                                    })
                                  }
                                  className="h-5 w-7 cursor-pointer rounded border border-border bg-transparent"
                                />
                                <button
                                  type="button"
                                  aria-label={'Use automatic colors for ' + candidate.name}
                                  aria-pressed={style.color == null}
                                  onClick={() =>
                                    onSetSpatialOverlayStyle(candidate.bagId, candidate.name, { color: null })
                                  }
                                  className={
                                    style.color == null
                                      ? 'rounded border border-accent-cyan/40 px-1.5 text-accent-cyan'
                                      : 'rounded border border-border px-1.5 text-text-tertiary hover:border-accent-cyan/40'
                                  }
                                >
                                  auto
                                </button>
                              </div>
                            </div>
                          )}
                          {checked && candidateKind === 'occupancygrid' && (
                            <div className="ml-5 mt-1 space-y-1 rounded border border-border/70 p-1.5">
                              <div className="text-[9px] text-text-tertiary">map style</div>
                              <div className="flex gap-1">
                                {(['auto', 'map', 'costmap'] as MapColorSchemeChoice[]).map((v) => (
                                  <button
                                    key={v}
                                    type="button"
                                    aria-pressed={(style.mapColorScheme ?? 'auto') === v}
                                    onClick={() =>
                                      onSetSpatialOverlayStyle(candidate.bagId, candidate.name, {
                                        mapColorScheme: v,
                                      })
                                    }
                                    className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                                      (style.mapColorScheme ?? 'auto') === v
                                        ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/40'
                                        : 'border border-border text-text-tertiary hover:border-accent-cyan/40'
                                    }`}
                                  >
                                    {v}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {checked && candidateKind === 'pose' && (
                            <div className="ml-5 mt-1 space-y-1 rounded border border-border/70 p-1.5">
                              <div className="text-[9px] text-text-tertiary">pose style</div>
                              <div className="flex gap-1">
                                {(['arrow', 'robot'] as PoseDisplayStyle[]).map((v) => (
                                  <button
                                    key={v}
                                    type="button"
                                    aria-pressed={(style.poseDisplayStyle ?? 'arrow') === v}
                                    onClick={() =>
                                      onSetSpatialOverlayStyle(candidate.bagId, candidate.name, {
                                        poseDisplayStyle: v,
                                      })
                                    }
                                    className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                                      (style.poseDisplayStyle ?? 'arrow') === v
                                        ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/40'
                                        : 'border border-border text-text-tertiary hover:border-accent-cyan/40'
                                    }`}
                                  >
                                    {v}
                                  </button>
                                ))}
                              </div>
                              <label className="flex items-center gap-1.5 text-[9px] text-text-tertiary cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={style.poseFlattenOrientation ?? false}
                                  onChange={(event) =>
                                    onSetSpatialOverlayStyle(candidate.bagId, candidate.name, {
                                      poseFlattenOrientation: event.target.checked,
                                    })
                                  }
                                  className="accent-accent-cyan"
                                />
                                flatten (ignore roll/pitch)
                              </label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  aria-label={colorLabel}
                                  value={style.color ?? overlayBagMeta.get(candidate.bagId)?.color ?? '#22d3ee'}
                                  onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center' })}
                                  onChange={(event) =>
                                    onSetSpatialOverlayStyle(candidate.bagId, candidate.name, {
                                      color: event.target.value,
                                    })
                                  }
                                  className="h-5 w-7 cursor-pointer rounded border border-border bg-transparent"
                                />
                                <button
                                  type="button"
                                  aria-label={'Use the bag color for ' + candidate.name}
                                  aria-pressed={style.color == null}
                                  onClick={() =>
                                    onSetSpatialOverlayStyle(candidate.bagId, candidate.name, { color: null })
                                  }
                                  className={
                                    style.color == null
                                      ? 'rounded border border-accent-cyan/40 px-1.5 text-accent-cyan'
                                      : 'rounded border border-border px-1.5 text-text-tertiary hover:border-accent-cyan/40'
                                  }
                                >
                                  auto
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-text-tertiary text-[10px] leading-tight mt-1">
                    Layers use TF to align with the selected world frame.
                  </div>
                </div>
              )}
              {sceneKind === 'markerarray' && markerNamespaces.length > 0 && (
                <div>
                  <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                    <span>namespaces ({markerNamespaces.length})</span>
                    {hiddenSet.size > 0 && (
                      <button
                        onClick={onShowAllNamespaces}
                        className="text-text-tertiary hover:text-accent-blue underline decoration-dotted"
                        title="Show every namespace again"
                      >
                        show all
                      </button>
                    )}
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-0.5 pr-1">
                    {markerNamespaces.map((ns) => {
                      const hidden = hiddenSet.has(ns);
                      // Empty-string namespace shown as `<default>` so the row
                      // doesn't render as an unclickable blank.
                      const label = ns || '<default>';
                      return (
                        <label
                          key={ns}
                          className={`flex items-center gap-1.5 cursor-pointer ${
                            hidden ? 'text-text-tertiary' : 'text-text-secondary'
                          }`}
                          title={ns || 'unnamed namespace'}
                        >
                          <input
                            type="checkbox"
                            checked={!hidden}
                            onChange={(e) => onToggleNamespace(ns, !e.target.checked)}
                            className="accent-accent-blue flex-shrink-0"
                          />
                          <span className="truncate">{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {hasRobotModel && (
                <div>
                  <label
                    className="flex items-center gap-1.5 text-text-secondary cursor-pointer"
                    title={
                      robotName
                        ? `Robot model: ${robotName}${
                            robotHasJointStates ? ' (animating from /joint_states)' : ''
                          }`
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={!robotHidden}
                      onChange={(e) => setRobotHidden(!e.target.checked)}
                      className="accent-accent-blue"
                    />
                    robot model
                  </label>
                  {!robotHasJointStates && (
                    <div className="text-text-tertiary text-[10px] mt-0.5">
                      no /joint_states - joints stay at rest
                    </div>
                  )}
                  {robotWarnings.length > 0 && (
                    <div
                      className="text-accent-amber/80 text-[10px] leading-tight mt-0.5"
                      title={robotWarnings.map((w) => w.message).join('\n')}
                    >
                      {robotWarnings.length} model warning
                      {robotWarnings.length === 1 ? '' : 's'} (hover for details)
                    </div>
                  )}
                </div>
              )}
              {cameraFrustumCount > 0 && (
                <div>
                  <label
                    className="flex items-center gap-1.5 text-text-secondary cursor-pointer"
                    title="Render a wireframe pyramid in each camera's optical frame, sized by its CameraInfo intrinsics"
                  >
                    <input
                      type="checkbox"
                      checked={cameraFrustumsOn}
                      onChange={(e) => setCameraFrustumsOn(e.target.checked)}
                      className="accent-accent-cyan"
                    />
                    camera frustums{' '}
                    <span className="text-text-tertiary">({cameraFrustumCount})</span>
                  </label>
                  {cameraFrustumsOn && (
                    <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                      <span className="text-text-tertiary w-12 flex-shrink-0">far</span>
                      <input
                        type="range"
                        min={0.5}
                        max={50}
                        step={0.5}
                        value={cameraFrustumFar}
                        onChange={(e) => setCameraFrustumFar(Number(e.target.value))}
                        className="flex-1 accent-accent-cyan"
                        aria-label="Camera frustum far plane distance"
                      />
                      <span className="text-text-secondary mono w-10 text-right">
                        {cameraFrustumFar.toFixed(1)}m
                      </span>
                    </div>
                  )}
                  {cameraFrustumsOn && cameraInfoTopics.length > 1 && (
                    <div className="mt-1.5 space-y-0.5">
                      <div className="text-text-tertiary text-[10px] mb-0.5">cameras</div>
                      {cameraInfoTopics.map((topic) => {
                        const hidden = hiddenFrustumTopics.includes(topic);
                        const shortName = topic.split('/').filter(Boolean).slice(-2).join('/') || topic;
                        return (
                          <label
                            key={topic}
                            className={`flex items-center gap-1.5 cursor-pointer text-[10px] ${
                              hidden ? 'text-text-tertiary' : 'text-text-secondary'
                            }`}
                            title={topic}
                          >
                            <input
                              type="checkbox"
                              checked={!hidden}
                              onChange={(e) => onToggleFrustumTopic(topic, !e.target.checked)}
                              className="accent-accent-cyan flex-shrink-0"
                            />
                            <span className="truncate">{shortName}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </DisclosureSection>
          )}
        </div>
        {/* Pinned footer - stays put regardless of section scroll/expand state. */}
        <div className="p-2.5 pt-1.5 border-t border-border/60 space-y-1">
          <div className="flex items-center justify-between text-text-tertiary text-[10px]">
            <span>defaults ({sceneKindLabel})</span>
            {hasSavedDefault && (
              <button
                onClick={onClearSavedDefault}
                className="text-text-tertiary hover:text-accent-rose underline decoration-dotted"
                title={`Forget the saved default for ${sceneKindLabel}. Future panels fall back to built-in defaults.`}
              >
                clear saved
              </button>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={onSaveAsDefault}
              className="flex-1 px-2 py-0.5 rounded-md transition-colors border border-border text-text-secondary hover:border-accent-blue/40 hover:text-accent-blue"
              title={`Persist this panel's current settings as the default for every new ${sceneKindLabel} panel (stored in your browser).`}
            >
              save as default
            </button>
            <button
              onClick={onResetToDefault}
              className="flex-1 px-2 py-0.5 rounded-md transition-colors border border-border text-text-secondary hover:border-accent-blue/40 hover:text-accent-blue"
              title={
                hasSavedDefault
                  ? `Apply the saved ${sceneKindLabel} default to this panel. This also clears overlay selections and any hidden namespace / camera filters.`
                  : `Reset this panel to the built-in ${sceneKindLabel} defaults. This also clears overlay selections and any hidden namespace / camera filters.`
              }
            >
              reset
            </button>
          </div>
          {hasSavedDefault && (
            <div className="text-text-tertiary text-[10px] leading-tight">
              saved default in effect for new panels
            </div>
          )}
        </div>
        </div>
      )}
    </OverlayCard>
  );
}

/**
 * DisclosureSection - collapsed-by-default group inside the Display card.
 * Native <details>/<summary> so no extra state or animation code is
 * needed; open state lives in the panel's settings store (via `open`/
 * `onToggle`) so it survives remounts and can travel through "save as
 * default" like every other display setting.
 */
function DisclosureSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
      className="group pt-1 border-t border-border/60"
    >
      <summary className="flex items-center gap-1.5 text-text-tertiary hover:text-text-secondary text-[10px] uppercase tracking-wide cursor-pointer select-none py-0.5 list-none [&::-webkit-details-marker]:hidden">
        <svg
          className="w-2.5 h-2.5 flex-shrink-0 transition-transform group-open:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {label}
      </summary>
      <div className="pt-1.5 space-y-2">{children}</div>
    </details>
  );
}

function ClipBoundInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  /** Accessible name; the placeholder alone ("min"/"max") is ambiguous across axes. */
  label: string;
}) {
  return (
    <input
      type="number"
      step="any"
      placeholder={placeholder}
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        onChange(Number.isFinite(v) ? v : null);
      }}
      className="w-full min-w-0 px-1.5 py-0.5 rounded bg-surface border border-border text-text-primary text-[10px] mono placeholder:text-text-muted focus:outline-none focus:border-accent-blue/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  );
}

/**
 * Set the user-group's matrix to `postMul * TFChain(source → world)` at
 * `timeNs`. The cache stores the bare TF chain so the post-multiplier (the
 * panel's up-axis fix) can change cheaply without invalidating the chain
 * lookup.
 *
 * If `postMul` is omitted the result is just the TF chain - preserves the
 * pre-up-axis behaviour for callers that don't need it.
 */
/**
 * Field-by-field equality check for two CameraIntrinsics snapshots.
 *
 * Used to coalesce identical playhead updates so the camera-frustum
 * lifecycle effect doesn't re-trigger on every tick when the publisher
 * is sending the same CameraInfo at 30 Hz (the common case).
 */
