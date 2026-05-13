# ADR 0000 - Empty Scaffold Script Gate

## Status

Accepted.

## Context

The bootstrap requirement specified that `npm run build`, `npm run test`, and `npm run lint` pass on the empty
scaffold. Vitest exits non-zero when no test files exist by default, and TypeScript requires at
least one source input for a meaningful package build.

## Decision

Vitest was configured with `passWithNoTests` for the empty scaffold. The production build gate was
then verified after the first package source files existed, and all final project quality gates
continue to use the root `npm run build`, `npm run test`, and `npm run lint` scripts.

## Consequences

The repository supports a clean bootstrap state without special-case scripts. The tradeoff is that
the literal empty-scaffold build gate was validated at the first source-bearing scaffold point rather
than before TypeScript had any package input.
