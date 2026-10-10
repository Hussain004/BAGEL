import { useEffect } from 'react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useTourStore } from '../../store/tourStore';
import { parseBody } from '../../utils/tour';
import { applyTourStep, clearHighlight } from '../../utils/tourRunner';

/**
 * The guided-tour card: the current step's text with Back and Next. Moving
 * between steps applies each step's layout and time, so the panels change under
 * the words.
 */
export function TourCard() {
  const tour = useTourStore((s) => s.tour);
  const index = useTourStore((s) => s.index);
  const loading = useTourStore((s) => s.loading);
  const error = useTourStore((s) => s.error);
  const goTo = useTourStore((s) => s.goTo);
  const close = useTourStore((s) => s.close);

  useEscapeToClose(tour !== null || error !== null, close);

  // Apply the step whenever the tour starts or the step changes.
  useEffect(() => {
    if (!tour) return;
    applyTourStep(tour.steps[index]!);
    return clearHighlight;
  }, [tour, index]);

  if (error) {
    return (
      <div role="alert" className="fixed z-[90] bottom-20 right-4 max-w-sm rounded-xl border border-accent-rose/40 bg-bg-secondary p-3 text-xs text-text-secondary shadow-panel">
        <p>{error}</p>
        <button type="button" onClick={close} className="mt-2 text-accent-blue hover:underline">Dismiss</button>
      </div>
    );
  }
  if (loading && !tour) {
    return (
      <div role="status" className="fixed z-[90] bottom-20 right-4 rounded-xl border border-border bg-bg-secondary px-3 py-2 text-xs text-text-secondary shadow-panel">
        Loading tour...
      </div>
    );
  }
  if (!tour) return null;

  const step = tour.steps[index]!;
  const last = index === tour.steps.length - 1;
  return (
    <section
      aria-label={`Guided tour: ${tour.title}`}
      className="fixed z-[90] bottom-20 right-4 left-4 sm:left-auto sm:w-[26rem] max-h-[60vh] overflow-y-auto rounded-xl border border-accent-blue/40 bg-bg-secondary p-4 shadow-panel animate-fade-in"
      data-testid="tour-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] mono uppercase tracking-wider text-accent-blue truncate">{tour.title}</div>
          <h2 className="text-sm font-semibold text-text-primary mt-0.5" data-testid="tour-step-title">{step.title}</h2>
        </div>
        <button type="button" onClick={close} aria-label="End tour" title="End tour (Esc)" className="text-text-tertiary hover:text-text-primary text-lg leading-none px-1">
          ×
        </button>
      </div>

      <div className="mt-2 space-y-2 text-xs leading-relaxed text-text-secondary" aria-live="polite">
        {parseBody(step.body).map((paragraph, i) => (
          <p key={i}>
            {paragraph.map((piece, j) =>
              piece.kind === 'bold' ? (
                <strong key={j} className="text-text-primary">{piece.text}</strong>
              ) : piece.kind === 'code' ? (
                <code key={j} className="mono rounded bg-surface px-1 py-0.5 text-text-primary">{piece.text}</code>
              ) : (
                <span key={j}>{piece.text}</span>
              ),
            )}
          </p>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] mono text-text-tertiary" data-testid="tour-progress">
          {index + 1} of {tour.steps.length}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="px-2.5 py-1 rounded-md text-xs border border-border text-text-secondary hover:border-accent-blue/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => (last ? close() : goTo(index + 1))}
            className="px-2.5 py-1 rounded-md text-xs bg-accent-blue/20 border border-accent-blue/40 text-text-primary hover:bg-accent-blue/30"
          >
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </section>
  );
}
