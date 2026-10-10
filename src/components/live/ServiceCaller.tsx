import { useState } from 'react';
import type { LiveConnection } from '../../live/liveConnection';
import type { FoxgloveService } from '../../live/foxgloveClient';
import { skeletonFor, toJson } from '../../live/serviceCodec';

interface Props {
  conn: LiveConnection;
  services: FoxgloveService[];
}

/**
 * Call a service the bridge advertises. The request is JSON, prefilled with
 * every field zeroed from the service's own schema. Only shown while control is
 * enabled: a service can do anything from "reset odometry" to "shut down".
 */
export function ServiceCaller({ conn, services }: Props) {
  const [id, setId] = useState<number | null>(services[0]?.id ?? null);
  const service = services.find((s) => s.id === id) ?? services[0] ?? null;
  if (services.length === 0) return <p className="text-[10px] text-text-tertiary">This server offers no services.</p>;
  if (!service) return null;
  return (
    <div className="space-y-1.5 border-t border-border pt-2" data-testid="service-caller">
      <label className="flex flex-col gap-1">
        Service
        <select value={service.id} onChange={(e) => setId(Number(e.target.value))} className="bg-bg-primary border border-border rounded-md px-2 py-1 mono text-text-primary">
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <div className="text-[10px] text-text-tertiary mono truncate" title={service.type}>{service.type}</div>
      {/* Keyed so each service starts from its own prefilled request. */}
      <ServiceForm key={`${service.id}:${service.requestSchema}`} conn={conn} service={service} />
    </div>
  );
}

function initialRequest(service: FoxgloveService): string {
  try {
    return toJson(skeletonFor(service.requestSchema, service.schemaEncoding !== 'ros1msg'));
  } catch {
    return '{}';
  }
}

function ServiceForm({ conn, service }: { conn: LiveConnection; service: FoxgloveService }) {
  const [text, setText] = useState(() => initialRequest(service));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const call = async () => {
    let request: unknown;
    try {
      request = JSON.parse(text);
    } catch (e) {
      setResult({ ok: false, text: `The request is not valid JSON: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      setResult({ ok: true, text: toJson(await conn.callService(service.id, request)) });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        aria-label="Service request (JSON)"
        className="w-full bg-bg-primary border border-border rounded-md px-2 py-1 mono text-text-primary"
      />
      <button type="button" onClick={() => void call()} disabled={busy} className="w-full px-3 py-1.5 rounded-md border border-accent-rose/50 text-text-primary hover:bg-accent-rose/10 disabled:opacity-50">
        {busy ? 'Waiting...' : 'Call service'}
      </button>
      {result && (
        <pre role={result.ok ? 'status' : 'alert'} data-testid="service-result" className={`max-h-32 overflow-auto rounded-md border px-2 py-1 mono whitespace-pre-wrap ${result.ok ? 'border-border text-text-secondary' : 'border-accent-rose/50 text-accent-rose'}`}>
          {result.text}
        </pre>
      )}
    </>
  );
}
