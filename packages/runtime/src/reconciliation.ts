/** Safety class for reconciled state fields. */
export type SafetyClass = 'NORMAL' | 'CRITICAL';

/** Timestamped CRDT field value. */
export interface ReconciledField<T = unknown> {
  readonly value: T;
  readonly updatedAt: string;
  readonly safetyClass?: SafetyClass;
}

/** Device state shape accepted by reconciliation. */
export type ReconciledState = Record<string, ReconciledField>;

/** Conflict report entry for cloud-authoritative fields. */
export interface ConflictReportEntry {
  readonly field: string;
  readonly reason: 'CRITICAL_CLOUD_OVERRIDE' | 'LWW_CLOUD_NEWER' | 'TIMESTAMP_TIE_CLOUD';
  readonly localValue: unknown;
  readonly cloudValue: unknown;
}

/** Reconciliation result containing merged state and conflicts. */
export interface ReconciliationResult {
  readonly mergedState: ReconciledState;
  readonly conflicts: readonly ConflictReportEntry[];
}

/** Merges local and cloud state with CRITICAL cloud overrides and LWW for normal fields. */
export function reconcile(
  localState: ReconciledState,
  cloudState: ReconciledState,
): ReconciliationResult {
  const mergedState: ReconciledState = {};
  const conflicts: ConflictReportEntry[] = [];
  const fields = new Set([...Object.keys(localState), ...Object.keys(cloudState)]);

  for (const field of fields) {
    const local = localState[field];
    const cloud = cloudState[field];
    if (local === undefined && cloud !== undefined) {
      mergedState[field] = cloud;
      continue;
    }
    if (cloud === undefined && local !== undefined) {
      mergedState[field] = local;
      continue;
    }
    if (local === undefined || cloud === undefined) {
      continue;
    }
    if (cloud.safetyClass === 'CRITICAL' || local.safetyClass === 'CRITICAL') {
      mergedState[field] = { ...cloud, safetyClass: 'CRITICAL' };
      conflicts.push({
        field,
        reason: 'CRITICAL_CLOUD_OVERRIDE',
        localValue: local.value,
        cloudValue: cloud.value,
      });
      continue;
    }
    const localTime = Date.parse(local.updatedAt);
    const cloudTime = Date.parse(cloud.updatedAt);
    if (localTime > cloudTime) {
      mergedState[field] = local;
    } else {
      mergedState[field] = cloud;
      conflicts.push({
        field,
        reason: localTime === cloudTime ? 'TIMESTAMP_TIE_CLOUD' : 'LWW_CLOUD_NEWER',
        localValue: local.value,
        cloudValue: cloud.value,
      });
    }
  }
  return { mergedState, conflicts };
}
