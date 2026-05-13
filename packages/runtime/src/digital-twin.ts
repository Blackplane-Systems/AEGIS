/** One telemetry observation stored by the digital twin manager. */
export interface TwinObservation {
  readonly deviceId: string;
  readonly capability: string;
  readonly value: unknown;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

/** Latest known state for one device capability. */
export interface TwinCapabilityState {
  readonly value: unknown;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

/** In-memory digital twin state and bounded telemetry history. */
export class DigitalTwinManager {
  private readonly state = new Map<string, Map<string, TwinCapabilityState>>();
  private readonly history = new Map<string, TwinObservation[]>();

  public constructor(private readonly historyLimit = 1000) {
    if (!Number.isInteger(historyLimit) || historyLimit <= 0) {
      throw new Error('DigitalTwinManager historyLimit must be a positive integer');
    }
  }

  /** Applies a telemetry observation to the latest twin state and bounded history. */
  public update(observation: TwinObservation): TwinCapabilityState {
    const deviceState =
      this.state.get(observation.deviceId) ?? new Map<string, TwinCapabilityState>();
    const capabilityState: TwinCapabilityState = {
      value: observation.value,
      timestamp: observation.timestamp,
      ...(observation.metadata === undefined ? {} : { metadata: observation.metadata }),
    };
    deviceState.set(observation.capability, capabilityState);
    this.state.set(observation.deviceId, deviceState);
    this.appendHistory(observation);
    return capabilityState;
  }

  /** Returns the latest state for all capabilities on a device. */
  public getState(deviceId: string): Record<string, TwinCapabilityState> {
    return Object.fromEntries(this.state.get(deviceId)?.entries() ?? []);
  }

  /** Returns the latest state for a single capability. */
  public getCapability(deviceId: string, capability: string): TwinCapabilityState | undefined {
    return this.state.get(deviceId)?.get(capability);
  }

  /** Returns recent history for a device, optionally narrowed to one capability. */
  public getHistory(
    deviceId: string,
    capability?: string,
    limit = this.historyLimit,
  ): readonly TwinObservation[] {
    const observations = this.history.get(deviceId) ?? [];
    const filtered =
      capability === undefined
        ? observations
        : observations.filter((observation) => observation.capability === capability);
    return filtered.slice(-Math.max(0, limit));
  }

  private appendHistory(observation: TwinObservation): void {
    const observations = this.history.get(observation.deviceId) ?? [];
    observations.push(observation);
    if (observations.length > this.historyLimit) {
      observations.splice(0, observations.length - this.historyLimit);
    }
    this.history.set(observation.deviceId, observations);
  }
}
