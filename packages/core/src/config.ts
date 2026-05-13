import {
  LAMBDA_STABLE_SENSOR,
  QUORUM_DEFAULT_F,
  QUORUM_DEFAULT_N,
  T_ACTUATION_COOLDOWN_MS,
  T_CERT_VALIDITY_MS,
  T_FRESHNESS_MAX_MS,
  T_MAX_CERT_AGE_MS,
  TAU_DEGRADED,
  TAU_MIN_ROTATION,
  TAU_QUARANTINE,
  TAU_VALIDATED,
} from './constants';

/** Seven trust dimensions required by the AEGIS trust score formula. */
export type TrustDimension =
  | 'identity'
  | 'attestation'
  | 'behavioural'
  | 'sensorIntegrity'
  | 'connectivity'
  | 'policyCompliance'
  | 'runtimeHealth';

/** Weighted trust dimensions; values must sum to exactly 1.0 within floating-point tolerance. */
export type TrustWeights = Record<TrustDimension, number>;

/** Device class name used to select a decay constant. */
export type DeviceClass = 'stableSensor' | 'mobileActuator' | 'criticalController' | string;

/** Operator-configurable trust thresholds. */
export interface TrustThresholds {
  readonly validated: number;
  readonly degraded: number;
  readonly quarantine: number;
  readonly rotationMinTrust: number;
}

/** Operator-configurable identity certificate settings. */
export interface IdentityConfig {
  readonly maxCertificateAgeMs: number;
  readonly certificateValidityMs: number;
}

/** Operator-configurable actuation gate settings. */
export interface ActuationConfig {
  readonly minTrust: number;
  readonly cooldownMs: number;
  readonly quorumN: number;
  readonly quorumF: number;
}

/** Operator-configurable policy evaluation settings. */
export interface PolicyConfig {
  readonly maxEventAgeMs: number;
  readonly strictSignedRules: boolean;
}

/** Complete AEGIS configuration object. */
export interface AegisConfig {
  readonly trustWeights: TrustWeights;
  readonly decayLambdaByDeviceClass: Record<DeviceClass, number>;
  readonly trustThresholds: TrustThresholds;
  readonly identity: IdentityConfig;
  readonly actuation: ActuationConfig;
  readonly policy: PolicyConfig;
}

const DEFAULT_TRUST_WEIGHTS: TrustWeights = {
  identity: 0.2,
  attestation: 0.15,
  behavioural: 0.15,
  sensorIntegrity: 0.15,
  connectivity: 0.1,
  policyCompliance: 0.15,
  runtimeHealth: 0.1,
};

/** Default operator configuration. */
export const DEFAULT_AEGIS_CONFIG: AegisConfig = {
  trustWeights: DEFAULT_TRUST_WEIGHTS,
  decayLambdaByDeviceClass: {
    stableSensor: LAMBDA_STABLE_SENSOR,
    mobileActuator: 0.002,
    criticalController: 0.0005,
  },
  trustThresholds: {
    validated: TAU_VALIDATED,
    degraded: TAU_DEGRADED,
    quarantine: TAU_QUARANTINE,
    rotationMinTrust: TAU_MIN_ROTATION,
  },
  identity: {
    maxCertificateAgeMs: T_MAX_CERT_AGE_MS,
    certificateValidityMs: T_CERT_VALIDITY_MS,
  },
  actuation: {
    minTrust: TAU_VALIDATED,
    cooldownMs: T_ACTUATION_COOLDOWN_MS,
    quorumN: QUORUM_DEFAULT_N,
    quorumF: QUORUM_DEFAULT_F,
  },
  policy: {
    maxEventAgeMs: T_FRESHNESS_MAX_MS,
    strictSignedRules: false,
  },
};

/** Throws when trust weights do not sum to 1.0. */
export function assertTrustWeights(weights: TrustWeights): void {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(total - 1) > Number.EPSILON * 16) {
    throw new Error(`Trust weights must sum to 1.0; received ${total}`);
  }
}

/** Creates an AEGIS config from partial overrides and validates trust weights at startup. */
export function createAegisConfig(overrides: Partial<AegisConfig> = {}): AegisConfig {
  const trustWeights = {
    ...DEFAULT_AEGIS_CONFIG.trustWeights,
    ...overrides.trustWeights,
  };
  const config: AegisConfig = {
    trustWeights,
    decayLambdaByDeviceClass: {
      ...DEFAULT_AEGIS_CONFIG.decayLambdaByDeviceClass,
      ...overrides.decayLambdaByDeviceClass,
    },
    trustThresholds: {
      ...DEFAULT_AEGIS_CONFIG.trustThresholds,
      ...overrides.trustThresholds,
    },
    identity: {
      ...DEFAULT_AEGIS_CONFIG.identity,
      ...overrides.identity,
    },
    actuation: {
      ...DEFAULT_AEGIS_CONFIG.actuation,
      ...overrides.actuation,
    },
    policy: {
      ...DEFAULT_AEGIS_CONFIG.policy,
      ...overrides.policy,
    },
  };
  assertTrustWeights(config.trustWeights);
  return config;
}
