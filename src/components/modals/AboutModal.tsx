import { useUiStore } from '../../store/uiStore';
import { ModalShell } from './ModalShell';
import { APP_VERSION } from '../../utils/version';

/**
 * AboutModal — Project description, version, links.
 *
 * Reachable from the toolbar info button or the `A` keyboard shortcut.
 */
export function AboutModal() {
  const setModal = useUiStore((s) => s.setModal);
  return (
    <ModalShell
      title="About BAGEL"
      subtitle={`Version ${APP_VERSION} · BAG ExpLoration for ROS1 & ROS2`}
      onClose={() => setModal(null)}
      width="md"
    >
      <div className="px-6 py-5 space-y-5 text-sm text-text-secondary leading-relaxed">
        <p>
          <span className="text-text-primary font-medium">BAGEL</span> is a
          fully static, browser-native viewer for ROS bag files (
          <span className="mono text-text-primary">.mcap</span>,{' '}
          <span className="mono text-text-primary">.db3</span>, and{' '}
          <span className="mono text-text-primary">.bag</span>). No server, no
          installation, no account. Every byte stays on your machine.
        </p>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <Fact label="Supported formats" value="MCAP · ROS2 SQLite · ROS1 .bag" />
          <Fact label="Visualizations" value="Plot · Image · Trajectory · TF · 3D" />
          <Fact label="Runs" value="100% in your browser" />
          <Fact label="Data leaves your machine" value="Never" />
        </div>

        <div className="border-t border-border pt-4 space-y-2">
          <h3 className="text-text-primary text-sm font-semibold">Built with</h3>
          <p className="text-xs text-text-tertiary">
            React 19, TypeScript, Vite 8, Tailwind v4, Three.js, uPlot,
            @mcap/core, @foxglove/rosbag, @foxglove/rosmsg-serialization,
            @foxglove/rosmsg2-serialization, sql.js (WASM),
            react-resizable-panels, Zustand.
          </p>
        </div>

        <div className="border-t border-border pt-4 flex flex-wrap gap-2">
          <LinkButton href="https://github.com/Hussain004/BAGEL">
            <GithubIcon />
            GitHub repository
          </LinkButton>
          <LinkButton href="https://github.com/Hussain004/BAGEL/issues">
            <BugIcon />
            Report an issue
          </LinkButton>
          <LinkButton href="https://github.com/Hussain004/BAGEL/blob/main/LICENSE">
            <LicenseIcon />
            MIT License
          </LinkButton>
        </div>

        <div className="border-t border-border pt-4 text-xs text-text-tertiary">
          Built by{' '}
          <span className="text-text-secondary">
            Muhammad Hussain Habib
          </span>{' '}
          for the robotics community.
          {' '}
          Special thanks to my <a href="https://www.linkedin.com/in/muneeb-pervez/" target="_blank" rel="noopener noreferrer" className="text-text-secondary">HB</a> for alpha testing and feedback!
        </div>
      </div>
    </ModalShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 px-3 py-2">
      <div className="text-text-tertiary text-[10px] uppercase tracking-wider">{label}</div>
      <div className="text-text-primary text-xs mt-1">{value}</div>
    </div>
  );
}

function LinkButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-text-secondary text-xs hover:border-accent-blue/40 hover:text-accent-blue transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
    >
      {children}
    </a>
  );
}

function GithubIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.683-.217.683-.483 0-.237-.009-.866-.013-1.7-2.782.605-3.369-1.342-3.369-1.342-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.031 1.531 1.031.892 1.529 2.341 1.088 2.91.831.092-.647.349-1.088.635-1.339-2.22-.252-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.91-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.679.919.679 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.162 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}
function BugIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function LicenseIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}
