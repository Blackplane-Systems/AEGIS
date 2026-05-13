# AEGIS Operations Guide

## Enroll a Fleet

Run the CLI after installing dependencies and building the project:

```bash
npm install
npm run build
node dist/packages/cli/src/index.js enroll device-001
node dist/packages/cli/src/index.js status device-001
```

The CLI stores local harness state in `.aegis/state.json`, which is ignored by git.

## Tune Trust and Health Parameters

Use `createAegisConfig` from `packages/core` to override trust weights, thresholds, decay constants,
policy freshness, and actuation quorum/cooldown values. Trust weights must sum to exactly `1.0`;
startup validation throws when they do not.

Health detectors are configured independently:

- `CusumDetector({ mu0, sigma0, k, h })` for abrupt drift.
- `EwmaDetector({ mu0, sigma0, lambda, L })` for smoothed anomaly detection.
- `DriftScoreEngine({ sensorName: sensitivity })` for composite sensor integrity feedback.

## Configure Firmware Rollout

Create a `StagedRollout` with stages:

```ts
new StagedRollout({
  stages: [{ fraction: 0.3, window_ms: 60000, health_threshold: 0.1 }],
  failureThreshold: 0.1,
  epsilon: 0.1,
});
```

The controller rejects canaries smaller than `max(30, 0.01*fleetSize)`, excludes `QUARANTINED` and
`DEGRADED` devices from stage sampling, and halts with rollback on health, failure-rate, or survival
gates.

## Read the Dashboard API

Create an Ed25519 operator token with `createOperatorToken`, then pass it as:

```text
Authorization: Bearer <token>
```

Every API route requires the signed token. Write endpoints are rate-limited per operator.

Available routes:

- `GET /devices`
- `GET /devices/:id`
- `GET /devices/:id/audit?limit=N`
- `GET /fleet/anomalies`
- `GET /fleet/causality`
- `GET /fleet/firmware/:version/survival`
- `POST /devices/:id/quarantine`
- `POST /devices/:id/rollback`
