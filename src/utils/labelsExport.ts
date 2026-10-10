import { useBagStore, bagLocalTimeFor, resolveBagEntry } from '../store/bagStore';
import { useAnnotationStore } from '../store/annotationStore';
import { buildLabelRows, labelsFileName, labelsToCsv, labelsToJson } from './labels';
import { downloadBytes } from './clipEncoder';

/** Export the labels of the focused bag in `format`, with times on the bag's own clock. */
export function exportLabels(format: 'json' | 'csv'): void {
  const bags = useBagStore.getState();
  const entry = resolveBagEntry(bags, bags.focusBagId);
  if (!entry) return;
  const rows = buildLabelRows(useAnnotationStore.getState().annotations, entry.summary.fileName, (ns) =>
    bagLocalTimeFor(entry, ns, bags.alignment),
  );
  const text = format === 'json' ? labelsToJson(rows) : labelsToCsv(rows);
  downloadBytes(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv' }), labelsFileName(entry.summary.fileName, format));
}
