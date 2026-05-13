import { describe, expect, it } from 'vitest';
import { TrustScore, TrustScoreEngine, TrustState, TrustStateMachine } from '../../trust/src';
import { CusumDetector, DriftScoreEngine, EwmaDetector } from './index';

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function normal(rng: () => number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe('CUSUM detector', () => {
  it('fires on a known one-sigma upward shift and resets after acknowledgement', () => {
    const detector = new CusumDetector({ mu0: 0, sigma0: 1 });
    const updates = Array.from({ length: 20 }, () => detector.update(1.2));
    const firstAlert = updates.find((update) => update.alert);
    expect(firstAlert?.direction).toBe('UPPER');
    expect(firstAlert?.index).toBeGreaterThan(5);
    detector.acknowledge();
    expect(detector.sPlus).toBe(0);
    expect(detector.sMinus).toBe(0);
  });

  it('keeps false alarms rare for stable noise in a deterministic Monte Carlo check', () => {
    const rng = lcg(7);
    let alerts = 0;
    for (let run = 0; run < 200; run += 1) {
      const detector = new CusumDetector({ mu0: 0, sigma0: 1 });
      for (let step = 0; step < 100; step += 1) {
        if (detector.update(normal(rng)).alert) {
          alerts += 1;
          break;
        }
      }
    }
    expect(alerts / 200).toBeLessThan(0.25);
  });
});

describe('EWMA detector', () => {
  it('fires on gradual drift and has convergent transient control limits', () => {
    const detector = new EwmaDetector({ mu0: 0, sigma0: 1 });
    let alertAt = Number.POSITIVE_INFINITY;
    for (let index = 1; index <= 80; index += 1) {
      const update = detector.update(index / 30);
      if (update.alert) {
        alertAt = index;
        break;
      }
    }
    expect(alertAt).toBeLessThan(80);
    const asymptoticWidth = 3 * Math.sqrt(0.1 / 1.9);
    expect(detector.limitsAt(500).ucl).toBeCloseTo(asymptoticWidth, 5);
  });

  it('responds slower than CUSUM for the same abrupt one-sigma sequence', () => {
    const cusum = new CusumDetector({ mu0: 0, sigma0: 1, h: 2 });
    const ewma = new EwmaDetector({ mu0: 0, sigma0: 1 });
    let cusumAlert = 0;
    let ewmaAlert = 0;
    for (let step = 1; step <= 50; step += 1) {
      if (cusumAlert === 0 && cusum.update(1.2).alert) {
        cusumAlert = step;
      }
      if (ewmaAlert === 0 && ewma.update(1.2).alert) {
        ewmaAlert = step;
      }
    }
    expect(cusumAlert).toBeGreaterThan(0);
    expect(ewmaAlert).toBeGreaterThan(cusumAlert);
  });
});

describe('composite drift score', () => {
  it('feeds sensor integrity into trust and causes a constrained transition', () => {
    const drift = new DriftScoreEngine({ temp: 1.2, pressure: 0.8 });
    for (let index = 0; index < 20; index += 1) {
      drift.observeBaseline([
        { sensor: 'temp', value: 20 + (index % 2) * 0.1 },
        { sensor: 'pressure', value: 50 },
      ]);
    }
    const report = drift.score([
      { sensor: 'temp', value: 35 },
      { sensor: 'pressure', value: 65 },
    ]);
    expect(report.driftScore).toBeGreaterThan(0.9);
    expect(report.phiSensor).toBeLessThan(0.1);

    const score: TrustScore = {
      identity: 1,
      attestation: 1,
      behavioural: 0.7,
      sensorIntegrity: report.phiSensor,
      connectivity: 1,
      policyCompliance: 0.7,
      runtimeHealth: 0.7,
    };
    const trust = new TrustScoreEngine().compositeScore(score);
    expect(trust).toBeLessThan(0.75);
    const machine = new TrustStateMachine(TrustState.VALIDATED);
    machine.transition(TrustState.CONSTRAINED, { score: trust, attested: false });
    expect(machine.state).toBe(TrustState.CONSTRAINED);
  });
});
