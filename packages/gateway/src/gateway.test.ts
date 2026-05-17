import { describe, expect, it } from 'vitest';
import { AegisGatewayHost } from './host';
import { createGatewayConfig } from './config';
import { EdgeGateway } from './gateway';
import { GatewayHttpApi, hashGatewayAdminToken } from './http-api';
import { createGatewayCredential } from './profiles';
import { encryptAesGcmPayload, sha256Hex, signHmacEnvelope } from './security';
import { MemoryBackendConnector } from './backend';
import { UniversalIngressEnvelope } from './types';
import { StreamBackendConnector } from './enterprise';
import { StaticReachabilityProbe } from './network-map';

describe('EdgeGateway production ingress', () => {
  it('accepts ESP32 HMAC telemetry over WiFi HTTP and fans out to local and remote backends', async () => {
    const secret = 'esp32-hmac-secret';
    const local = new MemoryBackendConnector('local-store', 'LOCAL');
    const remote = new MemoryBackendConnector('cloud-sync', 'REMOTE');
    const config = createGatewayConfig({
      credentials: [createGatewayCredential('esp32-1', 'ESP32', { hmacSecret: secret })],
    });
    const gateway = new EdgeGateway(config, [local, remote]);
    const unsigned: UniversalIngressEnvelope = {
      deviceId: 'esp32-1',
      transport: 'wifi_http',
      eventKind: 'TELEMETRY',
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceId: 1,
      payload: { capability: 'temperature', value: 23.5 },
      security: { mode: 'HMAC_SHA256', nonce: 'n-1' },
    };
    const envelope: UniversalIngressEnvelope = {
      ...unsigned,
      security: { ...unsigned.security, signature: signHmacEnvelope(unsigned, secret) },
    };

    const result = await gateway.ingest(envelope);

    expect(result.accepted).toBe(true);
    expect(result.backendDelivered).toBe(2);
    expect(local.events).toHaveLength(1);
    expect(remote.events).toHaveLength(1);
    expect(gateway.twinState('esp32-1')).toMatchObject({
      temperature: { value: 23.5 },
    });
  });

  it('permits configured open broadcast telemetry but rejects plaintext commands', async () => {
    const config = createGatewayConfig({ credentials: [], allowPlaintextFrom: ['broadcast_udp'] });
    const gateway = new EdgeGateway(config);
    const broadcast: UniversalIngressEnvelope = {
      deviceId: 'broadcast-sensor-1',
      transport: 'broadcast_udp',
      eventKind: 'TELEMETRY',
      timestamp: '2026-01-01T00:00:01.000Z',
      sequenceId: 'broadcast-1',
      payload: { capability: 'presence', value: true },
      broadcast: true,
      security: { mode: 'OPEN_BROADCAST' },
    };

    await expect(gateway.ingest(broadcast)).resolves.toMatchObject({
      accepted: true,
      plaintextAccepted: true,
    });
    await expect(
      gateway.ingest({ ...broadcast, eventKind: 'COMMAND', sequenceId: 'broadcast-2' }),
    ).rejects.toThrow(/Plaintext command/);
  });

  it('decrypts LoRa AES-GCM telemetry for constrained nodes', async () => {
    const aesKey = Buffer.alloc(32, 11).toString('base64');
    const encrypted = encryptAesGcmPayload({ capability: 'soil_moisture', value: 0.61 }, aesKey);
    const config = createGatewayConfig({
      credentials: [createGatewayCredential('lora-1', 'LORA_NODE', { aesKey })],
    });
    const gateway = new EdgeGateway(config);

    const result = await gateway.ingest({
      deviceId: 'lora-1',
      transport: 'lora',
      eventKind: 'SENSOR_EVENT',
      timestamp: '2026-01-01T00:00:02.000Z',
      sequenceId: 7,
      payload: encrypted.payload,
      security: {
        mode: 'AES_256_GCM',
        nonce: 'lora-nonce-1',
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
    });

    expect(result.event.payload).toMatchObject({ capability: 'soil_moisture', value: 0.61 });
    expect(gateway.twinState('lora-1')).toMatchObject({
      soil_moisture: { value: 0.61 },
    });
  });

  it('queues failed backend delivery and flushes it later', async () => {
    const secret = 'pi-hmac-secret';
    const remote = new MemoryBackendConnector('remote', 'REMOTE');
    remote.failOnce();
    const config = createGatewayConfig({
      credentials: [createGatewayCredential('pi-1', 'RASPBERRY_PI', { hmacSecret: secret })],
    });
    const gateway = new EdgeGateway(config, [remote]);
    const unsigned: UniversalIngressEnvelope = {
      deviceId: 'pi-1',
      transport: 'mqtt',
      eventKind: 'TELEMETRY',
      timestamp: '2026-01-01T00:00:03.000Z',
      sequenceId: 1,
      payload: { capability: 'cpu_load', value: 0.42 },
      security: { mode: 'HMAC_SHA256', nonce: 'pi-nonce-1' },
    };

    const result = await gateway.ingest({
      ...unsigned,
      security: { ...unsigned.security, signature: signHmacEnvelope(unsigned, secret) },
    });

    expect(result.backendQueued).toBe(1);
    expect(gateway.health()).toMatchObject({ pendingBackends: 1 });
    await gateway.flushBackends();
    expect(gateway.health()).toMatchObject({ pendingBackends: 0 });
    expect(remote.events).toHaveLength(1);
  });

  it('exposes authenticated gateway API controls without exposing key material', async () => {
    const token = 'operator-token';
    const config = createGatewayConfig({
      credentials: [createGatewayCredential('esp8266-1', 'ESP8266', { hmacSecret: 'secret' })],
      adminTokenSha256: hashGatewayAdminToken(token),
    });
    const gateway = new EdgeGateway(config);
    const api = new GatewayHttpApi(gateway, config);

    expect(await api.handle({ method: 'GET', path: '/api/health' })).toMatchObject({
      status: 401,
    });
    const authed = { authorization: `Bearer ${token}` };
    const credentials = await api.handle({
      method: 'GET',
      path: '/api/credentials',
      headers: authed,
    });

    expect(credentials.status).toBe(200);
    expect(JSON.stringify(credentials.body)).not.toContain('secret');
  });

  it('rejects replayed sequence numbers and unauthorized transports', async () => {
    const secret = 'esp8266-secret';
    const config = createGatewayConfig({
      credentials: [createGatewayCredential('esp8266-1', 'ESP8266', { hmacSecret: secret })],
    });
    const gateway = new EdgeGateway(config);
    const unsigned: UniversalIngressEnvelope = {
      deviceId: 'esp8266-1',
      transport: 'wifi_http',
      eventKind: 'TELEMETRY',
      timestamp: '2026-01-01T00:00:04.000Z',
      sequenceId: 1,
      payload: { capability: 'battery', value: 0.8 },
      security: { mode: 'HMAC_SHA256', nonce: 'esp8266-nonce-1' },
    };
    const envelope = {
      ...unsigned,
      security: { ...unsigned.security, signature: signHmacEnvelope(unsigned, secret) },
    };

    await expect(gateway.ingest(envelope)).resolves.toMatchObject({ accepted: true });
    await expect(gateway.ingest(envelope)).rejects.toThrow(/sequence_replay/);
    await expect(gateway.ingest({ ...envelope, transport: 'ble', sequenceId: 2 })).rejects.toThrow(
      /not allowed to use ble/,
    );
  });

  it('registers first-time devices through local password enrollment and issues certificates', async () => {
    const config = createGatewayConfig({
      credentials: [],
      adminTokenSha256: hashGatewayAdminToken('admin'),
    });
    const gateway = new EdgeGateway(config, [], {
      registrationPolicy: {
        authority: 'AEGIS_LOCAL',
        requireDeviceId: true,
        passwordSha256: sha256Hex('provision-me'),
      },
    });
    const api = new GatewayHttpApi(gateway, config);

    const rejected = await api.handle({
      method: 'POST',
      path: '/register',
      body: { deviceId: 'esp32-new', profile: 'ESP32', password: 'wrong' },
    });
    const accepted = await api.handle({
      method: 'POST',
      path: '/register',
      body: {
        deviceId: 'esp32-new',
        profile: 'ESP32',
        password: 'provision-me',
        capabilities: ['temperature'],
      },
    });

    expect(rejected.status).toBe(400);
    expect(accepted.status).toBe(201);
    expect(JSON.stringify(accepted.body)).toContain('-----BEGIN CERTIFICATE-----');
    expect(gateway.credentialSummary()).toHaveLength(1);
  });

  it('parses RS485-style multiplexed frames and processes multiple device payloads', async () => {
    const config = createGatewayConfig({
      credentials: [],
      allowPlaintextFrom: ['serial'],
    });
    const gateway = new EdgeGateway(config, [], {
      channels: [
        {
          id: 'rs485-main',
          transport: 'serial',
          segmentId: 'plant-floor-a',
          frameFormat: 'JSON_LINES',
          maxFrameBytes: 4096,
          requireDeviceIdentityInPayload: true,
          defaultSecurityMode: 'OPEN_BROADCAST',
        },
      ],
    });
    const frame = [
      {
        deviceId: 'arduino-1',
        sequenceId: 'a-1',
        timestamp: '2026-01-01T00:00:05.000Z',
        payload: { capability: 'flow', value: 10 },
      },
      {
        deviceId: 'arduino-2',
        sequenceId: 'a-2',
        timestamp: '2026-01-01T00:00:06.000Z',
        payload: { capability: 'pressure', value: 2.4 },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n');

    const results = await gateway.ingestChannelFrame('rs485-main', frame);

    expect(results).toHaveLength(2);
    expect(gateway.twinState('arduino-1')).toMatchObject({ flow: { value: 10 } });
    expect(gateway.twinState('arduino-2')).toMatchObject({ pressure: { value: 2.4 } });
  });

  it('learns network baselines, records verified attacks, and replays structured logs', async () => {
    const config = createGatewayConfig({ credentials: [] });
    const gateway = new EdgeGateway(config);
    for (let index = 0; index < 5; index += 1) {
      gateway.observeNetworkCondition({
        key: 'lan-a:mqtt',
        latencyMs: 10,
        packetLossRatio: 0.01,
        reconnects: 0,
        observedAt: `2026-01-01T00:00:0${index}.000Z`,
      });
    }
    const deviation = gateway.observeNetworkCondition({
      key: 'lan-a:mqtt',
      latencyMs: 100,
      packetLossRatio: 0.5,
      reconnects: 3,
      observedAt: '2026-01-01T00:00:10.000Z',
    });
    const attack = gateway.recordVerifiedAttack({
      type: 'SPOOFING',
      reason: 'confirmed duplicated identity on open wifi',
      indicators: ['duplicated identity'],
    });

    expect(deviation).toMatchObject({
      latencyDeviation: true,
      packetLossDeviation: true,
      reconnectDeviation: true,
    });
    expect(attack).toMatchObject({ type: 'SPOOFING', count: 1 });
    expect(gateway.replayLogs({ limit: 10 }).length).toBeGreaterThanOrEqual(2);
  });

  it('can be embedded as an SDK host and publish to a Kafka-like stream connector', async () => {
    const sent: unknown[] = [];
    const connector = new StreamBackendConnector('kafka', 'aegis.events', {
      async send(record) {
        sent.push(record);
      },
    });
    const config = createGatewayConfig({
      runMode: 'SDK_EMBEDDED',
      backendBinding: 'TIGHT',
      credentials: [],
      allowPlaintextFrom: ['broadcast_udp'],
      networkSegments: [
        {
          id: 'lan-a',
          kind: 'LOCAL_LAN',
          allowCloudEgress: true,
          allowPeerForwarding: true,
        },
      ],
    });
    const host = new AegisGatewayHost(config, [connector]);

    await host.gateway.ingest({
      deviceId: 'node-1',
      transport: 'broadcast_udp',
      eventKind: 'TELEMETRY',
      timestamp: '2026-01-01T00:00:11.000Z',
      sequenceId: 'sdk-1',
      payload: { capability: 'status', value: 'ok' },
      security: { mode: 'OPEN_BROADCAST' },
    });

    expect(host.descriptor()).toMatchObject({ runMode: 'SDK_EMBEDDED', backendBinding: 'TIGHT' });
    expect(sent).toHaveLength(1);
  });

  it('maintains topology, reachability, and route tables from observed traffic and probes', async () => {
    const probe = new StaticReachabilityProbe();
    probe.set('node-1', { reachable: true, latencyMs: 12 });
    const config = createGatewayConfig({
      credentials: [],
      allowPlaintextFrom: ['mqtt'],
      networkSegments: [
        {
          id: 'lan-a',
          kind: 'LOCAL_LAN',
          allowCloudEgress: true,
          allowPeerForwarding: true,
        },
      ],
    });
    const gateway = new EdgeGateway(config, [], { reachabilityProbe: probe });

    await gateway.ingest({
      deviceId: 'node-1',
      transport: 'mqtt',
      eventKind: 'TELEMETRY',
      timestamp: '2026-01-01T00:00:12.000Z',
      sequenceId: 'net-1',
      payload: { capability: 'status', value: 'ok' },
      metadata: {
        segmentId: 'lan-a',
        address: '192.168.1.22',
        routeMetric: 3,
      },
      security: { mode: 'OPEN_BROADCAST' },
    });
    const topology = gateway.networkTopology();
    const probeResult = await gateway.probeReachability({
      nodeId: 'node-1',
      address: '192.168.1.22',
      protocol: 'TCP',
      port: 1883,
    });

    expect(topology.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['aegis-gateway-local', 'lan-a', 'node-1']),
    );
    expect(topology.links[0]).toMatchObject({
      from: 'lan-a',
      to: 'node-1',
      kind: 'MQTT',
      routingProtocol: 'MQTT_BROKER',
    });
    expect(gateway.routeTable('node-1')[0]).toMatchObject({
      destination: 'node-1',
      nextHop: 'lan-a',
      protocol: 'MQTT_BROKER',
      metric: 3,
    });
    expect(probeResult).toMatchObject({ reachable: true, latencyMs: 12 });
    expect(gateway.networkTopology().nodes.find((node) => node.id === 'node-1')).toMatchObject({
      reachability: 'REACHABLE',
    });
  });

  it('exposes authenticated network map, routes, and reachability probe APIs', async () => {
    const probe = new StaticReachabilityProbe();
    probe.set('gateway-peer', { reachable: false, error: 'blocked' });
    const token = 'admin-token';
    const config = createGatewayConfig({
      credentials: [],
      adminTokenSha256: hashGatewayAdminToken(token),
    });
    const gateway = new EdgeGateway(config, [], { reachabilityProbe: probe });
    const api = new GatewayHttpApi(gateway, config);
    const headers = { authorization: `Bearer ${token}` };

    expect(await api.handle({ method: 'GET', path: '/api/network/map' })).toMatchObject({
      status: 401,
    });
    expect(await api.handle({ method: 'GET', path: '/api/network/map', headers })).toMatchObject({
      status: 200,
    });
    expect(await api.handle({ method: 'GET', path: '/api/network/routes', headers })).toMatchObject(
      {
        status: 200,
      },
    );
    const result = await api.handle({
      method: 'POST',
      path: '/api/network/probe',
      headers,
      body: { nodeId: 'gateway-peer', address: '10.0.0.2', protocol: 'TCP', port: 8080 },
    });

    expect(result).toMatchObject({ status: 202, body: { reachable: false } });
  });

  it('acts on learned lossy WAN conditions by keeping fanout local and recording actions', async () => {
    const local = new MemoryBackendConnector('local', 'LOCAL');
    const remote = new MemoryBackendConnector('cloud', 'REMOTE');
    const config = createGatewayConfig({
      credentials: [],
      allowPlaintextFrom: ['mqtt'],
      networkIntelligence: {
        enabled: true,
        mode: 'AUTO_SAFE',
        learnEveryObservation: true,
        actionLimit: 50,
        thresholds: {
          minSamples: 1,
          highLatencyMs: 500,
          highPacketLossRatio: 0.05,
          highReconnects: 3,
          latencyZScore: 3,
          packetLossZScore: 3,
          reconnectZScore: 3,
          routeFlapWindowMs: 60_000,
          routeFlapCount: 3,
          staleNodeMs: 120_000,
          preferredRouteScore: 0.7,
          openWifiPlaintextRisk: 0.65,
          highMulticastPacketsPerSecond: 500,
          controlPlaneAnomalyScore: 0.8,
        },
      },
    });
    const gateway = new EdgeGateway(config, [local, remote]);

    const result = await gateway.ingest({
      deviceId: 'wan-node-1',
      transport: 'mqtt',
      eventKind: 'TELEMETRY',
      timestamp: '2026-01-01T00:00:13.000Z',
      sequenceId: 'wan-1',
      payload: { capability: 'status', value: 'degraded' },
      metadata: {
        segmentId: 'wan-bridge',
        latencyMs: 900,
        packetLossRatio: 0.4,
        reconnects: 4,
        routingProtocol: 'OSPF',
      },
      security: { mode: 'OPEN_BROADCAST' },
    });

    expect(result.backendDelivered).toBe(1);
    expect(local.events).toHaveLength(1);
    expect(remote.events).toHaveLength(0);
    expect(gateway.networkIntelligenceSnapshot().findings.map((finding) => finding.type)).toEqual(
      expect.arrayContaining(['HIGH_PACKET_LOSS', 'HIGH_LATENCY', 'HIGH_RECONNECT_RATE']),
    );
    expect(gateway.networkIntelligenceSnapshot().actions.map((action) => action.type)).toEqual(
      expect.arrayContaining(['HOLD_REMOTE_FANOUT', 'THROTTLE_LOW_PRIORITY', 'PREFER_LOCAL_ROUTE']),
    );
  });

  it('maps aggregator streams into downstream device routes and detects identity collisions', async () => {
    const config = createGatewayConfig({
      credentials: [],
      allowPlaintextFrom: ['serial'],
      networkSegments: [
        {
          id: 'rs485-bus-a',
          kind: 'SERIAL_BUS',
          allowCloudEgress: false,
          allowPeerForwarding: true,
        },
      ],
    });
    const gateway = new EdgeGateway(config);

    await gateway.ingest({
      deviceId: 'aggregator-1',
      transport: 'serial',
      eventKind: 'TELEMETRY',
      timestamp: '2026-01-01T00:00:14.000Z',
      sequenceId: 'agg-1',
      payload: { capability: 'batch', value: 2 },
      metadata: {
        segmentId: 'rs485-bus-a',
        aggregatorId: 'aggregator-1',
        embeddedDeviceIds: ['leaf-1', 'leaf-2', 'aggregator-1'],
        routeMetric: 6,
      },
      security: { mode: 'OPEN_BROADCAST' },
    });

    expect(gateway.networkTopology().nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['aggregator-1', 'leaf-1', 'leaf-2']),
    );
    expect(gateway.routeTable('leaf-1')[0]).toMatchObject({
      destination: 'leaf-1',
      nextHop: 'aggregator-1',
      protocol: 'SERIAL_MULTIPLEX',
    });
    expect(gateway.networkIntelligenceSnapshot().findings.map((finding) => finding.type)).toContain(
      'AGGREGATOR_ID_COLLISION',
    );
  });

  it('serves a built-in UI and headless network intelligence APIs behind operator auth', async () => {
    const token = 'ui-token';
    const config = createGatewayConfig({
      credentials: [],
      adminTokenSha256: hashGatewayAdminToken(token),
    });
    const gateway = new EdgeGateway(config);
    const api = new GatewayHttpApi(gateway, config);
    const headers = { authorization: `Bearer ${token}` };

    expect(await api.handle({ method: 'GET', path: '/ui' })).toMatchObject({ status: 401 });
    const ui = await api.handle({ method: 'GET', path: `/ui?token=${token}` });
    expect(ui.status).toBe(200);
    expect(ui.contentType).toContain('text/html');
    expect(String(ui.body)).toContain('AEGIS Gateway Console');

    const observed = await api.handle({
      method: 'POST',
      path: '/api/network/observe',
      headers,
      body: {
        key: 'lan-a:ospf:uplink',
        layers: ['L3_IPV4', 'L4_TCP', 'CONTROL_ROUTING'],
        latencyMs: 10,
        packetLossRatio: 0,
        reconnects: 0,
        routingProtocol: 'OSPF',
      },
    });
    const intelligence = await api.handle({
      method: 'GET',
      path: '/api/network/intelligence',
      headers,
    });

    expect(observed.status).toBe(202);
    expect(intelligence).toMatchObject({
      status: 200,
      body: { enabled: true, topologyDigest: expect.any(Object) },
    });
  });

  it('supports industrial OT transports and exposes production readiness checks', async () => {
    const secret = 'plc-secret';
    const token = 'readiness-token';
    const config = createGatewayConfig({
      credentials: [createGatewayCredential('plc-1', 'PLC', { hmacSecret: secret })],
      adminTokenSha256: hashGatewayAdminToken(token),
      allowPlaintextFrom: [],
      networkSegments: [
        {
          id: 'cell-1',
          kind: 'LOCAL_LAN',
          allowCloudEgress: false,
          allowPeerForwarding: false,
        },
      ],
    });
    const gateway = new EdgeGateway(config);
    const api = new GatewayHttpApi(gateway, config);
    const unsigned: UniversalIngressEnvelope = {
      deviceId: 'plc-1',
      transport: 'modbus_tcp',
      eventKind: 'SENSOR_EVENT',
      timestamp: '2026-01-01T00:00:15.000Z',
      sequenceId: 'plc-1',
      payload: { capability: 'holding_registers', value: [1, 2, 3] },
      metadata: {
        segmentId: 'cell-1',
        routingProtocol: 'MODBUS_GATEWAY',
        latencyMs: 12,
        packetLossRatio: 0,
        reconnects: 0,
      },
      security: { mode: 'HMAC_SHA256', nonce: 'plc-nonce-1' },
    };

    await expect(
      gateway.ingest({
        ...unsigned,
        security: { ...unsigned.security, signature: signHmacEnvelope(unsigned, secret) },
      }),
    ).resolves.toMatchObject({ accepted: true });
    const readiness = await api.handle({
      method: 'GET',
      path: '/api/readiness',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(gateway.routeTable('plc-1')[0]).toMatchObject({
      protocol: 'MODBUS_GATEWAY',
      nextHop: 'cell-1',
    });
    expect(readiness).toMatchObject({
      status: 200,
      body: {
        supportedProtocols: expect.arrayContaining([expect.objectContaining({ id: 'modbus_tcp' })]),
        criticalGaps: [],
      },
    });
  });

  it('classifies multicast, rogue DHCP, and ARP anomalies from control-plane observations', () => {
    const config = createGatewayConfig({
      credentials: [],
      networkIntelligence: {
        enabled: true,
        mode: 'AUTO_SAFE',
        learnEveryObservation: true,
        actionLimit: 50,
        thresholds: {
          minSamples: 1,
          highLatencyMs: 500,
          highPacketLossRatio: 0.08,
          highReconnects: 3,
          latencyZScore: 3,
          packetLossZScore: 3,
          reconnectZScore: 3,
          routeFlapWindowMs: 60_000,
          routeFlapCount: 3,
          staleNodeMs: 120_000,
          preferredRouteScore: 0.7,
          openWifiPlaintextRisk: 0.65,
          highMulticastPacketsPerSecond: 100,
          controlPlaneAnomalyScore: 0.6,
        },
      },
    });
    const gateway = new EdgeGateway(config);

    const findings = gateway.observeNetworkIntelligence({
      key: 'lan-a:control-plane',
      layers: ['L3_IPV4', 'L3_ARP', 'CONTROL_DHCP', 'CONTROL_ROUTING'],
      multicastPacketsPerSecond: 250,
      controlPlaneAnomalyScore: 0.9,
      encrypted: false,
      metadata: {
        rogueDhcp: true,
        arpConflict: true,
        dhcpServer: '192.168.1.250',
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'MULTICAST_STORM' }),
        expect.objectContaining({ type: 'CONTROL_PLANE_ANOMALY' }),
        expect.objectContaining({ type: 'ROGUE_DHCP' }),
        expect.objectContaining({ type: 'ARP_SPOOFING' }),
      ]),
    );
    expect(gateway.networkIntelligenceSnapshot().actions.map((action) => action.type)).toEqual(
      expect.arrayContaining(['THROTTLE_LOW_PRIORITY', 'RAISE_OPERATOR_ALERT']),
    );
  });
});
