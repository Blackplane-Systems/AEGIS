import { BackendConnector, GatewayConfig } from './types';
import { EdgeGateway, EdgeGatewayOptions } from './gateway';
import { GatewayHttpApi } from './http-api';

/** Host wrapper for using AEGIS as an SDK, standalone process, or backend sidecar. */
export class AegisGatewayHost {
  public readonly gateway: EdgeGateway;
  public readonly api: GatewayHttpApi;

  public constructor(
    public readonly config: GatewayConfig,
    backends: readonly BackendConnector[] = [],
    options: EdgeGatewayOptions = {},
  ) {
    this.gateway = new EdgeGateway(config, backends, options);
    this.api = new GatewayHttpApi(this.gateway, config);
  }

  /** Returns a compact runtime descriptor for service discovery and embedding checks. */
  public descriptor(): Record<string, unknown> {
    return {
      mode: this.config.mode,
      runMode: this.config.runMode,
      backendBinding: this.config.backendBinding,
      segments: this.config.networkSegments.map((segment) => ({
        id: segment.id,
        kind: segment.kind,
        cloud: segment.allowCloudEgress,
        peerForwarding: segment.allowPeerForwarding,
      })),
    };
  }
}
