/** Device observation used to auto-register unknown edge devices. */
export interface DeviceDiscoveryObservation {
  readonly deviceId: string;
  readonly protocol: string;
  readonly capability?: string;
  readonly metadata?: Record<string, unknown>;
  readonly observedAt?: string;
}

/** Device record maintained by the discovery registry. */
export interface DiscoveredDevice {
  readonly deviceId: string;
  readonly protocols: readonly string[];
  readonly capabilities: readonly string[];
  readonly metadata: Record<string, unknown>;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

/** In-memory registry for gateway-style auto-discovery and last-seen updates. */
export class DeviceDiscoveryRegistry {
  private readonly devices = new Map<string, DiscoveredDevice>();

  /** Creates or updates a device record from an observed telemetry event. */
  public discover(observation: DeviceDiscoveryObservation): DiscoveredDevice {
    if (observation.deviceId.length === 0) {
      throw new Error('Device discovery requires a deviceId');
    }
    const observedAt = observation.observedAt ?? new Date().toISOString();
    const current = this.devices.get(observation.deviceId);
    const protocols = new Set(current?.protocols ?? []);
    const capabilities = new Set(current?.capabilities ?? []);
    protocols.add(observation.protocol);
    if (observation.capability !== undefined) {
      capabilities.add(observation.capability);
    }
    const discovered: DiscoveredDevice = {
      deviceId: observation.deviceId,
      protocols: [...protocols].sort(),
      capabilities: [...capabilities].sort(),
      metadata: { ...(current?.metadata ?? {}), ...(observation.metadata ?? {}) },
      firstSeen: current?.firstSeen ?? observedAt,
      lastSeen: observedAt,
    };
    this.devices.set(observation.deviceId, discovered);
    return discovered;
  }

  /** Looks up one discovered device. */
  public get(deviceId: string): DiscoveredDevice | undefined {
    return this.devices.get(deviceId);
  }

  /** Lists all discovered devices ordered by device id for deterministic callers. */
  public list(): readonly DiscoveredDevice[] {
    return [...this.devices.values()].sort((left, right) =>
      left.deviceId.localeCompare(right.deviceId),
    );
  }
}
