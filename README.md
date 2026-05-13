# AEGIS - Adaptive Edge Governance & Intelligence System

AEGIS is a production-grade foundation for trusted edge device fleets. This repository implements
device identity, trust scoring, protocol normalisation, deterministic local runtime behavior, policy
evaluation, actuation gating, fleet intelligence, simulation, authenticated APIs, and append-only
audit infrastructure.

For the full user and developer reference, read [`learning.md`](./learning.md). It provides
architecture explanations, flow diagrams, command walkthroughs, package internals, testing strategy,
and extension guidance.

## Chosen Stack

- TypeScript on Node 20+ for runtime, orchestration, policy, protocol, trust, and CLI layers.
- Analytics, runtime, orchestration, policy, protocol, trust, and CLI layers are implemented in
  TypeScript.
- Local state is in-process for runtime modules and JSON-backed for the CLI harness.

## Architecture

```text
packages/core
  shared AegisConfig, thresholds, named constants

packages/trust
  Ed25519 identity -> dev X.509v3 certificate -> trust score -> trust state machine

packages/protocol
  native MQTT/HTTP/serial payloads -> AdapterSpec -> CanonicalEvent

packages/policy
  structured JSON/YAML rules -> typed AST -> simplified Rete evaluator -> safe action

packages/runtime
  OfflineQueue -> EventLoop -> StateStore
  ActuationSafetyGate -> StructuredAuditLog
  Reconciliation for local/cloud state

packages/cli
  aegis enroll/status/simulate-event/audit/policy check
```

Dependency direction is intentionally one-way:

```text
core
  <- trust
  <- protocol
  <- policy
  <- runtime
       <- cli

integration tests compose trust + protocol + policy + runtime
```

## Quick Start

```bash
npm install
npm run build
npm run test
npm run lint
```

After building, the CLI can be run directly:

```bash
node dist/packages/cli/src/index.js enroll device-1
node dist/packages/cli/src/index.js status device-1
node dist/packages/cli/src/index.js simulate-event device-1 "{\"payload\":{\"temp\":21}}"
node dist/packages/cli/src/index.js audit device-1 --last 5
```

Policy dry run example:

```json
{
  "id": "trust-block",
  "when": { "type": "TRUST", "op": "<", "value": 0.75 },
  "then": { "kind": "BLOCK" }
}
```

```bash
node dist/packages/cli/src/index.js policy check rule.json "{\"trust\":0.2}"
```

## Test Coverage

- Trust identity tests cover Ed25519 generation, certificate issuance, expiry, rotation, Bayesian
  evidence updates, decay, and state-machine guards.
- Protocol tests cover MQTT QoS reliability, HTTP webhook payload rejection, raw serial JSON, field
  mapping, and reliability meet composition.
- Runtime tests cover offline queue eviction policies, backpressure, priority ordering, event-loop
  shutdown, state store CRUD, reconciliation, actuation gates, rollback, and Merkle audit verification.
- Policy tests cover parser variants, working memory, each built-in LTL template, and conflict
  resolution safety axioms.
- Integration tests cover the end-to-end happy path plus quarantined actuation, missing quorum, and
  reconnect reconciliation.
