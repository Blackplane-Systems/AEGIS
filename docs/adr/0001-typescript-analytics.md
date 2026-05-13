# ADR 0001 - advanced analytics in TypeScript

## Status

Accepted.

## Context

The initial stack recommendation allowed Python 3.11+ for analytics, but the repository established a
strict TypeScript monorepo with direct package imports, Node 20 scripts, and Vitest coverage.
Splitting analytics into Python would require a second build/test toolchain and cross-language
bindings for the same deterministic runtime tests.

## Decision

Statistical and analytics engines are implemented in TypeScript from their mathematical
definitions. No external statistics, ML, rule-engine, or web-framework dependency was added.

## Consequences

The project remains a single-command Node workspace for build, test, and lint. Numerical routines are
small and auditable, but they are intentionally scoped to the implemented formulas and not positioned as
general-purpose scientific-computing replacements.
