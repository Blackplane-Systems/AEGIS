import { CanonicalEvent } from '../../protocol/src';
import { BackendConnector, BackendScope } from './types';

/** Minimal producer interface compatible with Kafka-like clients without adding a dependency. */
export interface EventStreamProducer {
  send(record: {
    readonly topic: string;
    readonly key: string;
    readonly value: string;
    readonly headers?: Record<string, string>;
  }): Promise<void>;
}

/** Backend connector for Kafka-compatible or log-stream-compatible producers. */
export class StreamBackendConnector implements BackendConnector {
  public readonly scope: BackendScope = 'REMOTE';

  public constructor(
    public readonly id: string,
    private readonly topic: string,
    private readonly producer: EventStreamProducer,
  ) {}

  public async push(event: CanonicalEvent): Promise<void> {
    await this.producer.send({
      topic: this.topic,
      key: event.deviceId,
      value: JSON.stringify(event),
      headers: {
        sourceProtocol: event.sourceProtocol,
        timestamp: event.timestamp,
      },
    });
  }
}

/** Coordination registry interface compatible with ZooKeeper/etcd/Consul-style systems. */
export interface CoordinationRegistry {
  put(path: string, value: string): Promise<void>;
  get(path: string): Promise<string | undefined>;
}

/** Stores gateway membership and leader hints in an external coordination service. */
export class GatewayCoordinationClient {
  public constructor(
    private readonly registry: CoordinationRegistry,
    private readonly rootPath = '/aegis/gateways',
  ) {}

  public async registerGateway(
    gatewayId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.registry.put(`${this.rootPath}/${gatewayId}`, JSON.stringify(metadata));
  }

  public async readGateway(gatewayId: string): Promise<Record<string, unknown> | undefined> {
    const value = await this.registry.get(`${this.rootPath}/${gatewayId}`);
    return value === undefined ? undefined : (JSON.parse(value) as Record<string, unknown>);
  }
}
