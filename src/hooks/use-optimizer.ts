import { useEffect, useRef, useState } from "react";
import type { Candle, Horizon } from "@/lib/engine";
import type { OptimizeResult } from "@/lib/optimizer";

/** Runs the tuning in a background worker so the dashboard never freezes. */
export function useOptimizer(c: Candle[], horizon: Horizon, feePct: number, key: number) {
  const [state, setState] = useState<{ horizon: Horizon; result: OptimizeResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    worker.current = new Worker(new URL("../lib/optimizer.worker.ts", import.meta.url), { type: "module" });
    return () => worker.current?.terminate();
  }, []);
  useEffect(() => {
    const w = worker.current;
    if (!w || c.length < 400) return;
    const id = ++seq.current;
    setBusy(true);
    w.onmessage = (e) => { if (e.data.id === seq.current) { setState({ horizon, result: e.data.result }); setBusy(false); } };
    w.postMessage({ id, c: c.slice(0, -1), horizon, feePct });
  }, [horizon, feePct, key, c.length]);
  return { opt: state && state.horizon === horizon ? state.result : null, busy };
}
