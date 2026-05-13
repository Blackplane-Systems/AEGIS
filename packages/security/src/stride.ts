/** STRIDE threat category. */
export type StrideCategory =
  | 'Spoofing'
  | 'Tampering'
  | 'Repudiation'
  | 'Information Disclosure'
  | 'Denial of Service'
  | 'Elevation of Privilege';

/** STRIDE mitigation entry. */
export interface StrideEntry {
  readonly plane: string;
  readonly category: StrideCategory;
  readonly control: string;
  readonly implemented: boolean;
}

const PLANES = ['Identity', 'Protocol', 'Runtime', 'Policy', 'Observability'] as const;
const CATEGORIES: readonly StrideCategory[] = [
  'Spoofing',
  'Tampering',
  'Repudiation',
  'Information Disclosure',
  'Denial of Service',
  'Elevation of Privilege',
];

/** Generates structured STRIDE analysis for all AEGIS planes. */
export function generateStrideAnalysis(): readonly StrideEntry[] {
  return PLANES.flatMap((plane) =>
    CATEGORIES.map((category) => ({
      plane,
      category,
      control: implementedControl(plane, category),
      implemented: !implementedControl(plane, category).startsWith('TODO'),
    })),
  );
}

/** Enforces that protocol adapters cannot directly expose actuation APIs. */
export function enforceLeastPrivilegeAdapter(adapter: Record<string, unknown>): boolean {
  const forbidden = ['approved', 'rollback', 'actuate', 'executeActuation'];
  if (forbidden.some((key) => key in adapter)) {
    throw new Error('Adapter violates least-privilege actuation boundary');
  }
  return true;
}

function implementedControl(plane: string, category: StrideCategory): string {
  const known: Record<string, string> = {
    'Identity:Spoofing': 'Ed25519 device identity and signed operator tokens',
    'Protocol:Tampering': 'Canonical validation and signed transport payload support',
    'Runtime:Denial of Service': 'Bounded queues, backpressure, replay prevention, rate limiting',
    'Policy:Elevation of Privilege': 'Safety lattice and STRICT signed policy rejection',
    'Observability:Repudiation': 'Merkle audit chain and operator-signed audit blocks',
  };
  return (
    known[`${plane}:${category}`] ?? `TODO: verify mitigating control for ${plane} ${category}`
  );
}
