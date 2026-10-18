// Parameter tuning with an untouched validation period. Pure and testable.
import { applyFilters, computeSignal, ema, HTF_PERIODS, NO_FILTERS, type Candle, type Filters, type Horizon } from "./engine";

export type Params = { threshold: number; stopAtr: number; targetAtr: number; hold: number; filters: Filters; mode: 1 | -1 };
export type Stats = { trades: number; winRate: number; expectancy: number; pnlR: number; maxDD: number };

export const GRID = {
  threshold: [0.3, 0.45, 0.6],
  stopAtr: [1, 1.5, 2],
  targetAtr: [1, 1.5, 2.5],
  hold: [1, 3, 6],
  mode: [1, -1] as (1 | -1)[],
  filters: [NO_FILTERS, { htfTrend: true, volume: false, pressure: false }, { htfTrend: true, volume: true, pressure: false }, { htfTrend: false, volume: false, pressure: true }] as Filters[],
};
export const MIN_TRADES = 15;

/** Multi-candle exit: stop wins any candle where both levels are touched; otherwise close of the last held candle. */
export function evaluatePath(dir: "LONG" | "SHORT", entry: number, stop: number, target: number, next: Candle[]) {
  for (const k of next) {
    const hitStop = dir === "LONG" ? k.low <= stop : k.high >= stop;
    const hitTarget = dir === "LONG" ? k.high >= target : k.low <= target;
    if (hitStop) return { exit: stop, outcome: "stop" as const };
    if (hitTarget) return { exit: target, outcome: "target" as const };
  }
  return { exit: next[next.length - 1]!.close, outcome: "timeout" as const };
}

type Pre = { score: number; atr: number; pass: Map<string, { LONG: boolean; SHORT: boolean }> }[];
const fkey = (f: Filters) => `${+f.htfTrend}${+f.volume}${+f.pressure}`;

/** Score every candle once, and whether each filter set would let a LONG/SHORT through. */
export function precompute(c: Candle[], horizon: Horizon, filterSets = GRID.filters): Pre {
  const periods = HTF_PERIODS[horizon];
  const closes = c.map((x) => x.close);
  const pre = { fast: ema(closes, periods.fast), slow: ema(closes, periods.slow) };
  return c.map((_, i) => {
    if (i < 50) return { score: 0, atr: 0, pass: new Map() };
    const s = computeSignal(c, i);
    const pass = new Map<string, { LONG: boolean; SHORT: boolean }>();
    for (const f of filterSets) {
      const L = applyFilters(c, i, { ...s, direction: "LONG" }, f, { pre, periods }).direction === "LONG";
      const S = applyFilters(c, i, { ...s, direction: "SHORT" }, f, { pre, periods }).direction === "SHORT";
      pass.set(fkey(f), { LONG: L, SHORT: S });
    }
    return { score: s.score, atr: s.atr, pass };
  });
}

/** Backtest params over signal indices [from, to). Entry at next open, fee (% round trip) deducted in R. */
export function runParams(c: Candle[], pre: Pre, p: Params, feePct: number, from: number, to: number): Stats {
  let trades = 0, wins = 0, pnlR = 0, peak = 0, maxDD = 0;
  const key = fkey(p.filters);
  for (let i = Math.max(50, from); i < Math.min(to, c.length - p.hold); i++) {
    const x = pre[i]!;
    if (x.atr <= 0) continue;
    const sc = x.score * p.mode;
    const dir = sc > p.threshold ? "LONG" : sc < -p.threshold ? "SHORT" : null;
    if (!dir || !x.pass.get(key)?.[dir]) continue;
    const entry = c[i + 1]!.open;
    const risk = p.stopAtr * x.atr;
    const sgn = dir === "LONG" ? 1 : -1;
    const { exit } = evaluatePath(dir, entry, entry - sgn * risk, entry + sgn * p.targetAtr * x.atr, c.slice(i + 1, i + 1 + p.hold));
    const net = (sgn * (exit - entry)) / risk - (entry * feePct) / 100 / risk;
    trades++; if (net > 0) wins++;
    pnlR += net; peak = Math.max(peak, pnlR); maxDD = Math.max(maxDD, peak - pnlR);
    i += p.hold - 1; // one position at a time
  }
  return { trades, winRate: trades ? (wins / trades) * 100 : 0, pnlR, expectancy: trades ? pnlR / trades : 0, maxDD };
}

export type OptimizeResult = { best: Params | null; train: Stats | null; test: Stats | null; robust: boolean; tested: number; splitTime: number };

/**
 * Picks the params with the best training expectancy (min trades, penalised for drawdown), then
 * reports them on the later 30% that was never used to choose. Only "robust" when both periods are positive.
 */
export function optimize(c: Candle[], horizon: Horizon, feePct: number, trainShare = 0.7): OptimizeResult {
  const start = Math.max(50, HTF_PERIODS[horizon].slow);
  if (c.length < start + 200) return { best: null, train: null, test: null, robust: false, tested: 0, splitTime: 0 };
  const pre = precompute(c, horizon);
  const split = Math.floor(start + (c.length - 1 - start) * trainShare);
  let best: Params | null = null, bestTrain: Stats | null = null, bestScore = -Infinity, tested = 0;
  for (const threshold of GRID.threshold) for (const stopAtr of GRID.stopAtr) for (const targetAtr of GRID.targetAtr)
    for (const hold of GRID.hold) for (const filters of GRID.filters) for (const mode of GRID.mode) {
      const p: Params = { threshold, stopAtr, targetAtr, hold, filters, mode };
      const s = runParams(c, pre, p, feePct, start, split);
      tested++;
      if (s.trades < MIN_TRADES) continue;
      const score = s.expectancy * Math.sqrt(s.trades) - 0.05 * s.maxDD;
      if (score > bestScore) { bestScore = score; best = p; bestTrain = s; }
    }
  if (!best || !bestTrain) return { best: null, train: null, test: null, robust: false, tested, splitTime: c[split]?.time ?? 0 };
  const test = runParams(c, pre, best, feePct, split, c.length - 1);
  const robust = bestTrain.expectancy > 0 && test.trades >= 8 && test.expectancy > 0;
  return { best, train: bestTrain, test, robust, tested, splitTime: c[split]?.time ?? 0 };
}
