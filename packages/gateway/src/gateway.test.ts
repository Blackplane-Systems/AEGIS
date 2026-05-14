import { describe, expect, it } from 'vitest';
import { createGatewayConfig } from './config';
import { EdgeGateway } from './gateway';
import { GatewayHttpApi, hashGatewayAdminToken } from './http-api';
import { createGatewayCredential } from './profiles';
import { encryptAesGcmPayload, signHmacEnvelope } from './security';
import { MemoryBackendConnector } from './backend';
import { UniversalIngressEnvelope } from './types';

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
});
