import { CausalityGraph } from '../../analytics/src';
import { AuditRecord } from '../../runtime/src';
import { TrustState } from '../../trust/src';
import { verifyOperatorToken } from './operator-token';

/** Device detail returned by the fleet dashboard API. */
export interface ApiDevice {
  readonly id: string;
  readonly trust: number;
  readonly state: TrustState;
  readonly lastSeen: string;
  readonly trustDimensions?: Record<string, number>;
  readonly firmwareVersion?: string;
}

/** HTTP-like API request used by tests and adapters. */
export interface ApiRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly headers?: Record<string, string>;
}

/** HTTP-like API response. */
export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

/** In-memory data backing the fleet dashboard API. */
export interface FleetApiData {
  readonly devices: ApiDevice[];
  readonly audit: Record<string, readonly AuditRecord[]>;
  readonly anomalies: readonly string[];
  readonly causality: CausalityGraph;
  readonly survival: Record<string, unknown>;
  readonly telemetry?: Record<string, readonly unknown[]>;
  readonly logs?: readonly unknown[];
  readonly health?: Record<string, unknown>;
}

/** Dependency-free REST-style fleet dashboard API with signed-token auth and write rate limiting. */
export class FleetDashboardApi {
  private readonly writeCounts = new Map<string, number>();

  public constructor(
    private readonly data: FleetApiData,
    private readonly operatorPublicKeyPem: string,
    private readonly writeLimit = 3,
  ) {}

  /** Handles one REST request. */
  public handle(request: ApiRequest): ApiResponse {
    const auth = this.authenticate(request);
    if (auth === null) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    if (request.method === 'POST' && !this.allowWrite(auth.operatorId)) {
      return { status: 429, body: { error: 'rate_limited' } };
    }
    const url = new URL(request.path, 'http://aegis.local');
    const segments = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && url.pathname === '/health') {
      return { status: 200, body: this.data.health ?? { status: 'ok' } };
    }
    if (request.method === 'GET' && url.pathname === '/logs') {
      const count = Number(url.searchParams.get('count') ?? 100);
      return { status: 200, body: (this.data.logs ?? []).slice(-count) };
    }
    if (request.method === 'GET' && url.pathname === '/devices') {
      return { status: 200, body: this.data.devices };
    }
    if (request.method === 'GET' && segments[0] === 'devices' && segments.length === 2) {
      return this.deviceDetail(segments[1]!);
    }
    if (request.method === 'GET' && segments[0] === 'devices' && segments[2] === 'audit') {
      const limit = Number(url.searchParams.get('limit') ?? 10);
      return { status: 200, body: (this.data.audit[segments[1]!] ?? []).slice(-limit) };
    }
    if (request.method === 'GET' && segments[0] === 'devices' && segments[2] === 'telemetry') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      return { status: 200, body: (this.data.telemetry?.[segments[1]!] ?? []).slice(-limit) };
    }
    if (request.method === 'GET' && url.pathname === '/fleet/anomalies') {
      return { status: 200, body: this.data.anomalies };
    }
    if (request.method === 'GET' && url.pathname === '/fleet/causality') {
      return { status: 200, body: this.data.causality };
    }
    if (
      request.method === 'GET' &&
      segments[0] === 'fleet' &&
      segments[1] === 'firmware' &&
      segments[3] === 'survival'
    ) {
      return { status: 200, body: this.data.survival[segments[2]!] ?? null };
    }
    if (request.method === 'POST' && segments[0] === 'devices' && segments[2] === 'quarantine') {
      const device = this.data.devices.find((item) => item.id === segments[1]);
      return device === undefined
        ? { status: 404, body: { error: 'not_found' } }
        : { status: 200, body: { id: device.id, state: TrustState.QUARANTINED } };
    }
    if (request.method === 'POST' && segments[0] === 'devices' && segments[2] === 'rollback') {
      return { status: 200, body: { id: segments[1], rollback: 'triggered' } };
    }
    return { status: 404, body: { error: 'not_found' } };
  }

  private authenticate(request: ApiRequest): { readonly operatorId: string } | null {
    const header = request.headers?.authorization ?? request.headers?.Authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    return token === undefined ? null : verifyOperatorToken(token, this.operatorPublicKeyPem);
  }

  private allowWrite(operatorId: string): boolean {
    const count = this.writeCounts.get(operatorId) ?? 0;
    if (count >= this.writeLimit) {
      return false;
    }
    this.writeCounts.set(operatorId, count + 1);
    return true;
  }

  private deviceDetail(deviceId: string): ApiResponse {
    const device = this.data.devices.find((item) => item.id === deviceId);
    return device === undefined
      ? { status: 404, body: { error: 'not_found' } }
      : { status: 200, body: device };
  }
}
