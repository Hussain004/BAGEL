import { useEffect, useMemo, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';
import { useUiStore } from '../../store/uiStore';
import { useBagStore, bagLocalTimeFor, resolveBagEntry } from '../../store/bagStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { readMessageAtTime, readMessagesInRange } from '../../parsers';
import { isImageType, isPointCloud2Type, isVideoType } from '../../utils/messages';
import { decodePointCloud2, type PointCloud2Message } from '../../utils/pointcloud';
import { downloadBytes } from '../../utils/clipEncoder';
import { ExportAborted, runFrameExport, type FrameExportProgress, type FrameExportResult } from '../../utils/frameExportRun';

const MAX_FRAMES_DEFAULT = 1000;

type Phase = { kind: 'idle' } | { kind: 'running'; progress: FrameExportProgress } | { kind: 'done'; result: FrameExportResult } | { kind: 'error'; message: string };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 1024 * 1024 * 100 ? 0 : 1)} MB`;

/**
 * Export the frames of an image topic over a range (the whole bag, or one
 * labelled range) as files in a zip, with a CSV of their times and labels, and
 * optionally the nearest point cloud for each as a PCD. The bag's own message
 * data, untouched where it can be: JPEG and PNG pass through byte for byte.
 */
export function FrameExportModal() {
  const close = () => useUiStore.getState().setModal(null);
  const presetLabelId = useUiStore((s) => s.frameExportLabelId);
  const bags = useBagStore();
  const entry = resolveBagEntry(bags, bags.focusBagId);
  const annotations = useAnnotationStore((s) => s.annotations);

  const imageTopics = useMemo(() => (entry?.summary.topics ?? []).filter((t) => isImageType(t.type) && !isVideoType(t.type, t.name) && !t.type.includes('Video')), [entry]);
  const cloudTopics = useMemo(() => (entry?.summary.topics ?? []).filter((t) => isPointCloud2Type(t.type)), [entry]);
  const ranges = useMemo(() => annotations.filter((a) => a.endNs !== undefined), [annotations]);

  const [imageTopic, setImageTopic] = useState(imageTopics[0]?.name ?? '');
  const [cloudTopic, setCloudTopic] = useState('');
  const [rangeId, setRangeId] = useState<string>(presetLabelId && ranges.some((r) => r.id === presetLabelId) ? presetLabelId : '');
  const [stride, setStride] = useState(1);
  const [maxFrames, setMaxFrames] = useState(MAX_FRAMES_DEFAULT);
  const [gapMs, setGapMs] = useState(500);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  if (!entry || !entry.source || entry.kind === 'live') {
    return (
      <ModalShell title="Export frames" onClose={close} width="md">
        <p className="p-6 text-sm text-text-secondary">Frame export needs a recorded bag. A live connection has no fixed range to export.</p>
      </ModalShell>
    );
  }
  const { source } = entry;
  const summary = entry.summary;

  const toBag = (aligned: bigint) => bagLocalTimeFor(entry, aligned, bags.alignment);
  const selected = ranges.find((r) => r.id === rangeId) ?? null;
  const startNs = selected ? toBag(selected.timeNs) : summary.startTime;
  const endNs = selected ? toBag(selected.endNs!) : summary.endTime;
  const seconds = Number(endNs - startNs) / 1e9;
  const topicInfo = imageTopics.find((t) => t.name === imageTopic);
  const estimate = topicInfo?.frequency ? Math.max(1, Math.round((seconds * topicInfo.frequency) / Math.max(1, stride))) : null;
  const shown = estimate === null ? null : Math.min(estimate, maxFrames);

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: 'running', progress: { frames: 0, clouds: 0, bytes: 0 } });
    try {
      const result = await runFrameExport(
        {
          imageTopic,
          cloudTopic: cloudTopic || null,
          startNs,
          endNs,
          stride: Math.max(1, Math.floor(stride)),
          maxFrames: Math.max(1, Math.floor(maxFrames)),
          maxCloudGapNs: BigInt(Math.max(0, Math.round(gapMs))) * 1_000_000n,
          labels: annotations
            .filter((a) => a.endNs !== undefined)
            .map((a) => ({ label: a.label, startNs: toBag(a.timeNs), endNs: toBag(a.endNs!) })),
        },
        {
          readRange: (topic, params) => readMessagesInRange(entry.id, source, summary.format, topic, params),
          readAt: (topic, t) => readMessageAtTime(entry.id, source, summary.format, topic, t),
          decodeCloud: (value) => {
            // Every point, not the 250k the 3D view samples to.
            const out = decodePointCloud2(value as unknown as PointCloud2Message, { colorMode: 'height', maxPoints: 20_000_000 });
            return out ? { positions: out.positions, intensity: out.intensity, ring: out.ring } : null;
          },
        },
        (progress) => setPhase({ kind: 'running', progress }),
        controller.signal,
      );
      const stem = summary.fileName.replace(/\.[^./\\]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'bag';
      if (result.frames > 0) downloadBytes(result.blob, `${stem}-frames.zip`);
      setPhase({ kind: 'done', result });
    } catch (e) {
      setPhase(e instanceof ExportAborted ? { kind: 'idle' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const running = phase.kind === 'running';
  return (
    <ModalShell title="Export frames" subtitle="Images over a range, as files with a CSV of their times" onClose={close} width="lg">
      <div className="p-5 flex flex-col gap-4 text-sm">
        {imageTopics.length === 0 ? (
          <p className="text-text-secondary">This bag has no image topics that can be exported as files (raw or compressed images; video streams are not included).</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                Image topic
                <select value={imageTopic} onChange={(e) => setImageTopic(e.target.value)} disabled={running} className="bg-bg-primary border border-border rounded-md px-2 py-1.5 text-sm text-text-primary">
                  {imageTopics.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                Range
                <select value={rangeId} onChange={(e) => setRangeId(e.target.value)} disabled={running} className="bg-bg-primary border border-border rounded-md px-2 py-1.5 text-sm text-text-primary">
                  <option value="">Whole bag ({(Number(summary.endTime - summary.startTime) / 1e9).toFixed(1)} s)</option>
                  {ranges.map((r) => (
                    <option key={r.id} value={r.id}>{r.label} ({(Number(r.endNs! - r.timeNs) / 1e9).toFixed(1)} s)</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                Every Nth frame
                <input type="number" min={1} value={stride} onChange={(e) => setStride(Number(e.target.value))} disabled={running} className="bg-bg-primary border border-border rounded-md px-2 py-1.5 text-sm text-text-primary" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                At most (frames)
                <input type="number" min={1} value={maxFrames} onChange={(e) => setMaxFrames(Number(e.target.value))} disabled={running} className="bg-bg-primary border border-border rounded-md px-2 py-1.5 text-sm text-text-primary" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                Also the nearest point cloud (PCD)
                <select value={cloudTopic} onChange={(e) => setCloudTopic(e.target.value)} disabled={running || cloudTopics.length === 0} className="bg-bg-primary border border-border rounded-md px-2 py-1.5 text-sm text-text-primary">
                  <option value="">{cloudTopics.length === 0 ? 'No point cloud topics' : 'No'}</option>
                  {cloudTopics.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </label>
              {cloudTopic && (
                <label className="flex flex-col gap-1 text-xs text-text-tertiary">
                  Pair only within (ms)
                  <input type="number" min={0} value={gapMs} onChange={(e) => setGapMs(Number(e.target.value))} disabled={running} className="bg-bg-primary border border-border rounded-md px-2 py-1.5 text-sm text-text-primary" />
                </label>
              )}
            </div>

            <p className="text-xs text-text-tertiary" data-testid="frame-estimate">
              {shown === null ? 'Frame count depends on the topic rate.' : `About ${shown.toLocaleString()} frame${shown === 1 ? '' : 's'}`} over {seconds.toFixed(1)} s. JPEG and PNG frames are written exactly as recorded; raw images become PNG without losing pixel values. Times are on the bag's own clock.
            </p>

            {phase.kind === 'running' && (
              <p role="status" className="text-xs text-accent-blue" data-testid="frame-progress">
                Exporting... {phase.progress.frames.toLocaleString()} frames{phase.progress.clouds > 0 ? `, ${phase.progress.clouds.toLocaleString()} clouds` : ''} ({mb(phase.progress.bytes)})
              </p>
            )}
            {phase.kind === 'error' && <p role="alert" className="text-xs text-accent-rose">{phase.message}</p>}
            {phase.kind === 'done' && (
              <div role="status" className="text-xs text-text-secondary space-y-1" data-testid="frame-done">
                <p className={phase.result.frames > 0 ? 'text-accent-emerald' : 'text-accent-amber'}>
                  {phase.result.frames > 0
                    ? `Done: ${phase.result.frames.toLocaleString()} frames${phase.result.clouds > 0 ? ` and ${phase.result.clouds.toLocaleString()} clouds` : ''} (${mb(phase.result.bytes)}) saved as a zip.`
                    : 'Nothing was exported.'}
                </p>
                {phase.result.truncated === 'frames' && <p>Stopped at the frame limit; the range has more. Raise "At most" or use a larger stride to cover it all.</p>}
                {phase.result.truncated === 'size' && <p>Stopped at about 2 GB, the most a browser can hold. Use a larger stride or a shorter range.</p>}
                {phase.result.skipped.map((s) => (
                  <p key={s.reason}>Left out {s.count.toLocaleString()}: {s.reason}.</p>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              {running ? (
                <button type="button" onClick={() => abortRef.current?.abort()} className="px-3 py-1.5 rounded-md text-xs border border-border text-text-secondary hover:border-accent-rose/40">Cancel</button>
              ) : (
                <button type="button" onClick={() => void start()} disabled={!imageTopic} className="px-3 py-1.5 rounded-md text-xs bg-accent-blue/20 border border-accent-blue/40 text-text-primary hover:bg-accent-blue/30 disabled:opacity-50">
                  Export zip
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
