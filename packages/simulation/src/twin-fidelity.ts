/** Pair of real/twin signal values at one time. */
export interface TwinSample {
  readonly signal: string;
  readonly real: number;
  readonly twin: number;
}

/** Per-signal fidelity contribution. */
export interface FidelityBreakdown {
  readonly signal: string;
  readonly rmse: number;
  readonly range: number;
  readonly contribution: number;
}

/** Fidelity report for a sliding window. */
export interface FidelityReport {
  readonly fidelity: number;
  readonly status: 'OK' | 'ADVISORY' | 'ALERT';
  readonly breakdown: readonly FidelityBreakdown[];
}

/** Digital twin fidelity metric over a configurable sliding window. */
export class TwinFidelity {
  private readonly samples: TwinSample[] = [];

  public constructor(
    private readonly signals: readonly string[],
    private readonly windowSize: number,
  ) {}

  /** Adds one batch of signal samples. */
  public observe(samples: readonly TwinSample[]): void {
    this.samples.push(...samples.filter((sample) => this.signals.includes(sample.signal)));
    const maxSamples = this.windowSize * this.signals.length;
    if (this.samples.length > maxSamples) {
      this.samples.splice(0, this.samples.length - maxSamples);
    }
  }

  /** Computes F = 1 - mean(RMSE/range) and threshold status. */
  public report(): FidelityReport {
    const breakdown = this.signals.map((signal) => {
      const signalSamples = this.samples.filter((sample) => sample.signal === signal);
      const rmse = Math.sqrt(
        signalSamples.reduce((sum, sample) => sum + (sample.twin - sample.real) ** 2, 0) /
          Math.max(1, signalSamples.length),
      );
      const realValues = signalSamples.map((sample) => sample.real);
      const range = Math.max(Math.max(...realValues, 1) - Math.min(...realValues, 0), 1);
      return { signal, rmse, range, contribution: rmse / range };
    });
    const meanContribution =
      breakdown.reduce((sum, item) => sum + item.contribution, 0) / Math.max(1, breakdown.length);
    const fidelity = Math.max(0, Math.min(1, 1 - meanContribution));
    const status = fidelity < 0.75 ? 'ALERT' : fidelity < 0.9 ? 'ADVISORY' : 'OK';
    return { fidelity, status, breakdown };
  }
}
