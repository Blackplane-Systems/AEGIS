import { X509Certificate } from 'crypto';
import { describe, expect, it } from 'vitest';
import { createAegisConfig } from '../../core/src';
import {
  TrustScore,
  TrustScoreEngine,
  TrustState,
  TrustStateMachine,
  createDeviceIdentity,
  generateEd25519KeyPair,
  getPermittedActions,
  isCertificateValid,
  issueSelfSignedCertificate,
  shouldRotateCertificate,
} from './index';

describe('cryptographic identity', () => {
  it('generates Ed25519 key pairs and serialises certificates', () => {
    const keyPair = generateEd25519KeyPair();
    expect(keyPair.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(keyPair.privateKeyPem).toContain('BEGIN PRIVATE KEY');

    const cert = issueSelfSignedCertificate({
      deviceId: 'device-1',
      keyPair,
      now: new Date('2026-01-01T00:00:00.000Z'),
      validityMs: 1000,
    });
    const parsed = new X509Certificate(cert.pem);
    expect(parsed.subject).toContain('CN=device-1');
    expect(cert.version).toBe(3);
    expect(isCertificateValid(cert, new Date('2026-01-01T00:00:00.500Z'))).toBe(true);
  });

  it('detects expiry and rotation triggers', () => {
    const { identity } = createDeviceIdentity(
      'device-2',
      ['sense'],
      ['line-a'],
      createAegisConfig({
        identity: { maxCertificateAgeMs: 1000, certificateValidityMs: 1000 },
      }),
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(isCertificateValid(identity.cert, new Date('2026-01-01T00:00:02.000Z'))).toBe(false);
    expect(
      shouldRotateCertificate({
        identity,
        trust: 0.9,
        now: new Date('2026-01-01T00:00:02.000Z'),
        config: createAegisConfig({
          identity: { maxCertificateAgeMs: 1000, certificateValidityMs: 1000 },
        }),
      }),
    ).toBe(true);
    expect(shouldRotateCertificate({ identity, trust: 0.1 })).toBe(true);
    expect(shouldRotateCertificate({ identity, trust: 0.9, forced: true })).toBe(true);
  });
});

describe('trust score engine', () => {
  const score: TrustScore = {
    identity: 1,
    attestation: 1,
    behavioural: 0.5,
    sensorIntegrity: 0.5,
    connectivity: 1,
    policyCompliance: 0.8,
    runtimeHealth: 0.7,
  };

  it('computes weighted score and enforces weight normalisation', () => {
    const engine = new TrustScoreEngine();
    expect(engine.compositeScore(score)).toBeCloseTo(0.79);
    expect(
      () =>
        new TrustScoreEngine(
          createAegisConfig({
            trustWeights: {
              identity: 1,
              attestation: 1,
              behavioural: 1,
              sensorIntegrity: 1,
              connectivity: 1,
              policyCompliance: 1,
              runtimeHealth: 1,
            },
          }),
        ),
    ).toThrow(/sum to 1.0/);
  });

  it('applies decay and Bayesian evidence updates', () => {
    const engine = new TrustScoreEngine(
      createAegisConfig({ decayLambdaByDeviceClass: { stableSensor: 0.1 } }),
    );
    expect(engine.decayScore(1, 10_000, 'stableSensor')).toBeCloseTo(Math.exp(-1));
    const posterior = engine.updateEvidence({ alpha: 1, beta: 1 }, { positive: 3, negative: 1 });
    expect(posterior).toEqual({ alpha: 4, beta: 2 });
    expect(engine.posteriorMean(posterior)).toBeCloseTo(4 / 6);
  });
});

describe('trust state machine', () => {
  it('accepts every valid transition and records history', () => {
    const machine = new TrustStateMachine();
    expect(machine.transition(TrustState.PROVISIONED, { score: 0.6 })).toBe(TrustState.PROVISIONED);
    expect(machine.transition(TrustState.VALIDATED, { score: 0.9, attested: true })).toBe(
      TrustState.VALIDATED,
    );
    expect(machine.transition(TrustState.CONSTRAINED, { score: 0.6, attested: false })).toBe(
      TrustState.CONSTRAINED,
    );
    expect(machine.transition(TrustState.DEGRADED, { score: 0.3 })).toBe(TrustState.DEGRADED);
    expect(machine.transition(TrustState.CONSTRAINED, { score: 0.5 })).toBe(TrustState.CONSTRAINED);
    expect(machine.transition(TrustState.QUARANTINED, { score: 0.1 })).toBe(TrustState.QUARANTINED);
    expect(machine.transition(TrustState.REVOKED, { score: 0.9, operatorOverride: 'revoke' })).toBe(
      TrustState.REVOKED,
    );
    expect(machine.history).toHaveLength(7);
  });

  it('rejects invalid transitions and exposes Moore outputs', () => {
    const machine = new TrustStateMachine();
    expect(() => machine.transition(TrustState.VALIDATED, { score: 0.9, attested: true })).toThrow(
      /Invalid transition/,
    );
    machine.transition(TrustState.PROVISIONED, { score: 0.8 });
    expect(() => machine.transition(TrustState.VALIDATED, { score: 0.7, attested: true })).toThrow(
      /Invalid transition/,
    );
    expect(getPermittedActions(TrustState.VALIDATED)).toContain('request_actuation');
    expect(getPermittedActions(TrustState.QUARANTINED)).not.toContain('request_actuation');
    expect(getPermittedActions(TrustState.REVOKED)).toEqual([]);
  });
});
