import { optimize } from "./optimizer";
import type { Candle, Horizon } from "./engine";
self.onmessage = (e: MessageEvent<{ id: number; c: Candle[]; horizon: Horizon; feePct: number }>) => {
  const { id, c, horizon, feePct } = e.data;
  (self as unknown as Worker).postMessage({ id, result: optimize(c, horizon, feePct) });
};
