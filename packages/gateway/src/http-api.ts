import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { EdgeGateway } from './gateway';
import { renderGatewayDashboard } from './gateway-dashboard';
import { sha256Hex, verifyAdminToken } from './security';
import { GatewayConfig, UniversalIngressEnvelope } from './types';

/** HTTP-like request accepted by the dependency-free gateway API handler. */
export interface GatewayApiRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

/** HTTP-like response returned by the gateway API handler. */
export interface GatewayApiResponse {
  readonly status: number;
  readonly body: unknown;
  readonly contentType?: string;
}

/** Authenticated HTTP-style control plane for the optional edge gateway process. */
export class GatewayHttpApi {
  public constructor(
    private readonly gateway: EdgeGateway,
    private readonly config: GatewayConfig,
  ) {}

  /** Handles one request for tests, embedded servers, or the Node HTTP wrapper. */
  public async handle(request: GatewayApiRequest): Promise<GatewayApiResponse> {
    const url = new URL(request.path, 'http://aegis.gateway');
    const segments = url.pathname.split('/').filter(Boolean);
    if (request.method === 'POST' && segments[0] === 'ingest' && segments.length === 2) {
      const envelope = request.body as UniversalIngressEnvelope;
      if (envelope.transport !== segments[1]) {
        return { status: 400, body: { error: 'transport_path_mismatch' } };
      }
      try {
        const result = await this.gateway.ingest(envelope);
        return { status: 202, body: result };
      } catch (error) {
        return {
          status: 400,
          body: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    }
    if (request.method === 'POST' && segments[0] === 'channels' && segments[2] === 'frame') {
      try {
        return {
          status: 202,
          body: await this.gateway.ingestChannelFrame(segments[1]!, bodyToFrame(request.body)),
        };
      } catch (error) {
        return {
          status: 400,
          body: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    }
    if (request.method === 'POST' && url.pathname === '/register') {
      try {
        return { status: 201, body: await this.gateway.registerDevice(request.body as never) };
      } catch (error) {
        return {
          status: 400,
          body: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/ui')) {
      if (!this.config.ui.enabled) {
        return { status: 404, body: { error: 'ui_disabled' } };
      }
      if (this.config.ui.requireAuth && !this.isAuthorized(request)) {
        return { status: 401, body: { error: 'unauthorized' } };
      }
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: renderGatewayDashboard({
          health: this.gateway.health(),
          topology: this.gateway.networkTopology(),
          intelligence: this.gateway.networkIntelligenceSnapshot(),
        }),
      };
    }
    if (!this.isAuthorized(request)) {
      return { status: 401, body: { error: 'unauthorized' } };
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return { status: 200, body: this.gateway.health() };
    }
    if (request.method === 'GET' && url.pathname === '/api/devices') {
      return { status: 200, body: this.gateway.devices() };
    }
    if (request.method === 'GET' && url.pathname === '/api/credentials') {
      return { status: 200, body: this.gateway.credentialSummary() };
    }
    if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'twins') {
      return { status: 200, body: this.gateway.twinState(segments[2] ?? '') };
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      return {
        status: 200,
        body: this.gateway.recentEvents(Number(url.searchParams.get('limit') ?? 100)),
      };
    }
    if (request.method === 'GET' && url.pathname === '/api/logs') {
      return {
        status: 200,
        body: this.gateway.logs(Number(url.searchParams.get('limit') ?? 100)),
      };
    }
    if (request.method === 'GET' && url.pathname === '/api/replay') {
      return {
        status: 200,
        body: this.gateway.replayLogs({
          ...(url.searchParams.get('deviceId') === null
            ? {}
            : { deviceId: url.searchParams.get('deviceId')! }),
          ...(url.searchParams.get('channelId') === null
            ? {}
            : { channelId: url.searchParams.get('channelId')! }),
          ...(url.searchParams.get('since') === null
            ? {}
            : { since: url.searchParams.get('since')! }),
          ...(url.searchParams.get('until') === null
            ? {}
            : { until: url.searchParams.get('until')! }),
          limit: Number(url.searchParams.get('limit') ?? 100),
        }),
      };
    }
    if (request.method === 'GET' && url.pathname === '/api/attacks') {
      return { status: 200, body: this.gateway.attackSummaries() };
    }
    if (request.method === 'POST' && url.pathname === '/api/attacks/verified') {
      return { status: 202, body: this.gateway.recordVerifiedAttack(request.body as never) };
    }
    if (request.method === 'GET' && url.pathname === '/api/baselines') {
      return { status: 200, body: this.gateway.baselineSnapshot() };
    }
    if (request.method === 'POST' && url.pathname === '/api/baselines/observe') {
      return { status: 202, body: this.gateway.observeNetworkCondition(request.body as never) };
    }
    if (request.method === 'GET' && url.pathname === '/api/channels') {
      return { status: 200, body: this.gateway.channelSummary() };
    }
    if (request.method === 'GET' && url.pathname === '/api/network/map') {
      return { status: 200, body: this.gateway.networkTopology() };
    }
    if (request.method === 'GET' && url.pathname === '/api/network/intelligence') {
      return { status: 200, body: this.gateway.networkIntelligenceSnapshot() };
    }
    if (request.method === 'GET' && url.pathname === '/api/network/actions') {
      return { status: 200, body: this.gateway.networkIntelligenceSnapshot().actions };
    }
    if (request.method === 'POST' && url.pathname === '/api/network/observe') {
      return { status: 202, body: this.gateway.observeNetworkIntelligence(request.body as never) };
    }
    if (request.method === 'GET' && url.pathname === '/api/network/routes') {
      return {
        status: 200,
        body: this.gateway.routeTable(url.searchParams.get('destination') ?? undefined),
      };
    }
    if (request.method === 'POST' && url.pathname === '/api/network/probe') {
      return { status: 202, body: await this.gateway.probeReachability(request.body as never) };
    }
    if (request.method === 'POST' && url.pathname === '/api/backends/flush') {
      return { status: 200, body: await this.gateway.flushBackends() };
    }
    return { status: 404, body: { error: 'not_found' } };
  }

  private isAuthorized(request: GatewayApiRequest): boolean {
    if (this.config.publicHealth && request.method === 'GET' && request.path === '/api/health') {
      return true;
    }
    const url = new URL(request.path, 'http://aegis.gateway');
    const header = request.headers?.authorization ?? request.headers?.Authorization;
    const queryToken = url.searchParams.get('token') ?? undefined;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : queryToken;
    return verifyAdminToken(token, this.config.adminTokenSha256);
  }
}

function bodyToFrame(body: unknown): string | Buffer {
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return body;
  }
  return JSON.stringify(body);
}

/** Creates a Node HTTP server around the gateway API handler. */
export function createNodeGatewayServer(api: GatewayHttpApi, maxBodyBytes: number): Server {
  return createServer((request, response) => {
    void handleNodeRequest(api, maxBodyBytes, request, response);
  });
}

/** Hashes an operator token for gateway configuration. */
export function hashGatewayAdminToken(token: string): string {
  return sha256Hex(token);
}

async function handleNodeRequest(
  api: GatewayHttpApi,
  maxBodyBytes: number,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const body = await readBody(request, maxBodyBytes);
    const result = await api.handle({
      method: methodOf(request.method),
      path: request.url ?? '/',
      headers: headersOf(request.headers),
      ...(body === undefined ? {} : { body }),
    });
    response.writeHead(result.status, { 'content-type': result.contentType ?? 'application/json' });
    response.end(
      result.contentType?.startsWith('text/html')
        ? String(result.body)
        : JSON.stringify(result.body),
    );
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

function methodOf(method: string | undefined): 'GET' | 'POST' {
  return method === 'POST' ? 'POST' : 'GET';
}

function headersOf(headers: IncomingMessage['headers']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]),
  );
}

async function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  if (request.method !== 'POST') {
    return undefined;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > maxBodyBytes) {
      throw new Error('request body too large');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
