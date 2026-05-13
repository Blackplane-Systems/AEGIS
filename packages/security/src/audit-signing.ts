import { createPrivateKey, createPublicKey, sign, verify } from 'crypto';
import { AuditBlock, AuditRecord, StructuredAuditLog, verifyChain } from '../../runtime/src';

/** Signed audit block wrapper. */
export interface SignedAuditBlock {
  readonly block: AuditBlock;
  readonly signature: string;
}

/** Append-only audit log that signs each Merkle block with an operator key. */
export class SignedAuditLog {
  private readonly log = new StructuredAuditLog();
  private readonly signedBlocks: SignedAuditBlock[] = [];

  public constructor(private readonly privateKeyPem: string) {}

  /** Appends a record and signs the resulting block. */
  public append(record: AuditRecord): SignedAuditBlock {
    const block = this.log.append(record);
    const signedBlock = {
      block,
      signature: sign(
        null,
        Buffer.from(JSON.stringify(block)),
        createPrivateKey(this.privateKeyPem),
      ).toString('base64'),
    };
    this.signedBlocks.push(signedBlock);
    return structuredClone(signedBlock);
  }

  /** Signed immutable chain snapshot. */
  public blocks(): readonly SignedAuditBlock[] {
    return structuredClone(this.signedBlocks);
  }
}

/** Verifies Merkle integrity and every block signature. */
export function verifySignedAuditChain(
  blocks: readonly SignedAuditBlock[],
  publicKeyPem: string,
): number | null {
  const merkleFailure = verifyChain(blocks.map((signedBlock) => signedBlock.block));
  if (merkleFailure !== null) {
    return merkleFailure;
  }
  for (let index = 0; index < blocks.length; index += 1) {
    const signedBlock = blocks[index]!;
    const ok = verify(
      null,
      Buffer.from(JSON.stringify(signedBlock.block)),
      createPublicKey(publicKeyPem),
      Buffer.from(signedBlock.signature, 'base64'),
    );
    if (!ok) {
      return index;
    }
  }
  return null;
}
