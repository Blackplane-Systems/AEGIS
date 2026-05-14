import { EdgeGateway } from './gateway';
import { createGatewayConfig } from './config';
import { GatewayHttpApi, createNodeGatewayServer, hashGatewayAdminToken } from './http-api';

/** Starts a local gateway process from environment variables. */
export function startGatewayFromEnv(): void {
  const adminToken = process.env.AEGIS_GATEWAY_ADMIN_TOKEN ?? 'local-dev-admin';
  const config = createGatewayConfig({
    mode: process.env.AEGIS_GATEWAY_MODE === 'LOCAL_ONLY' ? 'LOCAL_ONLY' : 'HYBRID',
    credentials: [],
    adminTokenSha256: hashGatewayAdminToken(adminToken),
  });
  const gateway = new EdgeGateway(config);
  const api = new GatewayHttpApi(gateway, config);
  const port = Number(process.env.AEGIS_GATEWAY_PORT ?? 8787);
  const host = process.env.AEGIS_GATEWAY_HOST ?? '127.0.0.1';
  createNodeGatewayServer(api, config.maxBodyBytes).listen(port, host, () => {
    process.stdout.write(`AEGIS gateway listening on http://${host}:${port}\n`);
  });
}

if (require.main === module) {
  startGatewayFromEnv();
}
