# ADR 0001 - Phase 2 Analytics in TypeScript

## Status

Accepted.

## Context

The prompt allowed Python 3.11+ for analytics, but Phase 1 established a strict TypeScript monorepo
with direct package imports, Node 20 scripts, and Vitest coverage. Splitting analytics into Python
would require a second build/test toolchain and cross-language bindings for the same deterministic
runtime tests.

## Decision

Phase 2 statistical and analytics engines are implemented in TypeScript from their mathematical
definitions. No external statistics, ML, rule-engine, or web-framework dependency was added.

## Consequences

The project remains a single-command Node workspace for build, test, and lint. Numerical routines are
small and auditable, but they are intentionally scoped to the Phase 2 formulas and not positioned as
general-purpose scientific-computing replacements.
