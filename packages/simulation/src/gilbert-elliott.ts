import { SeededRandom } from '../../analytics/src';

/** Gilbert-Elliott channel state. */
export type ChannelState = 'GOOD' | 'BAD';

/** Channel transition and loss configuration. */
export interface GilbertElliottConfig {
  readonly p: number;
  readonly q: number;
  readonly k: number;
  readonly h: number;
  readonly initialState?: ChannelState;
  readonly seed?: number;
}

/** Packet transmission result. */
export interface TransmissionResult<T> {
  readonly packet: T;
  readonly delivered: boolean;
  readonly state: ChannelState;
}

/** Two-state Gilbert-Elliott network impairment simulator. */
export class GilbertElliottChannel {
  private stateValue: ChannelState;
  private readonly rng: SeededRandom;

  public constructor(private readonly config: GilbertElliottConfig) {
    this.stateValue = config.initialState ?? 'GOOD';
    this.rng = new SeededRandom(config.seed ?? 1);
  }

  /** Current channel state. */
  public get state(): ChannelState {
    return this.stateValue;
  }

  /** Transmits a packet with state transition and state-dependent loss. */
  public transmit<T>(packet: T): TransmissionResult<T> {
    if (this.stateValue === 'GOOD' && this.rng.next() < this.config.p) {
      this.stateValue = 'BAD';
    } else if (this.stateValue === 'BAD' && this.rng.next() < this.config.q) {
      this.stateValue = 'GOOD';
    }
    const lossProbability = this.stateValue === 'GOOD' ? this.config.k : this.config.h;
    return {
      packet,
      state: this.stateValue,
      delivered: this.rng.next() >= lossProbability,
    };
  }
}

/** Preset Gilbert-Elliott impairment profiles. */
export function gilbertElliottPreset(profile: 'bursty' | 'random', seed = 1): GilbertElliottConfig {
  if (profile === 'bursty') {
    return { p: 0.01, q: 0.1, k: 0, h: 0.7, seed };
  }
  return { p: 0, q: 1, k: 0.1, h: 0.1, seed };
}

/** Theoretical steady-state good probability. */
export function steadyStateGoodProbability(config: GilbertElliottConfig): number {
  return config.q / (config.p + config.q);
}

/** Theoretical steady-state loss probability. */
export function steadyStateLossProbability(config: GilbertElliottConfig): number {
  const piGood = steadyStateGoodProbability(config);
  return piGood * config.k + (1 - piGood) * config.h;
}
