# AEGIS - Adaptive Edge Governance & Intelligence System

AEGIS is a production-grade foundation for trusted edge device fleets. This repository implements
device identity, trust scoring, protocol normalisation, deterministic local runtime behavior, policy
evaluation, actuation gating, fleet intelligence, simulation, adaptive gateway networking,
authenticated APIs, and append-only audit infrastructure.

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
  MQTT/HTTP/serial/industrial/control-plane payloads -> AdapterSpec -> CanonicalEvent
  ProtocolProfile catalog -> classification -> readiness controls

packages/policy
  structured JSON/YAML rules -> typed AST -> simplified Rete evaluator -> safe action

packages/runtime
  OfflineQueue -> EventLoop -> StateStore
  ActuationSafetyGate -> StructuredAuditLog
  Reconciliation for local/cloud state

packages/gateway
  UniversalIngressEnvelope -> security/replay checks -> NetworkMap
  NetworkIntelligenceEngine -> blocker classification -> safe actions
  Built-in operator UI + headless gateway APIs

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
       <- gateway
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

## Gateway And Network Intelligence

AEGIS can run embedded as an SDK, as a standalone Raspberry Pi style gateway, as a sidecar beside an
existing backend, as a local-only LAN controller, or as a cloud control-plane component. The gateway
accepts universal ingress envelopes from MQTT, HTTP, WebSocket, BLE bridges, LoRa concentrators,
ESP-NOW bridges, serial streams, RS485-style aggregators, and broadcast UDP.

The adaptive network intelligence layer observes topology, reachability, route metrics, packet loss,
latency, reconnects, routing metadata, VLAN or NAT symptoms, DHCP/SLAAC churn, open WiFi broadcast
traffic, and aggregator payload structure. It maintains learned baselines, classifies blockers such
as firewall drops or missing port forwarding, scores routes, and emits safe action plans. In
`AUTO_SAFE` mode the gateway can hold remote fanout, prefer local routes, or throttle low-priority
traffic while preserving local processing.

Protocol normalization covers more than MQTT and HTTP. The protocol package includes adapters for
raw serial, WebSocket, BLE, UDP datagrams, LoRa packets, ESP-NOW frames, and network control-plane
observations. The control-plane adapter lets a gateway feed ARP, IGMP, DHCP, SLAAC, NDP, OSPF, BGP,
RIP, multicast listener, or similar observations into the same canonical event model used by device
telemetry.

The public protocol layer now also includes production-safe OT and building-automation coverage:
CoAP, Modbus TCP, Modbus RTU, OPC UA PubSub, BACnet/IP, DNP3, CAN bus, Zigbee, PROFINET, and
EtherNet/IP gateway observations. These adapters normalize gateway-represented payloads into the
same `CanonicalEvent` contract and attach protocol metadata such as unit ids, function codes, node
ids, BACnet object ids, CAN arbitration ids, DNP3 point indexes, and CIP service names. The
`ProtocolProfile` catalog records family, reliability, expected identity fields, security posture,
known operational risks, and recommended controls for each supported protocol.

The gateway also exposes a production readiness advisor. It evaluates identity configuration,
operator access, transport security, replay controls, segmentation, protocol coverage, adaptive
network intelligence, backend binding, and diagnostic retention. The report is available through the
SDK and the authenticated HTTP API, making it suitable for CI gates, dashboards, and deployment
preflight checks.

After building, a standalone gateway process can be started with:

```bash
set AEGIS_GATEWAY_ADMIN_TOKEN=local-dev-admin
npm run gateway
```

The built-in operator UI is served at:

```text
http://127.0.0.1:8787/ui?token=local-dev-admin
```

Headless integrations can use the authenticated network endpoints:

```text
GET  /api/network/map
GET  /api/network/routes
GET  /api/network/intelligence
GET  /api/network/actions
GET  /api/readiness
POST /api/network/probe
POST /api/network/observe
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
- Gateway tests cover mixed transport ingress, backend fanout, registration, replay rejection,
  network topology, reachability probing, adaptive network actions, aggregator downstream routing,
  and the built-in authenticated UI.
