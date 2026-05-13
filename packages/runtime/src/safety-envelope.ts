/** One-dimensional control barrier function configuration. */
export interface SafetyEnvelopeConfig {
  readonly alpha: number;
  readonly deltaT: number;
  readonly h: (x: number) => number;
}

/** Safety-envelope result for a proposed continuous command. */
export interface SafetyEnvelopeResult {
  readonly safe: boolean;
  readonly desired: number;
  readonly projected: number;
  readonly currentBarrier: number;
  readonly nextBarrier: number;
  readonly requiredBarrier: number;
}

/** Discrete one-dimensional CBF envelope with closed-form command projection. */
export class SafetyEnvelope {
  public constructor(private readonly config: SafetyEnvelopeConfig) {}

  /** Checks and projects a proposed next value to satisfy h(x_next) >= (1-alpha*dt)h(x_now). */
  public check(current: number, desired: number): SafetyEnvelopeResult {
    const currentBarrier = this.config.h(current);
    const requiredBarrier = (1 - this.config.alpha * this.config.deltaT) * currentBarrier;
    const nextBarrier = this.config.h(desired);
    if (nextBarrier >= requiredBarrier) {
      return {
        safe: true,
        desired,
        projected: desired,
        currentBarrier,
        nextBarrier,
        requiredBarrier,
      };
    }
    const projected = this.project(current, desired, requiredBarrier);
    return {
      safe: false,
      desired,
      projected,
      currentBarrier,
      nextBarrier: this.config.h(projected),
      requiredBarrier,
    };
  }

  private project(current: number, desired: number, requiredBarrier: number): number {
    const direction = desired >= current ? 1 : -1;
    let low = Math.min(current, desired) - Math.abs(desired - current) - 1;
    let high = Math.max(current, desired) + Math.abs(desired - current) + 1;
    for (let index = 0; index < 80; index += 1) {
      const mid = (low + high) / 2;
      const satisfies = this.config.h(mid) >= requiredBarrier;
      if (direction > 0) {
        if (satisfies) {
          low = mid;
        } else {
          high = mid;
        }
      } else if (satisfies) {
        high = mid;
      } else {
        low = mid;
      }
    }
    return direction > 0 ? low : high;
  }
}
