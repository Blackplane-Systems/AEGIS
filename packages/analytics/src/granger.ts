import { ols, regularizedIncompleteBeta, residualSumSquares } from './math';

/** Granger causality test result. */
export interface GrangerResult {
  readonly fStatistic: number;
  readonly pValue: number;
  readonly rssRestricted: number;
  readonly rssUnrestricted: number;
  readonly df1: number;
  readonly df2: number;
}

/** Runs the F-test for H0: X does not Granger-cause Y. */
export function grangerTest(
  x: readonly number[],
  y: readonly number[],
  lag: number,
): GrangerResult {
  if (x.length !== y.length || x.length <= 2 * lag + 1 || lag <= 0) {
    throw new Error('Granger test requires aligned series with T > 2p + 1');
  }
  const response: number[] = [];
  const restricted: number[][] = [];
  const unrestricted: number[][] = [];
  for (let t = lag; t < y.length; t += 1) {
    response.push(y[t]!);
    const yLags = Array.from({ length: lag }, (_, index) => y[t - index - 1]!);
    const xLags = Array.from({ length: lag }, (_, index) => x[t - index - 1]!);
    restricted.push([1, ...yLags]);
    unrestricted.push([1, ...yLags, ...xLags]);
  }
  const rssRestricted = residualSumSquares(restricted, response, ols(restricted, response));
  const rssUnrestricted = residualSumSquares(unrestricted, response, ols(unrestricted, response));
  const df1 = lag;
  const df2 = response.length - 2 * lag - 1;
  const fStatistic = (rssRestricted - rssUnrestricted) / df1 / (rssUnrestricted / df2);
  const xBeta = (df1 * fStatistic) / (df1 * fStatistic + df2);
  const pValue = 1 - regularizedIncompleteBeta(xBeta, df1 / 2, df2 / 2);
  return { fStatistic, pValue, rssRestricted, rssUnrestricted, df1, df2 };
}

/** Fleet time series keyed by device id. */
export type FleetSeries = Record<string, readonly number[]>;

/** Directed adjacency list produced by pairwise Granger tests. */
export type CausalityGraph = Record<string, readonly string[]>;

/** Builds a fleet Granger causality graph with edges where p < alpha. */
export function buildCausalityGraph(
  series: FleetSeries,
  lag: number,
  alpha = 0.05,
): CausalityGraph {
  const devices = Object.keys(series);
  const graph: Record<string, string[]> = Object.fromEntries(devices.map((device) => [device, []]));
  for (const source of devices) {
    for (const target of devices) {
      if (source === target) {
        continue;
      }
      if (grangerTest(series[source]!, series[target]!, lag).pValue < alpha) {
        graph[source]!.push(target);
      }
    }
  }
  return graph;
}

/** Serialises a causality graph as adjacency-list JSON. */
export function serialiseCausalityGraph(graph: CausalityGraph): string {
  return JSON.stringify(graph, null, 2);
}
