/**
 * Decide which dropped or picked files belong to one split recording.
 *
 * Pure and DOM-free. The hard part is not matching names, it is NOT merging
 * files that merely look alike: `run_1.mcap` and `run_2.mcap` are far more
 * likely two separate runs than two halves of one, so the name heuristic only
 * fires for a numbering that starts at 0, which is what both
 * `ros2 bag record` and `rosbag record --split` produce. A `metadata.yaml`
 * from rosbag2 is authoritative when present, because it lists the parts.
 */

export const SPLITTABLE_EXTENSIONS = ['mcap', 'db3', 'bag'] as const;
export const INGEST_EXTENSIONS = [...SPLITTABLE_EXTENSIONS, 'pcd', 'ply', 'splat', 'ksplat', 'spz'] as const;

export interface NamedFile {
  name: string;
  /** Containing folder, '' for loose files. Parts only group within one folder. */
  dir?: string;
}

export interface FileGroup<T extends NamedFile> {
  files: T[];
  /** What to show for the recording: the file name, or `stem (3 parts)`. */
  displayName: string;
  /** 1-based part numbers that the numbering says should exist but are absent. */
  missing: number[];
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function baseOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash < 0 ? path : path.slice(slash + 1);
}

/** `name_12.mcap` -> { stem: 'name', index: 12 }, or null. */
function splitIndex(name: string): { stem: string; index: number } | null {
  const noExt = name.slice(0, name.lastIndexOf('.'));
  const m = /^(.*)_(\d+)$/.exec(noExt);
  if (!m || !m[1]) return null;
  return { stem: m[1], index: Number(m[2]) };
}

/**
 * Pull `relative_file_paths` out of a rosbag2 `metadata.yaml`.
 *
 * Only that one list is needed, so this reads it directly rather than pulling
 * in a YAML dependency. Handles quoted and unquoted items and ignores
 * everything else in the file.
 */
export function parseRosbag2Metadata(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let keyIndent = 0;
  for (const line of lines) {
    if (!inList) {
      const m = /^(\s*)relative_file_paths\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      keyIndent = m[1]!.length;
      const rest = m[2]!.trim();
      if (rest.startsWith('[')) {
        // Flow style: relative_file_paths: [a.mcap, b.mcap]
        for (const item of rest.replace(/^\[|\]$/g, '').split(',')) {
          const v = item.trim().replace(/^["']|["']$/g, '');
          if (v) out.push(baseOf(v));
        }
        return out;
      }
      inList = true;
      continue;
    }
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const item = /^\s*-\s*(.*)$/.exec(line);
    // A list item may sit at the key's own indent (valid YAML); anything else
    // at or left of the key ends the list.
    if (!item || (indent < keyIndent) || (indent === keyIndent && !line.trimStart().startsWith('-'))) break;
    const v = item[1]!.trim().replace(/^["']|["']$/g, '');
    if (v) out.push(baseOf(v));
  }
  return out;
}

function partsLabel(stem: string, found: number, expected: number): string {
  return found === expected
    ? `${stem} (${found} parts)`
    : `${stem} (${found} of ${expected} parts)`;
}

/**
 * Partition `files` into recordings, preserving the order in which each
 * recording first appears. Unsupported files (the `metadata.yaml` itself,
 * `.sqlite3-wal`, anything else) are dropped.
 */
export function groupBagFiles<T extends NamedFile>(
  files: T[],
  metadataText?: string,
): Array<FileGroup<T>> {
  const supported = files.filter((f) => (INGEST_EXTENSIONS as readonly string[]).includes(extOf(f.name)));
  const claimed = new Set<T>();
  const groups: Array<{ order: number; group: FileGroup<T> }> = [];
  const orderOf = (f: T) => files.indexOf(f);

  // 1. metadata.yaml is authoritative: it names the parts.
  const listed = metadataText ? parseRosbag2Metadata(metadataText) : [];
  if (listed.length > 1) {
    const listedSet = new Set(listed);
    const matched = supported.filter(
      (f) => (SPLITTABLE_EXTENSIONS as readonly string[]).includes(extOf(f.name)) && listedSet.has(f.name),
    );
    if (matched.length > 1) {
      matched.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const f of matched) claimed.add(f);
      const idx = splitIndex(matched[0]!.name);
      const stem = idx?.stem ?? matched[0]!.name.replace(/\.[^.]+$/, '');
      groups.push({
        order: Math.min(...matched.map(orderOf)),
        group: { files: matched, displayName: partsLabel(stem, matched.length, listed.length), missing: [] },
      });
    }
  }

  // 2. Name heuristic: same folder, extension and stem, numbered from 0.
  const buckets = new Map<string, Array<{ file: T; index: number }>>();
  for (const f of supported) {
    if (claimed.has(f)) continue;
    const ext = extOf(f.name);
    if (!(SPLITTABLE_EXTENSIONS as readonly string[]).includes(ext)) continue;
    const idx = splitIndex(f.name);
    if (!idx) continue;
    const key = `${f.dir ?? ''}\u0000${ext}\u0000${idx.stem}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push({ file: f, index: idx.index });
  }
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.index - b.index);
    if (members[0]!.index !== 0) continue;
    // Duplicate indices (run_0 twice, from two sources) cannot be one recording.
    if (new Set(members.map((m) => m.index)).size !== members.length) continue;
    const have = new Set(members.map((m) => m.index));
    const last = members[members.length - 1]!.index;
    const missing: number[] = [];
    for (let i = 0; i <= last; i++) if (!have.has(i)) missing.push(i + 1);
    const stem = key.split('\u0000')[2]!;
    for (const m of members) claimed.add(m.file);
    groups.push({
      order: Math.min(...members.map((m) => orderOf(m.file))),
      group: {
        files: members.map((m) => m.file),
        displayName: partsLabel(stem, members.length, last + 1),
        missing,
      },
    });
  }

  // 3. Everything left stands alone.
  for (const f of supported) {
    if (claimed.has(f)) continue;
    groups.push({ order: orderOf(f), group: { files: [f], displayName: f.name, missing: [] } });
  }

  groups.sort((a, b) => a.order - b.order);
  return groups.map((g) => g.group);
}
