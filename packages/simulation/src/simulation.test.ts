import { describe, expect, it } from 'vitest';
import {
  FaultInjector,
  GilbertElliottChannel,
  TwinFidelity,
  gilbertElliottPreset,
  steadyStateGoodProbability,
  steadyStateLossProbability,
} from './index';

describe('Gilbert-Elliott channel', () => {
  it('converges to steady-state probabilities and burst run lengths', () => {
    const config = gilbertElliottPreset('bursty', 11);
    const channel = new GilbertElliottChannel(config);
    let good = 0;
    let losses = 0;
    let badRuns = 0;
    let badRunLength = 0;
    let badRunTotal = 0;
    let previousBad = false;
    for (let step = 0; step < 100_000; step += 1) {
      const result = channel.transmit(step);
      if (result.state === 'GOOD') {
        good += 1;
        if (previousBad) {
          badRuns += 1;
          badRunTotal += badRunLength;
          badRunLength = 0;
        }
        previousBad = false;
      } else {
        previousBad = true;
        badRunLength += 1;
      }
      if (!result.delivered) {
        losses += 1;
      }
    }
    expect(good / 100_000).toBeCloseTo(steadyStateGoodProbability(config), 1);
    expect(losses / 100_000).toBeCloseTo(steadyStateLossProbability(config), 1);
    expect(badRunTotal / badRuns).toBeCloseTo(1 / config.q, 0);
  });
});

describe('FaultInjector', () => {
  it('makes each injection observable and restores automatically', () => {
    const injector = new FaultInjector();
    injector.add({
      id: 'corrupt',
      level: 'Fault',
      kind: 'CORRUPT_SENSOR',
      startMs: 0,
      durationMs: 10,
    });
    injector.add({
      id: 'battery',
      level: 'Fault',
      kind: 'DEGRADE_BATTERY',
      startMs: 0,
      durationMs: 10,
    });
    injector.add({ id: 'ack', level: 'Error', kind: 'DROP_ACK', startMs: 0, durationMs: 10 });
    injector.add({
      id: 'stale',
      level: 'Error',
      kind: 'STALE_TIMESTAMP',
      startMs: 0,
      durationMs: 10,
    });
    injector.add({
      id: 'down',
      level: 'Failure',
      kind: 'UNRESPONSIVE',
      startMs: 0,
      durationMs: 10,
    });
    injector.add({
      id: 'wrong',
      level: 'Failure',
      kind: 'CONSTANT_WRONG_VALUE',
      startMs: 0,
      durationMs: 10,
    });
    const event = {
      timestamp: 100_000,
      ack: true,
      responsive: true,
      payload: { value: 42, battery_rate_of_change: 0 },
    };
    const active = injector.apply(event, 5);
    expect(active.payload.value).toBe(-9999);
    expect(active.payload.battery_rate_of_change).toBe(0.5);
    expect(active.ack).toBe(false);
    expect(active.responsive).toBe(false);
    expect(active.timestamp).toBe(40_000);
    expect(injector.apply(event, 20)).toEqual(event);

    const channel = new GilbertElliottChannel({ p: 0, q: 1, k: 0, h: 0, seed: 1 });
    expect(injector.transmitWithChannel(channel, event, 20).delivered).toBe(true);
  });
});

describe('TwinFidelity', () => {
  it('reports perfect, advisory, and known RMSE fidelity values', () => {
    const perfect = new TwinFidelity(['temp'], 3);
    perfect.observe([
      { signal: 'temp', real: 0, twin: 0 },
      { signal: 'temp', real: 10, twin: 10 },
    ]);
    expect(perfect.report().fidelity).toBe(1);

    const known = new TwinFidelity(['temp'], 3);
    known.observe([
      { signal: 'temp', real: 0, twin: 5 },
      { signal: 'temp', real: 10, twin: 15 },
    ]);
    expect(known.report().fidelity).toBeCloseTo(0.5);
    expect(known.report().status).toBe('ALERT');

    const advisory = new TwinFidelity(['temp'], 3);
    advisory.observe([
      { signal: 'temp', real: 0, twin: 1.1 },
      { signal: 'temp', real: 10, twin: 11.1 },
    ]);
    expect(advisory.report().status).toBe('ADVISORY');
  });
});
