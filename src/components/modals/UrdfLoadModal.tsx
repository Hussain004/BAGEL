import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';
import { useUiStore } from '../../store/uiStore';
import { useRobotModelStore } from '../../store/robotModelStore';
import {
  parseUrdf,
  extractPackageNames,
  type UrdfModel,
  type UrdfWarning,
} from '../../parsers/urdf';
import {
  hasPackageBinding,
  setFileBinding,
  setUrlBinding,
  subscribePackageResolver,
  listPackageMappings,
} from '../../parsers/packageResolver';

/**
 * UrdfLoadModal - v1.3.0
 *
 * Drop a `.urdf` file. We parse it, walk every `package://` reference, and
 * for each unbound package show a row asking the user to either drop the
 * package folder (a `webkitdirectory` input that captures the whole tree)
 * or paste a URL prefix the meshes can be fetched from.
 *
 * Once every referenced package has a binding (or the URDF has no mesh
 * references at all), "Load robot" commits the model into
 * `useRobotModelStore`, every open 3D panel picks it up via the store
 * subscription, and the modal closes.
 *
 * A "Try a sample robot" button on the empty state fetches the bundled
 * `public/sample-bags/sample-robot.urdf` so users without their own URDF
 * can preview the feature against the same bag tour we ship.
 */
