import { describe, it, expect } from "vitest";
import { evaluatePath, optimize } from "./optimizer";
import type { Candle } from "./engine";

const bar = (o: number, h: number, l: number, c: number, t = 0): Candle => ({ time: t, open: o, high: h, low: l, close: c, volume: 100 });

describe("multi-candle exit", () => {
  it("stops first when stop and target touch in the same candle", () => {
    expect(evaluatePath("LONG", 100, 97, 104, [bar(100, 101, 99, 100), bar(100, 105, 96, 104)]).exit).toBe(97);
  });
  it("takes the target when reached before any stop", () => {
    expect(evaluatePath("SHORT", 100, 103, 96, [bar(100, 101, 95, 96), bar(96, 110, 95, 109)]).exit).toBe(96);
  });
  it("exits at the last held candle's close on timeout", () => {
    expect(evaluatePath("LONG", 100, 97, 104, [bar(100, 101, 99, 100), bar(100, 102, 99, 101.5)]).outcome).toBe("timeout");
  });
});

describe("tuning with an untouched period", () => {
  it("never chooses settings using the validation candles", () => {
    const c = Array.from({ length: 900 }, (_, i) => { const p = 100 + Math.sin(i / 7) * 3 + i * 0.01; return bar(p, p + 1, p - 1, p + 0.2, i * 300); });
    const a = optimize(c, "5m", 0.1);
    const changed = c.map((x, i) => (i > 800 ? bar(x.open, x.high + 5, x.low - 5, x.close - 2, x.time) : x));
    expect(optimize(changed, "5m", 0.1).best).toEqual(a.best);
  });
  it("is not robust when validation expectancy is not positive", () => {
    const r = optimize(Array.from({ length: 900 }, (_, i) => bar(100, 100.5, 99.5, 100, i * 300)), "5m", 0.1);
    expect(r.robust).toBe(false);
  });
});
