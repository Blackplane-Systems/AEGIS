/** Default CUSUM slack for a one-sigma shift detector. */
export const CUSUM_DEFAULT_K = 0.5;

/** Default CUSUM threshold multiplier. */
export const CUSUM_DEFAULT_H = 5;

/** CUSUM detector configuration. */
export interface CusumConfig {
  readonly mu0: number;
  readonly sigma0: number;
  readonly k?: number;
  readonly h?: number;
}

/** Incremental CUSUM update result. */
export interface CusumUpdate {
  readonly index: number;
  readonly sPlus: number;
  readonly sMinus: number;
  readonly alert: boolean;
  readonly direction?: 'UPPER' | 'LOWER';
}

/** Two-sided CUSUM drift detector using raw-unit statistics and h*sigma0 thresholds. */
export class CusumDetector {
  private sPlusValue = 0;
  private sMinusValue = 0;
  private count = 0;
  private readonly kValue: number;
  private readonly hValue: number;

  public constructor(private readonly config: CusumConfig) {
    if (config.sigma0 <= 0) {
      throw new Error('CUSUM sigma0 must be positive');
    }
    this.kValue = config.k ?? CUSUM_DEFAULT_K;
    this.hValue = config.h ?? CUSUM_DEFAULT_H;
  }

  /** Current upper statistic. */
  public get sPlus(): number {
    return this.sPlusValue;
  }

  /** Current lower statistic. */
  public get sMinus(): number {
    return this.sMinusValue;
  }

  /** Adds one observation and returns current alert state. */
  public update(x: number): CusumUpdate {
    this.count += 1;
    const slack = this.kValue * this.config.sigma0;
    this.sPlusValue = Math.max(0, this.sPlusValue + x - this.config.mu0 - slack);
    this.sMinusValue = Math.max(0, this.sMinusValue + this.config.mu0 - x - slack);
    const threshold = this.hValue * this.config.sigma0;
    const upperAlert = this.sPlusValue > threshold;
    const lowerAlert = this.sMinusValue > threshold;
    const base = {
      index: this.count,
      sPlus: this.sPlusValue,
      sMinus: this.sMinusValue,
      alert: upperAlert || lowerAlert,
    };
    if (upperAlert) {
      return { ...base, direction: 'UPPER' };
    }
    if (lowerAlert) {
      return { ...base, direction: 'LOWER' };
    }
    return base;
  }

  /** Resets statistics after an alert acknowledgement. */
  public acknowledge(): void {
    this.sPlusValue = 0;
    this.sMinusValue = 0;
  }
}
