/** Network observation used for automatic standalone baseline learning. */
export interface NetworkConditionObservation {
  readonly key: string;
  readonly latencyMs: number;
  readonly packetLossRatio: number;
  readonly reconnects: number;
  readonly observedAt?: string;
}

/** Baseline deviation report. */
export interface NetworkDeviationReport {
  readonly key: string;
  readonly samples: number;
  readonly latencyDeviation: boolean;
  readonly packetLossDeviation: boolean;
  readonly reconnectDeviation: boolean;
  readonly observedAt: string;
}

interface RunningStats {
  count: number;
  mean: number;
  m2: number;
}

/** Learns normal network conditions and detects deviations without static thresholds. */
export class NetworkConditionBaseline {
  private readonly latency = new Map<string, RunningStats>();
  private readonly packetLoss = new Map<string, RunningStats>();
  private readonly reconnects = new Map<string, RunningStats>();

  public constructor(
    private readonly minSamples = 5,
    private readonly zThreshold = 3,
  ) {}

  /** Observes one network sample and returns a deviation report. */
  public observe(observation: NetworkConditionObservation): NetworkDeviationReport {
    const priorLatency = this.latency.get(observation.key);
    const priorPacketLoss = this.packetLoss.get(observation.key);
    const priorReconnects = this.reconnects.get(observation.key);
    const latencyDeviation = isDeviation(
      priorLatency,
      observation.latencyMs,
      this.minSamples,
      this.zThreshold,
    );
    const packetLossDeviation = isDeviation(
      priorPacketLoss,
      observation.packetLossRatio,
      this.minSamples,
      this.zThreshold,
    );
    const reconnectDeviation = isDeviation(
      priorReconnects,
      observation.reconnects,
      this.minSamples,
      this.zThreshold,
    );
    const latency = update(this.latency, observation.key, observation.latencyMs);
    update(this.packetLoss, observation.key, observation.packetLossRatio);
    update(this.reconnects, observation.key, observation.reconnects);
    return {
      key: observation.key,
      samples: latency.count,
      latencyDeviation,
      packetLossDeviation,
      reconnectDeviation,
      observedAt: observation.observedAt ?? new Date().toISOString(),
    };
  }

  /** Returns compact baseline state for APIs. */
  public snapshot(): Record<string, unknown> {
    const keys = new Set([
      ...this.latency.keys(),
      ...this.packetLoss.keys(),
      ...this.reconnects.keys(),
    ]);
    return Object.fromEntries(
      [...keys].sort().map((key) => [
        key,
        {
          latency: publicStats(this.latency.get(key)),
          packetLoss: publicStats(this.packetLoss.get(key)),
          reconnects: publicStats(this.reconnects.get(key)),
        },
      ]),
    );
  }
}

function update(map: Map<string, RunningStats>, key: string, value: number): RunningStats {
  const current = map.get(key) ?? { count: 0, mean: 0, m2: 0 };
  const count = current.count + 1;
  const delta = value - current.mean;
  const mean = current.mean + delta / count;
  const delta2 = value - mean;
  const next = { count, mean, m2: current.m2 + delta * delta2 };
  map.set(key, next);
  return next;
}

function isDeviation(
  stats: RunningStats | undefined,
  value: number,
  minSamples: number,
  zThreshold: number,
): boolean {
  if (stats === undefined || stats.count < minSamples) {
    return false;
  }
  const stddev = Math.sqrt(stats.m2 / Math.max(1, stats.count - 1));
  if (stddev === 0) {
    return value !== stats.mean;
  }
  return Math.abs(value - stats.mean) / stddev > zThreshold;
}

function publicStats(stats: RunningStats | undefined): Record<string, number> {
  if (stats === undefined) {
    return { count: 0, mean: 0, stddev: 0 };
  }
  return {
    count: stats.count,
    mean: stats.mean,
    stddev: Math.sqrt(stats.m2 / Math.max(1, stats.count - 1)),
  };
}
