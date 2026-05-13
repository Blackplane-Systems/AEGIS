import { describe, expect, it } from 'vitest';
import {
  IsolationForest,
  KaplanMeier,
  buildCausalityGraph,
  grangerTest,
  logRankTest,
  normaliseDeviceFeatures,
  serialiseCausalityGraph,
  shouldHaltRolloutForSurvival,
} from './index';

describe('Granger causality', () => {
  it('detects a known causal synthetic series and rejects independent series', () => {
    const x = Array.from({ length: 80 }, (_, index) => Math.sin(index / 3));
    const y = x.map((_, index) => (index < 2 ? 0 : 0.85 * x[index - 1]! + 0.05 * Math.sin(index)));
    const causal = grangerTest(x, y, 1);
    expect(causal.fStatistic).toBeGreaterThan(100);
    expect(causal.pValue).toBeLessThan(0.05);

    const independent = Array.from({ length: 80 }, (_, index) => Math.cos(index / 5));
    expect(grangerTest(x, independent, 1).pValue).toBeGreaterThan(0.05);
    const graph = buildCausalityGraph({ x, y, independent }, 1);
    expect(graph.x).toContain('y');
    expect(serialiseCausalityGraph(graph)).toContain('"x"');
  });
});

describe('Isolation Forest', () => {
  it('scores anomalies high and normal cluster points near midrange with stable seeds', () => {
    const normal = Array.from({ length: 120 }, (_, index) => {
      const base = 0.2 + (index % 10) * 0.005;
      return [base, base, 0.15, 0.1, 0.3, 0.1];
    });
    const forest = new IsolationForest(100, 64, 3);
    const anomaly = normaliseDeviceFeatures({
      drift_score: 1,
      packet_loss: 0.95,
      reconnect_rate: 0.9,
      action_fail_rate: 0.8,
      cpu_load: 0.95,
      battery_rate_of_change: 0.9,
    });
    forest.fit([...normal, anomaly]);
    expect(forest.score(anomaly)).toBeGreaterThan(0.7);
    expect(forest.score(normal[0]!)).toBeGreaterThan(0.35);
    expect(forest.score(normal[0]!)).toBeLessThan(0.65);

    const scores = [1, 2, 3, 4, 5].map((seed) => {
      const seeded = new IsolationForest(100, 64, seed);
      seeded.fit(normal);
      return seeded.score(anomaly);
    });
    const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const variance = scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length;
    expect(variance).toBeLessThan(0.05);
  });
});

describe('Kaplan-Meier survival', () => {
  it('matches hand-computed survival with right censoring and computes median', () => {
    const km = new KaplanMeier([
      { time: 1, event: true },
      { time: 2, event: false },
      { time: 3, event: true },
      { time: 4, event: true },
    ]);
    expect(km.survivalAt(1)).toBeCloseTo(0.75);
    expect(km.survivalAt(3)).toBeCloseTo(0.375);
    expect(km.medianSurvival()).toBe(3);
    expect(km.points().find((point) => point.time === 2)?.censored).toBe(1);
  });

  it('distinguishes survival curves and gates firmware rollout', () => {
    const oldFw = [
      { time: 5, event: true },
      { time: 6, event: true },
      { time: 7, event: false },
      { time: 8, event: true },
      { time: 9, event: false },
    ];
    const newFw = [
      { time: 1, event: true },
      { time: 2, event: true },
      { time: 2, event: true },
      { time: 3, event: true },
      { time: 4, event: false },
    ];
    expect(logRankTest(newFw, oldFw).pValue).toBeLessThan(0.05);
    expect(shouldHaltRolloutForSurvival(new KaplanMeier(oldFw), new KaplanMeier(newFw))).toBe(true);
  });
});
