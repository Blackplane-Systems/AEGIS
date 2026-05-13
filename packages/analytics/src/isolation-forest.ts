import { SeededRandom } from './math';

/** Device feature vector used by fleet anomaly scoring. */
export interface DeviceFeatureVector {
  readonly drift_score: number;
  readonly packet_loss: number;
  readonly reconnect_rate: number;
  readonly action_fail_rate: number;
  readonly cpu_load: number;
  readonly battery_rate_of_change: number;
}

/** Isolation tree node. */
export interface IsolationNode {
  readonly size: number;
  readonly depth: number;
  readonly feature?: number;
  readonly split?: number;
  readonly left?: IsolationNode;
  readonly right?: IsolationNode;
}

/** Isolation Forest model following Liu et al. 2008 scoring. */
export class IsolationForest {
  private readonly trees: IsolationNode[] = [];
  private readonly rng: SeededRandom;

  public constructor(
    private readonly nTrees = 100,
    private readonly subsampleSize = 256,
    seed = 1,
  ) {
    this.rng = new SeededRandom(seed);
  }

  /** Trains trees against feature vectors normalised to [0,1]. */
  public fit(samples: readonly (readonly number[])[]): void {
    if (samples.length === 0) {
      throw new Error('IsolationForest requires training samples');
    }
    this.trees.length = 0;
    const sampleSize = Math.min(this.subsampleSize, samples.length);
    const maxDepth = Math.ceil(Math.log2(sampleSize));
    for (let index = 0; index < this.nTrees; index += 1) {
      this.trees.push(
        this.buildTree(sampleWithoutReplacement(samples, sampleSize, this.rng), 0, maxDepth),
      );
    }
  }

  /** Scores one sample where larger values indicate stronger anomaly evidence. */
  public score(sample: readonly number[]): number {
    if (this.trees.length === 0) {
      throw new Error('IsolationForest must be fitted before scoring');
    }
    const meanPath =
      this.trees.reduce((sum, tree) => sum + pathLength(sample, tree), 0) / this.trees.length;
    return 2 ** (-meanPath / averagePathLength(this.subsampleSize));
  }

  private buildTree(
    samples: readonly (readonly number[])[],
    depth: number,
    maxDepth: number,
  ): IsolationNode {
    if (depth >= maxDepth || samples.length <= 1 || allIdentical(samples)) {
      return { size: samples.length, depth };
    }
    const featureCount = samples[0]!.length;
    const feature = Math.floor(this.rng.next() * featureCount);
    const values = samples.map((sample) => sample[feature]!);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      return { size: samples.length, depth };
    }
    const split = min + this.rng.next() * (max - min);
    const left = samples.filter((sample) => sample[feature]! < split);
    const right = samples.filter((sample) => sample[feature]! >= split);
    return {
      size: samples.length,
      depth,
      feature,
      split,
      left: this.buildTree(left, depth + 1, maxDepth),
      right: this.buildTree(right, depth + 1, maxDepth),
    };
  }
}

/** Converts a device feature object to the ordered six-dimensional vector. */
export function normaliseDeviceFeatures(features: DeviceFeatureVector): readonly number[] {
  return [
    features.drift_score,
    features.packet_loss,
    features.reconnect_rate,
    features.action_fail_rate,
    features.cpu_load,
    features.battery_rate_of_change,
  ].map((value) => Math.max(0, Math.min(1, value)));
}

/** Average unsuccessful search path length c(psi). */
export function averagePathLength(size: number): number {
  if (size <= 1) {
    return 0;
  }
  if (size === 2) {
    return 1;
  }
  const eulerMascheroni = 0.5772156649;
  return 2 * (Math.log(size - 1) + eulerMascheroni) - (2 * (size - 1)) / size;
}

function pathLength(sample: readonly number[], node: IsolationNode): number {
  if (
    node.left === undefined ||
    node.right === undefined ||
    node.feature === undefined ||
    node.split === undefined
  ) {
    return node.depth + averagePathLength(node.size);
  }
  return sample[node.feature]! < node.split
    ? pathLength(sample, node.left)
    : pathLength(sample, node.right);
}

function allIdentical(samples: readonly (readonly number[])[]): boolean {
  return samples.every((sample) => sample.every((value, index) => value === samples[0]![index]));
}

function sampleWithoutReplacement<T>(
  items: readonly T[],
  size: number,
  rng: SeededRandom,
): readonly T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, size);
}
