import { erfc } from './math';

/** Survival observation with right-censoring support. */
export interface SurvivalObservation {
  readonly time: number;
  readonly event: boolean;
}

/** One Kaplan-Meier survival curve point. */
export interface SurvivalPoint {
  readonly time: number;
  readonly atRisk: number;
  readonly events: number;
  readonly censored: number;
  readonly survival: number;
}

/** Kaplan-Meier estimator implementing the exact product-limit formula. */
export class KaplanMeier {
  private readonly pointsValue: SurvivalPoint[];

  public constructor(observations: readonly SurvivalObservation[]) {
    this.pointsValue = fitCurve(observations);
  }

  /** Survival curve points. */
  public points(): readonly SurvivalPoint[] {
    return structuredClone(this.pointsValue);
  }

  /** Returns S(t) at the supplied time. */
  public survivalAt(time: number): number {
    let survival = 1;
    for (const point of this.pointsValue) {
      if (point.time <= time) {
        survival = point.survival;
      }
    }
    return survival;
  }

  /** Smallest t where S(t) <= 0.5, or Infinity if the median is not reached. */
  public medianSurvival(): number {
    return (
      this.pointsValue.find((point) => point.survival <= 0.5)?.time ?? Number.POSITIVE_INFINITY
    );
  }
}

/** Log-rank test result. */
export interface LogRankResult {
  readonly chiSquare: number;
  readonly pValue: number;
}

/** Compares two survival curves with a one-degree log-rank test. */
export function logRankTest(
  groupA: readonly SurvivalObservation[],
  groupB: readonly SurvivalObservation[],
): LogRankResult {
  const times = [
    ...new Set([...groupA, ...groupB].filter((obs) => obs.event).map((obs) => obs.time)),
  ].sort((a, b) => a - b);
  let observedA = 0;
  let expectedA = 0;
  let varianceA = 0;
  for (const time of times) {
    const riskA = groupA.filter((obs) => obs.time >= time).length;
    const riskB = groupB.filter((obs) => obs.time >= time).length;
    const eventsA = groupA.filter((obs) => obs.event && obs.time === time).length;
    const eventsB = groupB.filter((obs) => obs.event && obs.time === time).length;
    const riskTotal = riskA + riskB;
    const eventsTotal = eventsA + eventsB;
    if (riskTotal <= 1) {
      continue;
    }
    observedA += eventsA;
    expectedA += (eventsTotal * riskA) / riskTotal;
    varianceA +=
      (riskA * riskB * eventsTotal * (riskTotal - eventsTotal)) /
      (riskTotal ** 2 * (riskTotal - 1));
  }
  const chiSquare = varianceA === 0 ? 0 : (observedA - expectedA) ** 2 / varianceA;
  return {
    chiSquare,
    pValue: erfc(Math.sqrt(chiSquare / 2)),
  };
}

/** Firmware rollout survival gate. */
export function shouldHaltRolloutForSurvival(
  oldFirmware: KaplanMeier,
  newFirmware: KaplanMeier,
): boolean {
  const comparisonTime = oldFirmware.medianSurvival();
  return newFirmware.survivalAt(comparisonTime) < oldFirmware.survivalAt(comparisonTime);
}

function fitCurve(observations: readonly SurvivalObservation[]): SurvivalPoint[] {
  const sortedTimes = [...new Set(observations.map((obs) => obs.time))].sort((a, b) => a - b);
  let survival = 1;
  const points: SurvivalPoint[] = [];
  for (const time of sortedTimes) {
    const atRisk = observations.filter((obs) => obs.time >= time).length;
    const events = observations.filter((obs) => obs.time === time && obs.event).length;
    const censored = observations.filter((obs) => obs.time === time && !obs.event).length;
    if (events > 0 && atRisk > 0) {
      survival *= 1 - events / atRisk;
    }
    points.push({ time, atRisk, events, censored, survival });
  }
  return points;
}
