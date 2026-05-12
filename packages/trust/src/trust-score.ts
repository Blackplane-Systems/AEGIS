import {
  AegisConfig,
  LAMBDA_STABLE_SENSOR,
  TrustDimension,
  TrustWeights,
  assertTrustWeights,
  createAegisConfig,
} from '../../core/src';

/** Trust dimensions used in the composite weighted sum. */
export interface TrustScore extends Record<TrustDimension, number> {
  readonly identity: number;
  readonly attestation: number;
  readonly behavioural: number;
  readonly sensorIntegrity: number;
  readonly connectivity: number;
  readonly policyCompliance: number;
  readonly runtimeHealth: number;
}

/** Bayesian Beta distribution state for evidence updates. */
export interface BetaEvidence {
  readonly alpha: number;
  readonly beta: number;
}

/** Positive/negative evidence counts for a trust dimension. */
export interface TrustEvidence {
  readonly positive?: number;
  readonly negative?: number;
}

/** Computes composite, temporal, and Bayesian trust score updates. */
export class TrustScoreEngine {
  private readonly config: AegisConfig;

  public constructor(config: AegisConfig = createAegisConfig()) {
    assertTrustWeights(config.trustWeights);
    this.config = config;
  }

  /** Returns the weighted sum T(d,t) = sum(w_i * phi_i). */
  public compositeScore(
    score: TrustScore,
    weights: TrustWeights = this.config.trustWeights,
  ): number {
    assertTrustWeights(weights);
    return (Object.keys(weights) as TrustDimension[]).reduce(
      (total, dimension) => total + weights[dimension] * clamp01(score[dimension]),
      0,
    );
  }

  /** Applies exponential temporal decay T(d,t) = T(d,t0) * exp(-lambda * deltaSeconds). */
  public decayScore(score: number, deltaMs: number, deviceClass = 'stableSensor'): number {
    const lambda =
      this.config.decayLambdaByDeviceClass[deviceClass] ??
      this.config.decayLambdaByDeviceClass.stableSensor ??
      LAMBDA_STABLE_SENSOR;
    return clamp01(score * Math.exp(-lambda * (deltaMs / 1000)));
  }

  /** Applies Bayesian Beta update where positive evidence increments alpha and negative increments beta. */
  public updateEvidence(prior: BetaEvidence, evidence: TrustEvidence): BetaEvidence {
    return {
      alpha: prior.alpha + (evidence.positive ?? 0),
      beta: prior.beta + (evidence.negative ?? 0),
    };
  }

  /** Returns the posterior mean alpha / (alpha + beta). */
  public posteriorMean(evidence: BetaEvidence): number {
    const denominator = evidence.alpha + evidence.beta;
    if (denominator <= 0) {
      throw new Error('Posterior mean requires alpha + beta > 0');
    }
    return evidence.alpha / denominator;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
