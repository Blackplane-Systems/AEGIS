/** Default EWMA smoothing factor. */
export const EWMA_DEFAULT_LAMBDA = 0.1;

/** Default EWMA control multiplier. */
export const EWMA_DEFAULT_L = 3;

/** EWMA detector configuration. */
export interface EwmaConfig {
  readonly mu0: number;
  readonly sigma0: number;
  readonly lambda?: number;
  readonly L?: number;
}

/** Incremental EWMA update result. */
export interface EwmaUpdate {
  readonly index: number;
  readonly z: number;
  readonly ucl: number;
  readonly lcl: number;
  readonly alert: boolean;
}

/** EWMA anomaly detector with exact transient control limits. */
export class EwmaDetector {
  private zValue: number;
  private count = 0;
  private readonly lambdaValue: number;
  private readonly lValue: number;

  public constructor(private readonly config: EwmaConfig) {
    if (config.sigma0 <= 0) {
      throw new Error('EWMA sigma0 must be positive');
    }
    this.lambdaValue = config.lambda ?? EWMA_DEFAULT_LAMBDA;
    this.lValue = config.L ?? EWMA_DEFAULT_L;
    if (this.lambdaValue <= 0 || this.lambdaValue > 1) {
      throw new Error('EWMA lambda must be in (0, 1]');
    }
    this.zValue = config.mu0;
  }

  /** Current EWMA statistic. */
  public get z(): number {
    return this.zValue;
  }

  /** Adds one observation and returns current control limits. */
  public update(x: number): EwmaUpdate {
    this.count += 1;
    this.zValue = this.lambdaValue * x + (1 - this.lambdaValue) * this.zValue;
    const limits = this.limitsAt(this.count);
    return {
      index: this.count,
      z: this.zValue,
      ...limits,
      alert: this.zValue > limits.ucl || this.zValue < limits.lcl,
    };
  }

  /** Returns UCL/LCL at observation n using the transient correction. */
  public limitsAt(n: number): { readonly ucl: number; readonly lcl: number } {
    const transient = 1 - (1 - this.lambdaValue) ** (2 * n);
    const width =
      this.lValue *
      this.config.sigma0 *
      Math.sqrt((this.lambdaValue / (2 - this.lambdaValue)) * transient);
    return {
      ucl: this.config.mu0 + width,
      lcl: this.config.mu0 - width,
    };
  }
}
