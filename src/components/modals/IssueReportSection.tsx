import { useState } from 'react';
import { useBagStore, resolveBagEntry } from '../../store/bagStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { useTimelineViewStore } from '../../store/timelineViewStore';
import { editBag, getResolvableTopicsDb3 } from '../../parsers';
import { sourceDisplayName } from '../../parsers/source';
import { getParserClient } from '../../workers/parserClient';
import { computeAllTopicHealth } from '../../utils/topicStats';
import { buildReportZip, healthMarkdown, reportReadme, reportWindow, REPORT_HALF_WINDOW_SEC } from '../../utils/issueReport';
import { downloadBytes } from '../../utils/clipEncoder';
import { formatFileSize } from '../../utils/bytes';
import { isFullView } from '../../utils/timelineView';
import { APP_VERSION } from '../../utils/version';

type Status = { kind: 'idle' } | { kind: 'working'; step: string } | { kind: 'done'; bytes: number; note?: string } | { kind: 'error'; message: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Share modal section: one zip with a clip, the link and a Health summary, to attach to a ticket. */
export function IssueReportSection({ link, linkCarriesBag }: { link: string; linkCarriesBag: boolean }) {
  const entry = useBagStore((s) => resolveBagEntry(s, null));
  const zoomed = useTimelineViewStore((s) => !isFullView(s.view));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  if (!entry || entry.kind === 'live' || !entry.source) return null;
  const { id, source, summary } = entry;

  const onMake = async () => {
    const errors: string[] = [];
    try {
      const win = reportWindow(summary.startTime, summary.endTime, useTimelineViewStore.getState().view, usePlayheadStore.getState().timeNs);
      setStatus({ kind: 'working', step: 'Trimming the clip...' });
      let clip: Awaited<ReturnType<typeof editBag>> | null = null;
      try {
        // .db3 topics without a known schema are written schema-less rather than dropped.
        const unresolved = summary.format === 'db3'
          ? (await getResolvableTopicsDb3(id, source)).filter((t) => !t.resolvable).map((t) => t.topic)
          : undefined;
        clip = await editBag(id, source, summary.format, win.startNs, win.endNs, null, unresolved);
      } catch (e) {
        errors.push(`Clip: ${errText(e)}`);
      }
      setStatus({ kind: 'working', step: 'Measuring topic health...' });
      let health = '';
      try {
        health = healthMarkdown(computeAllTopicHealth(await getParserClient(id).readAllMessageStats(source, summary.format)));
      } catch (e) {
        errors.push(`Health: ${errText(e)}`);
        health = 'Health could not be computed; see errors.txt.\n';
      }
      const readme = reportReadme({
        appVersion: APP_VERSION,
        bagName: sourceDisplayName(source),
        format: summary.format,
        bagStartNs: summary.startTime,
        clip: clip ? { startNs: win.startNs, endNs: win.endNs, messageCount: clip.messageCount } : null,
        playheadNs: usePlayheadStore.getState().timeNs,
        link,
        linkCarriesBag,
        createdAt: new Date(),
      }, health);
      const zip = buildReportZip({ clip: clip?.bytes, link, health, readme, errors: errors.join('\n') || undefined });
      const stem = sourceDisplayName(source).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'bag';
      downloadBytes(zip, `${stem}__issue-report.zip`);
      setStatus({ kind: 'done', bytes: zip.byteLength, note: errors.length ? 'Some parts failed; errors.txt in the zip says which.' : undefined });
    } catch (e) {
      setStatus({ kind: 'error', message: errText(e) });
    }
  };

  return (
    <div className="rounded-lg border border-border p-3 text-xs">
      <div className="font-medium text-text-primary text-sm">Issue report</div>
      <p className="mt-1 text-text-secondary leading-relaxed">
        One zip to attach to a ticket: a clip of the bag ({zoomed ? 'the zoomed timeline window' : `${REPORT_HALF_WINDOW_SEC * 2} s around the playhead; zoom the timeline to pick another window`}),
        the link above, and a Health summary of every topic.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void onMake()}
          disabled={status.kind === 'working'}
          className="px-3 py-1.5 rounded-md text-xs bg-accent-blue/15 text-accent-blue border border-accent-blue/40 hover:bg-accent-blue/25 disabled:opacity-60 transition-colors"
        >
          {status.kind === 'working' ? status.step : 'Download issue report'}
        </button>
        {status.kind === 'done' && (
          <span className="text-text-muted" role="status">
            Saved ({formatFileSize(status.bytes)}).{status.note ? ` ${status.note}` : ''}
          </span>
        )}
        {status.kind === 'error' && <span className="text-accent-rose" role="alert">{status.message}</span>}
      </div>
    </div>
  );
}