export function UrdfLoadModal() {
  const close = () => useUiStore.getState().setModal(null);

  // ─── State machine: idle → parsed → ready (or error/sample-loading) ────
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{
    model: UrdfModel;
    text: string;
    sourceName: string;
    warnings: UrdfWarning[];
  } | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  // Re-render whenever the resolver bindings change (drop folder / paste URL),
  // so the "missing packages" list updates without us having to thread state
  // through the resolver layer.
  const [bindingTick, setBindingTick] = useState(0);
  useEffect(() => subscribePackageResolver(() => setBindingTick((n) => n + 1)), []);
  // Compute the unresolved package set whenever bindings or the parsed
  // model change. `bindingTick` is the trigger.
  const unresolvedPackages = useMemo(() => {
    if (!parsed) return [];
    return extractPackageNames(parsed.model).filter((p) => !hasPackageBinding(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, bindingTick]);

  const inputRef = useRef<HTMLInputElement>(null);
  const onPickFile = () => inputRef.current?.click();

  const ingestUrdfText = useCallback((text: string, sourceName: string) => {
    setParseError(null);
    try {
      const { model, warnings } = parseUrdf(text);
      setParsed({ model, text, sourceName, warnings });
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      setParsed(null);
    }
  }, []);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const text = await file.text();
    ingestUrdfText(text, file.name);
  };

  // Drag-drop on the modal body. We accept .urdf / .xacro / any text file -
  // xacro detection inside `parseUrdf` will surface a clear error if needed.
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const text = await file.text();
    ingestUrdfText(text, file.name);
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();

  const onTrySample = async () => {
    setSampleLoading(true);
    setParseError(null);
    try {
      const res = await fetch(import.meta.env.BASE_URL + 'sample-bags/sample-robot.urdf');
      if (!res.ok) throw new Error(`Failed to fetch sample URDF (${res.status}).`);
      const text = await res.text();
      ingestUrdfText(text, 'sample-robot.urdf');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setSampleLoading(false);
    }
  };

  const onCommit = () => {
    if (!parsed) return;
    const setLoaded = useRobotModelStore.getState().setLoaded;
    setLoaded({
      model: parsed.model,
      sourceName: parsed.sourceName,
      sourceText: parsed.text,
      anchorLink: parsed.model.rootLinks[0] ?? '',
      warnings: parsed.warnings,
    });
    close();
  };

  const onClear = () => {
    setParsed(null);
    setParseError(null);
  };

  const mappings = listPackageMappings();
  const canCommit = parsed && unresolvedPackages.length === 0;

  return (
    <ModalShell
      title="Load robot model (URDF)"
      subtitle={
        parsed
          ? `${parsed.sourceName} - ${parsed.model.links.size} links, ${parsed.model.joints.size} joints`
          : 'Drop a .urdf to render a robot in every 3D panel'
      }
      onClose={close}
      width="lg"
    >
      <div
        className="px-6 py-4 space-y-5 text-sm"
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        {!parsed && (
          <section>
            <p className="text-text-secondary leading-relaxed">
              BAGEL renders the URDF in the world frame, anchored to its root
              link via your bag's <code className="mono text-text-primary">/tf</code> stream.
              Joint states from{' '}
              <code className="mono text-text-primary">/joint_states</code> animate
              revolute and prismatic joints automatically. Drop the file or pick one below.
            </p>
            <div className="mt-4 flex flex-col items-center justify-center gap-3 border border-dashed border-border rounded-md p-8 text-center">
              <UrdfIcon />
              <p className="text-text-tertiary text-xs">
                Drag a <code className="mono text-text-primary">.urdf</code> file here
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={onPickFile}
                  className="px-3 py-1.5 rounded-md text-sm bg-accent-blue/15 text-accent-blue border border-accent-blue/40 hover:bg-accent-blue/25 transition-colors"
                >
                  Browse...
                </button>
                <button
                  onClick={onTrySample}
                  disabled={sampleLoading}
                  className="px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border transition-colors disabled:opacity-60"
                >
                  {sampleLoading ? 'Loading sample…' : 'Try a sample robot'}
                </button>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".urdf,.xml,.xacro"
                className="hidden"
                onChange={onFileChange}
              />
            </div>
            {mappings.length > 0 && (
              <details className="mt-4 text-xs text-text-tertiary">
                <summary className="cursor-pointer hover:text-text-secondary select-none">
                  {mappings.length} package binding{mappings.length === 1 ? '' : 's'} from a previous session
                </summary>
                <ul className="mt-2 space-y-1 mono">
                  {mappings.map((m) => (
                    <li key={m.name} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="text-text-primary">{m.name}</span>
                        {m.binding ? (
                          <span className="text-text-tertiary ml-2">
                            ({m.binding.kind})
                          </span>
                        ) : (
                          <span className="text-accent-amber ml-2">(re-prompt on next URDF)</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        {parseError && (
          <div className="px-3 py-2 rounded-md border border-accent-rose/30 bg-accent-rose/10 text-accent-rose text-xs mono whitespace-pre-wrap break-words">
            {parseError}
          </div>
        )}

        {parsed && (
          <>
            <section className="rounded-md border border-accent-emerald/30 bg-accent-emerald/5 px-3 py-2 text-xs text-accent-emerald">
              Parsed <span className="mono">{parsed.model.name}</span> with{' '}
              {parsed.model.links.size} links, {parsed.model.joints.size} joints,{' '}
              {parsed.model.meshUris.length} mesh references.
            </section>

            {parsed.warnings.length > 0 && (
              <section>
                <SectionHeader title={`Parser warnings (${parsed.warnings.length})`} />
                <ul className="mt-2 max-h-32 overflow-y-auto rounded-md border border-border bg-bg-primary/40 divide-y divide-border/60 text-xs">
                  {parsed.warnings.map((w, i) => (
                    <li key={i} className="px-3 py-1.5">
                      <span className="text-text-tertiary mono mr-2">[{w.kind}]</span>
                      <span className="text-text-secondary">{w.message}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {unresolvedPackages.length > 0 && (
              <section>
                <SectionHeader
                  title={`Mesh packages (${unresolvedPackages.length} missing)`}
                  hint="Provide a folder or URL prefix per referenced package."
                />
                <ul className="mt-2 space-y-3">
                  {unresolvedPackages.map((pkg) => (
                    <PackageRow key={pkg} packageName={pkg} />
                  ))}
                </ul>
                <p className="mt-3 text-[10px] text-text-tertiary leading-snug">
                  No auto-fetch from ROS distros: BAGEL only loads meshes from
                  where you point it. Bindings persist across sessions
                  (URL prefixes survive a reload; dropped folders re-prompt).
                </p>
              </section>
            )}

            {parsed.model.meshUris.length === 0 && (
              <section className="text-xs text-text-tertiary">
                This URDF has no <code className="mono">package://</code> mesh
                references, so it renders entirely from URDF primitives -
                no extra mapping needed.
              </section>
            )}

            <section>
              <SectionHeader title="Anchor link" hint="World-frame anchor for the robot base." />
              <AnchorLinkPicker model={parsed.model} />
            </section>
          </>
        )}
      </div>
      <footer className="px-6 py-3 border-t border-border bg-surface/40 flex items-center justify-end gap-2 flex-shrink-0">
        {parsed && (
          <button
            onClick={onClear}
            className="px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            Pick another
          </button>
        )}
        <button
          onClick={close}
          className="px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
        >
          {parsed ? 'Cancel' : 'Close'}
        </button>
        {parsed && (
          <button
            onClick={onCommit}
            disabled={!canCommit}
            className="px-3 py-1.5 rounded-md text-sm bg-accent-blue/15 text-accent-blue border border-accent-blue/40 hover:bg-accent-blue/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 disabled:opacity-60 disabled:cursor-not-allowed"
            title={
              canCommit
                ? 'Load this URDF into every open 3D panel'
                : 'Resolve every package binding above first'
            }
          >
            Load robot
          </button>
        )}
      </footer>
    </ModalShell>
  );
}

function AnchorLinkPicker({ model }: { model: UrdfModel }) {
  const loaded = useRobotModelStore((s) => s.loaded);
  const setAnchorLink = useRobotModelStore((s) => s.setAnchorLink);
  const allLinks = useMemo(() => Array.from(model.links.keys()).sort(), [model]);
  // Use the URDF's first root link by default; the picker only matters for
  // tree topologies where the user wants a non-root anchor.
  const current = loaded?.anchorLink ?? model.rootLinks[0] ?? allLinks[0] ?? '';
  return (
    <select
      value={current}
      onChange={(e) => setAnchorLink(e.target.value)}
      className="w-full mt-2 px-2 py-1 rounded-md bg-bg-primary border border-border focus:border-accent-blue/60 focus:ring-1 focus:ring-accent-blue/30 focus:outline-none mono text-xs text-text-primary"
    >
      {allLinks.map((link) => (
        <option key={link} value={link}>
          {link} {model.rootLinks.includes(link) ? '(URDF root)' : ''}
        </option>
      ))}
    </select>
  );
}

function PackageRow({ packageName }: { packageName: string }) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [urlPrefix, setUrlPrefix] = useState('');
  const onFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // Use the dropped folder's first entry's directory as the user-visible
    // hint so they recognise it next session.
    const first = files[0] as File & { webkitRelativePath?: string };
    const hint = first.webkitRelativePath?.split('/')[0] ?? packageName;
    setFileBinding(packageName, Array.from(files), hint);
  };
  const onSaveUrl = () => {
    if (urlPrefix.trim()) {
      setUrlBinding(packageName, urlPrefix.trim());
      setUrlPrefix('');
    }
  };

  return (
    <li className="rounded-md border border-border bg-bg-primary/40 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <code className="mono text-text-primary text-sm">{packageName}</code>
        <span className="text-text-tertiary text-[10px] uppercase tracking-wide">
          missing
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <button
            onClick={() => folderInputRef.current?.click()}
            className="w-full px-2.5 py-1.5 rounded-md text-xs bg-accent-blue/10 text-accent-blue border border-accent-blue/30 hover:bg-accent-blue/20"
            title="Drop the package's root folder (will recurse into subdirectories)"
          >
            Drop folder...
          </button>
          {/* `webkitdirectory` is non-standard but Chromium/Firefox both
              implement it; users without folder uploads fall back to the
              URL prefix flow. */}
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            multiple
            // @ts-expect-error - non-standard but supported in modern Chromium/Firefox
            webkitdirectory=""
            onChange={onFolderInput}
          />
        </div>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={urlPrefix}
            onChange={(e) => setUrlPrefix(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveUrl();
            }}
            placeholder="https://…/pkg-root"
            className="flex-1 px-2 py-1.5 rounded-md bg-bg-primary border border-border focus:border-accent-blue/60 focus:ring-1 focus:ring-accent-blue/30 focus:outline-none mono text-[11px] text-text-primary placeholder:text-text-muted"
          />
          <button
            onClick={onSaveUrl}
            disabled={!urlPrefix.trim()}
            className="px-2 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border disabled:opacity-50"
          >
            Use
          </button>
        </div>
      </div>
    </li>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
        {title}
      </h3>
      {hint && <span className="text-[10px] text-text-muted">{hint}</span>}
    </div>
  );
}

function UrdfIcon() {
  return (
    <svg
      className="w-10 h-10 text-text-tertiary"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
      <path strokeLinecap="round" d="M12 7.5v3M10.5 12h-3M13.5 12h3M11 13l-2 4M13 13l2 4" />
    </svg>
  );
}
