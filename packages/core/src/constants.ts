/** Trust threshold for the VALIDATED trust state. */
export const TAU_VALIDATED = 0.75;

/** Trust threshold below which a device is considered degraded. */
export const TAU_DEGRADED = 0.4;

/** Trust threshold below which a device enters quarantine. */
export const TAU_QUARANTINE = 0.2;

/** Minimum trust below which identity rotation is required. */
export const TAU_MIN_ROTATION = 0.5;

/** Maximum certificate age for rotation in milliseconds. */
export const T_MAX_CERT_AGE_MS = 1000 * 60 * 60 * 24 * 90;

/** Default certificate validity for development fleet certificates. */
export const T_CERT_VALIDITY_MS = 1000 * 60 * 60 * 24 * 365;

/** Stable-sensor temporal decay constant from the trust specification example. */
export const LAMBDA_STABLE_SENSOR = 0.001;

/** Default stale-data freshness bound for policy checks in milliseconds. */
export const T_FRESHNESS_MAX_MS = 1000 * 60;

/** Default actuation cooldown in milliseconds. */
export const T_ACTUATION_COOLDOWN_MS = 1000;

/** Default quorum fleet size used by the actuation gate. */
export const QUORUM_DEFAULT_N = 3;

/** Default Byzantine fault bound used by the actuation gate. */
export const QUORUM_DEFAULT_F = 1;
