/** Deterministic linear congruential generator for reproducible analytics tests. */
export class SeededRandom {
  private state: number;

  public constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  /** Returns a uniform value in [0, 1). */
  public next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 2 ** 32;
  }
}

/** Solves least-squares regression using normal equations and Gaussian elimination. */
export function ols(
  design: readonly (readonly number[])[],
  y: readonly number[],
): readonly number[] {
  if (design.length === 0 || design.length !== y.length) {
    throw new Error('OLS requires aligned non-empty design and response arrays');
  }
  const columns = design[0]?.length ?? 0;
  const xtx = Array.from({ length: columns }, () => Array.from({ length: columns }, () => 0));
  const xty = Array.from({ length: columns }, () => 0);
  for (let rowIndex = 0; rowIndex < design.length; rowIndex += 1) {
    const row = design[rowIndex]!;
    for (let i = 0; i < columns; i += 1) {
      xty[i]! += row[i]! * y[rowIndex]!;
      for (let j = 0; j < columns; j += 1) {
        xtx[i]![j]! += row[i]! * row[j]!;
      }
    }
  }
  for (let i = 0; i < columns; i += 1) {
    xtx[i]![i]! += 1e-10;
  }
  return solveLinearSystem(xtx, xty);
}

/** Computes residual sum of squares. */
export function residualSumSquares(
  design: readonly (readonly number[])[],
  y: readonly number[],
  beta: readonly number[],
): number {
  return design.reduce((rss, row, index) => {
    const predicted = row.reduce((sum, value, column) => sum + value * beta[column]!, 0);
    return rss + (y[index]! - predicted) ** 2;
  }, 0);
}

/** Natural log gamma using Lanczos approximation. */
export function logGamma(z: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  let x = 0.9999999999998099;
  const shifted = z - 1;
  for (let i = 0; i < coefficients.length; i += 1) {
    x += coefficients[i]! / (shifted + i + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularized incomplete beta I_x(a,b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lbeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Complementary error-function approximation. */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

function solveLinearSystem(matrix: number[][], rhs: number[]): readonly number[] {
  const n = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) {
        pivot = row;
      }
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    if (Math.abs(divisor) < 1e-12) {
      throw new Error('OLS design matrix is singular');
    }
    for (let col = column; col <= n; col += 1) {
      augmented[column]![col]! /= divisor;
    }
    for (let row = 0; row < n; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = augmented[row]![column]!;
      for (let col = column; col <= n; col += 1) {
        augmented[row]![col]! -= factor * augmented[column]![col]!;
      }
    }
  }
  return augmented.map((row) => row[n]!);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-12;
  const fpmin = 1e-30;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) {
    d = fpmin;
  }
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) {
      d = fpmin;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) {
      c = fpmin;
    }
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) {
      d = fpmin;
    }
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) {
      c = fpmin;
    }
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < epsilon) {
      break;
    }
  }
  qab = a + b;
  qap = a + 1;
  qam = a - 1;
  void qab;
  void qap;
  void qam;
  return h;
}
