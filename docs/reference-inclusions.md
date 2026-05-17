# Reference Inclusion Review: ProtocolBridge IoT Gateway

The repository at `D:\Vibe code\iot gateway` was reviewed for features that fit AEGIS without
changing the production architecture. Its Python/FastAPI implementation was not copied directly;
the useful behavior was reimplemented as AEGIS-native TypeScript modules.

## Included

- WebSocket protocol normalization: added `WebSocketDeviceAdapter` for gateway-style telemetry
  messages carrying `device_id`, `capability`, `value`, `timestamp`, and metadata.
- Simulated BLE normalization: added `BleAdapter` for low-power or fake BLE telemetry streams.
- Runtime event bus: added a bounded async `EventBus` with subscribe/unsubscribe, recent log
  retention, and subscriber failure isolation.
- Device discovery: added `DeviceDiscoveryRegistry` to auto-register observed devices and merge
  protocols, capabilities, metadata, and last-seen timestamps.
- Digital twin state: added `DigitalTwinManager` for latest capability state plus bounded
  telemetry history.
- Dashboard API views: extended the signed fleet API with authenticated `/health`, `/logs`, and
  `/devices/:id/telemetry` endpoints.

## Not Included

- The reference automation engine overlaps with AEGIS policy/Rete evaluation, so it was not ported.
- JWT admin authentication is weaker than the existing Ed25519 operator token flow, so it was not
  included.
- The FastAPI/React stack was not adopted because AEGIS remains a TypeScript Node monorepo.
- SQLite persistence and browser WebSocket streaming are possible future extensions, but they require
  a broader storage and transport decision than this inclusion pass.
