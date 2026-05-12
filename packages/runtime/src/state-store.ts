/** In-process typed key-value store for runtime device state. */
export class StateStore<TState extends Record<string, unknown> = Record<string, unknown>> {
  private readonly state = new Map<string, TState>();

  /** Sets the state for a device. */
  public set(deviceId: string, value: TState): void {
    this.state.set(deviceId, structuredClone(value));
  }

  /** Gets a cloned state object for a device. */
  public get(deviceId: string): TState | undefined {
    const value = this.state.get(deviceId);
    return value === undefined ? undefined : structuredClone(value);
  }

  /** Returns true if a state exists for the device. */
  public has(deviceId: string): boolean {
    return this.state.has(deviceId);
  }

  /** Deletes a state entry. */
  public delete(deviceId: string): boolean {
    return this.state.delete(deviceId);
  }

  /** Updates one field while preserving the rest of the state object. */
  public setField<K extends keyof TState>(deviceId: string, key: K, value: TState[K]): void {
    const current = this.get(deviceId) ?? ({} as TState);
    this.set(deviceId, { ...current, [key]: value });
  }

  /** Reads one typed field from a device state object. */
  public getField<K extends keyof TState>(deviceId: string, key: K): TState[K] | undefined {
    return this.get(deviceId)?.[key];
  }
}
