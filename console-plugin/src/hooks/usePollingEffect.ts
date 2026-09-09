import * as React from 'react';

interface UsePollingOptions {
  /** Stop polling entirely while this is `false`. Caller flips it back to true to resume. */
  enabled?: boolean;
  /** Stop polling while `document.hidden` is true (tab in background). Default: true. */
  pauseWhenHidden?: boolean;
  /** Milliseconds between polls. */
  intervalMs: number;
}

/**
 * Background-friendly poller. The historical pattern in this plugin
 * (set an interval, clear it on unmount) had three operational pitfalls
 * that we kept rediscovering — this helper bakes the fixes in once:
 *
 *  1. **Visibility awareness.** We always run one initial fetch on mount so a
 *     view that gates its `loaded` flag on the first poll resolves even in a
 *     tab that starts hidden. Beyond that, the *recurring* timer is paused
 *     while `document.hidden` is true and resumed (with a fresh poll) when the
 *     tab comes back — so a Console left open in a side tab doesn't poll the
 *     cluster forever, but also never sits on an infinite spinner.
 *
 *  2. **Caller-controlled pause.** Pass `enabled: false` (e.g. after
 *     detecting Prometheus is unavailable, or for a route whose backend
 *     keeps returning 5xx) and the timer stops. Callers decide whether
 *     to flip it back on by changing their input. This stops the worst
 *     class of waste: spam against a known-broken upstream.
 *
 *  3. **In-flight cancellation.** The `signal` provided to `fn` should be
 *     forwarded to fetch — when the interval fires again, when the tab
 *     hides, or when the component unmounts, the in-flight request is
 *     aborted so it doesn't queue up behind the next one.
 *
 * Returns a `runNow()` for callers that want to force-refresh from a
 * button or input change.
 */
export function usePollingEffect(
  fn: (signal: AbortSignal) => Promise<void> | void,
  deps: React.DependencyList,
  options: UsePollingOptions,
): { runNow: () => void } {
  const { enabled = true, pauseWhenHidden = true, intervalMs } = options;

  // Stash fn in a ref so we don't re-arm the timer on every render just
  // because the callback identity changed; the interval still re-arms when
  // any value in `deps` does, which is the right granularity.
  const fnRef = React.useRef(fn);
  fnRef.current = fn;

  const abortRef = React.useRef<AbortController | null>(null);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const runOnce = React.useCallback(() => {
    // Cancel any prior in-flight request to keep at most one outstanding.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // Swallow rejections — the callback owns its own error handling.
    Promise.resolve(fnRef.current(ac.signal)).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    if (!enabled) return;

    // Always run ONE initial fetch on mount, even when the tab starts hidden
    // (background / secondary / restored tab). Consumers flip their `loaded`
    // flag inside `fn`, so skipping this left `loaded`-gated views (Cost,
    // traffic summaries, policy Runtime Metrics) spinning forever in any
    // non-foreground tab. Only the *recurring* interval is paused while hidden;
    // the visibilitychange listener below starts it when the tab is brought
    // forward.
    runOnce();

    const hidden = pauseWhenHidden && typeof document !== 'undefined' && document.hidden;
    if (!hidden) {
      intervalRef.current = setInterval(runOnce, intervalMs);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pauseWhenHidden, intervalMs, ...deps]);

  // Visibility listener: independent of the input deps so we keep the
  // user's pause/resume working even if their inputs haven't moved.
  React.useEffect(() => {
    if (!enabled || !pauseWhenHidden || typeof document === 'undefined') return;
    const onVis = () => {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        abortRef.current?.abort();
      } else if (!intervalRef.current) {
        // Fire immediately on resume so the user sees fresh data instead
        // of the stale snapshot from when they backgrounded the tab.
        runOnce();
        intervalRef.current = setInterval(runOnce, intervalMs);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, pauseWhenHidden, intervalMs, runOnce]);

  return { runNow: runOnce };
}
