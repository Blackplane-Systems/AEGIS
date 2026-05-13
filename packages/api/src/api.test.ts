import { describe, expect, it } from 'vitest';
import { createAuditRecord } from '../../runtime/src';
import { generateEd25519KeyPair } from '../../trust/src';
import { TrustState } from '../../trust/src/state-machine';
import { FleetDashboardApi, createOperatorToken } from './index';

describe('FleetDashboardApi', () => {
  it('requires auth and serves every endpoint happy path', () => {
    const keys = generateEd25519KeyPair();
    const token = createOperatorToken(
      { operatorId: 'op', issuedAt: new Date().toISOString() },
      keys.privateKeyPem,
    );
    const api = new FleetDashboardApi(
      {
        devices: [
          {
            id: 'd1',
            trust: 0.9,
            state: TrustState.VALIDATED,
            lastSeen: '2026-01-01T00:00:00.000Z',
            trustDimensions: { identity: 1 },
            firmwareVersion: '1.0.0',
          },
        ],
        audit: {
          d1: [createAuditRecord({ deviceId: 'd1', type: 'TRUST_UPDATE', data: { trust: 0.9 } })],
        },
        anomalies: ['d1'],
        causality: { d1: ['d2'] },
        survival: { '1.0.0': [{ time: 1, survival: 1 }] },
      },
      keys.publicKeyPem,
      2,
    );
    const headers = { authorization: `Bearer ${token}` };
    expect(api.handle({ method: 'GET', path: '/devices', headers }).status).toBe(200);
    expect(api.handle({ method: 'GET', path: '/devices/d1', headers }).status).toBe(200);
    expect(api.handle({ method: 'GET', path: '/devices/d1/audit?limit=1', headers }).status).toBe(
      200,
    );
    expect(api.handle({ method: 'GET', path: '/fleet/anomalies', headers }).body).toEqual(['d1']);
    expect(api.handle({ method: 'GET', path: '/fleet/causality', headers }).body).toEqual({
      d1: ['d2'],
    });
    expect(
      api.handle({ method: 'GET', path: '/fleet/firmware/1.0.0/survival', headers }).status,
    ).toBe(200);
    expect(api.handle({ method: 'POST', path: '/devices/d1/quarantine', headers }).status).toBe(
      200,
    );
    expect(api.handle({ method: 'POST', path: '/devices/d1/rollback', headers }).status).toBe(200);
    expect(api.handle({ method: 'POST', path: '/devices/d1/rollback', headers }).status).toBe(429);
  });

  it('rejects unauthenticated requests for every route', () => {
    const keys = generateEd25519KeyPair();
    const api = new FleetDashboardApi(
      { devices: [], audit: {}, anomalies: [], causality: {}, survival: {} },
      keys.publicKeyPem,
    );
    for (const request of [
      { method: 'GET' as const, path: '/devices' },
      { method: 'GET' as const, path: '/devices/d1' },
      { method: 'GET' as const, path: '/devices/d1/audit?limit=1' },
      { method: 'GET' as const, path: '/fleet/anomalies' },
      { method: 'GET' as const, path: '/fleet/causality' },
      { method: 'GET' as const, path: '/fleet/firmware/1/survival' },
      { method: 'POST' as const, path: '/devices/d1/quarantine' },
      { method: 'POST' as const, path: '/devices/d1/rollback' },
    ]) {
      expect(api.handle(request).status).toBe(401);
    }
  });
});
