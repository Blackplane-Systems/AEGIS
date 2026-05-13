import { KaplanMeier } from '../../analytics/src';
import { TrustState } from '../../trust/src';

/** One firmware rollout stage. */
export interface RolloutStage {
  readonly fraction: number;
  readonly window_ms: number;
  readonly health_threshold: number;
}

/** Device state tracked by the staged rollout controller. */
export interface RolloutDevice {
  readonly id: string;
  readonly state: TrustState;
  readonly trust: number;
  readonly version: string;
}

/** Staged rollout configuration. */
export interface StagedRolloutConfig {
  readonly stages: readonly RolloutStage[];
  readonly epsilon?: number;
  readonly failureThreshold?: number;
}

/** Result for one rollout stage. */
export interface StageResult {
  readonly halted: boolean;
  readonly rolledBack: readonly string[];
  readonly promoted: readonly string[];
  readonly reason?: string;
}

/** Firmware staged rollout controller with canary, health, failure, and survival gates. */
export class StagedRollout {
  private readonly promoted = new Map<string, string>();
  private halted = false;

  public constructor(private readonly config: StagedRolloutConfig) {}

  /** Enforces |D_canary| >= max(30, 0.01*|D|). */
  public assertCanaryInvariant(fleetSize: number, canarySize: number): void {
    const minimum = Math.max(30, Math.ceil(0.01 * fleetSize));
    if (canarySize < minimum) {
      throw new Error(`Canary too small: ${canarySize} < ${minimum}`);
    }
  }

  /** Selects eligible devices for a stage, excluding quarantined and degraded devices. */
  public sampleStage(
    fleet: readonly RolloutDevice[],
    stageIndex: number,
  ): readonly RolloutDevice[] {
    const stage = this.config.stages[stageIndex];
    if (stage === undefined) {
      throw new Error(`Unknown rollout stage ${stageIndex}`);
    }
    const eligible = fleet.filter(
      (device) => device.state !== TrustState.QUARANTINED && device.state !== TrustState.DEGRADED,
    );
    const count = Math.ceil(eligible.length * stage.fraction);
    if (stageIndex === 0) {
      this.assertCanaryInvariant(fleet.length, count);
    }
    return eligible.slice(0, count);
  }

  /** Deploys and evaluates one stage. */
  public runStage(input: {
    readonly fleet: readonly RolloutDevice[];
    readonly stageIndex: number;
    readonly targetVersion: string;
    readonly failures: readonly string[];
    readonly postTrust: Record<string, number>;
    readonly oldSurvival?: KaplanMeier;
    readonly newSurvival?: KaplanMeier;
  }): StageResult {
    if (this.halted) {
      return { halted: true, promoted: [], rolledBack: [], reason: 'ALREADY_HALTED' };
    }
    const stageDevices = this.sampleStage(input.fleet, input.stageIndex);
    const promoted = stageDevices.map((device) => device.id);
    for (const device of stageDevices) {
      this.promoted.set(device.id, device.version);
    }
    const stage = this.config.stages[input.stageIndex]!;
    const failureRate = input.failures.length / Math.max(1, stageDevices.length);
    const meanPre = mean(stageDevices.map((device) => device.trust));
    const meanPost = mean(stageDevices.map((device) => input.postTrust[device.id] ?? device.trust));
    const healthDelta = meanPost - meanPre;
    const survivalHalt =
      input.oldSurvival !== undefined &&
      input.newSurvival !== undefined &&
      input.newSurvival.medianSurvival() < input.oldSurvival.medianSurvival();
    if (
      healthDelta < -(this.config.epsilon ?? stage.health_threshold) ||
      failureRate > (this.config.failureThreshold ?? 0.1) ||
      survivalHalt
    ) {
      this.halted = true;
      return {
        halted: true,
        promoted,
        rolledBack: this.rollback(promoted),
        reason: survivalHalt
          ? 'SURVIVAL_GATE'
          : failureRate > (this.config.failureThreshold ?? 0.1)
            ? 'FAILURE_RATE'
            : 'HEALTH_DELTA',
      };
    }
    return { halted: false, promoted, rolledBack: [] };
  }

  private rollback(devices: readonly string[]): readonly string[] {
    return devices.filter((device) => this.promoted.has(device));
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
