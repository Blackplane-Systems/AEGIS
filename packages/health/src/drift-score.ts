/** One sensor reading supplied to the drift score engine. */
export interface SensorReading {
  readonly sensor: string;
  readonly value: number;
}

/** Rolling baseline state for one sensor. */
export interface SensorBaseline {
  readonly count: number;
  readonly mean: number;
  readonly m2: number;
  readonly min: number;
  readonly max: number;
}

/** Drift score report. */
export interface DriftReport {
  readonly driftScore: number;
  readonly phiSensor: number;
  readonly deviations: Record<string, number>;
}

/** Configurable composite drift score engine. */
export class DriftScoreEngine {
  private readonly baselines = new Map<string, SensorBaseline>();

  public constructor(private readonly sensitivity: Record<string, number>) {}

  /** Updates rolling baselines without producing a drift alert. */
  public observeBaseline(readings: readonly SensorReading[]): void {
    for (const reading of readings) {
      this.baselines.set(
        reading.sensor,
        updateBaseline(this.baselines.get(reading.sensor), reading.value),
      );
    }
  }

  /** Computes D(d,t) = 1 - exp(-sum(alpha_j * Delta_j)) and phi_sensor = 1 - D. */
  public score(readings: readonly SensorReading[]): DriftReport {
    const deviations: Record<string, number> = {};
    let weightedDeviation = 0;
    for (const reading of readings) {
      const baseline = this.baselines.get(reading.sensor);
      const deviation = normalisedDeviation(reading.value, baseline);
      deviations[reading.sensor] = deviation;
      weightedDeviation += (this.sensitivity[reading.sensor] ?? 1) * deviation;
    }
    const driftScore = 1 - Math.exp(-weightedDeviation);
    return {
      driftScore,
      phiSensor: 1 - driftScore,
      deviations,
    };
  }
}

function updateBaseline(previous: SensorBaseline | undefined, value: number): SensorBaseline {
  if (previous === undefined) {
    return { count: 1, mean: value, m2: 0, min: value, max: value };
  }
  const count = previous.count + 1;
  const delta = value - previous.mean;
  const mean = previous.mean + delta / count;
  return {
    count,
    mean,
    m2: previous.m2 + delta * (value - mean),
    min: Math.min(previous.min, value),
    max: Math.max(previous.max, value),
  };
}

function normalisedDeviation(value: number, baseline: SensorBaseline | undefined): number {
  if (baseline === undefined || baseline.count < 2) {
    return 0;
  }
  const variance = baseline.m2 / (baseline.count - 1);
  const sigma = Math.sqrt(Math.max(variance, Number.EPSILON));
  const range = Math.max(baseline.max - baseline.min, sigma, 1);
  return Math.abs(value - baseline.mean) / range;
}
