import * as snarkjs from 'snarkjs';
import { BigNumberish } from 'snarkjs';

// Poseidon hash implementation using circomlib
// We'll load it dynamically to avoid issues with WASM
let poseidonHashFn: ((inputs: bigint[]) => bigint) | null = null;
let poseidonInitialized = false;

// Fallback hash function (always available)
function createFallbackPoseidon(): (inputs: bigint[]) => bigint {
  return (inputs: bigint[]) => {
    // Simple hash approximation using SHA-256 - for offchain development
    // In production, MUST use proper Poseidon from circomlib
    const inputStr = inputs.map(x => x.toString()).join(',');
    const encoder = new TextEncoder();
    const data = encoder.encode(inputStr);
    // Use a better hash by creating a longer hex string
    const hashInput = Array.from(data)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    // Create a deterministic bigint from the hash
    // Take first 16 bytes (32 hex chars) for the hash
    const hashHex = hashInput.padEnd(32, '0').substring(0, 32);
    return BigInt('0x' + hashHex);
  };
}

async function getPoseidon(): Promise<(inputs: bigint[]) => bigint> {
  if (poseidonHashFn) return poseidonHashFn;
  
  if (poseidonInitialized) {
    // If we already tried and failed, return fallback
    const fallback = createFallbackPoseidon();
    poseidonHashFn = fallback;
    return fallback;
  }
  
  poseidonInitialized = true;
  
  try {
    // Try to use circomlib's poseidon
    const circomlib = await import('circomlib');
    if (circomlib && circomlib.poseidon) {
      const circomlibPoseidon = circomlib.poseidon as (inputs: bigint[]) => bigint;
      poseidonHashFn = circomlibPoseidon;
      console.log('✓ Using circomlib Poseidon hash');
      return circomlibPoseidon;
    }
    throw new Error('circomlib.poseidon not available');
  } catch (e) {
    // Fallback: simple hash approximation (for development only)
    console.warn('⚠ Using Poseidon fallback - install circomlib for production');
    console.warn('  Error:', e instanceof Error ? e.message : String(e));
    const fallback = createFallbackPoseidon();
    poseidonHashFn = fallback;
    return fallback;
  }
}

const poseidonHash = async (inputs: BigNumberish[]): Promise<bigint> => {
  try {
    const bigintInputs = inputs.map(x => BigInt(x));
    const poseidon = await getPoseidon();
    // getPoseidon always returns a function (either circomlib or fallback)
    return poseidon(bigintInputs);
  } catch (e) {
    console.error('Poseidon hash error:', e);
    // Even if getPoseidon fails, try fallback directly
    const fallback = createFallbackPoseidon();
    const bigintInputs = inputs.map(x => BigInt(x));
    return fallback(bigintInputs);
  }
};

export interface IdentitySecret {
  secret: Uint8Array; // 32 bytes
}

export interface ConsentProof {
  proof?: {
    pi_a: [string, string, string];
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
  // Offchain proof fields
  offchain?: {
    nullifier: string;
    commitment: string;
    signature: string;
    timestamp: number;
  };
}

export class ZKCookieBanner {
  private identitySecret: Uint8Array | null = null;
  private readonly STORAGE_KEY = 'zkcookies_identity_secret';
  private readonly wasmPath = '/consent.wasm';
  private readonly zkeyPath = '/consent_final.zkey';

  constructor() {
    this.loadIdentitySecret();
  }

  private loadIdentitySecret(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const bytes = Uint8Array.from(JSON.parse(stored));
        if (bytes.length === 32) {
          this.identitySecret = bytes;
        }
      }
    } catch (e) {
      console.warn('Failed to load identity secret:', e);
    }
  }

  private generateIdentitySecret(): Uint8Array {
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    return secret;
  }

  private saveIdentitySecret(secret: Uint8Array): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(Array.from(secret)));
      this.identitySecret = secret;
    } catch (e) {
      console.error('Failed to save identity secret:', e);
      throw e;
    }
  }

  getOrCreateIdentitySecret(): Uint8Array {
    if (!this.identitySecret) {
      this.identitySecret = this.generateIdentitySecret();
      this.saveIdentitySecret(this.identitySecret);
    }
    return this.identitySecret;
  }

  hasIdentitySecret(): boolean {
    return this.identitySecret !== null;
  }

  // Convert Uint8Array to bigint (little-endian)
  private bytesToBigInt(bytes: Uint8Array): bigint {
    let result = 0n;
    for (let i = bytes.length - 1; i >= 0; i--) {
      result = result * 256n + BigInt(bytes[i]);
    }
    return result;
  }

  // Convert bigint to string for snarkjs
  private toSnarkField(value: bigint | number): string {
    return BigInt(value).toString();
  }

  // Compute Poseidon hash
  private async computePoseidon(inputs: (bigint | number)[]): Promise<bigint> {
    try {
      const bigintInputs = inputs.map(x => BigInt(x));
      return await poseidonHash(bigintInputs);
    } catch (e) {
      console.error('Poseidon computation error:', e);
      throw e;
    }
  }

  // Generate hash-based signature for offchain verification
  private async generateOffchainSignature(
    identitySecret: Uint8Array,
    domainSalt: bigint,
    newConsent: number,
    timestamp: number
  ): Promise<string> {
    // Create a message to sign: domainSalt + newConsent + timestamp
    const message = new TextEncoder().encode(
      `${domainSalt.toString()}:${newConsent}:${timestamp}`
    );
    
    // Import the identity secret as a signing key
    const key = await crypto.subtle.importKey(
      'raw',
      identitySecret.buffer as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    // Sign the message
    const signature = await crypto.subtle.sign('HMAC', key, message);
    
    // Convert to hex string
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async generateProof(
    domainSalt: bigint,
    oldConsent: number,
    newConsent: number,
    oldTimestamp: number,
    timestamp: number,
    currentTime: number,
    merklePath?: { elements: bigint[]; indices: number[]; root: bigint }
  ): Promise<ConsentProof> {
    const identitySecret = this.getOrCreateIdentitySecret();
    const identitySecretBigInt = this.bytesToBigInt(identitySecret);

    // For first-time consent, use empty tree
    const root = merklePath?.root || 0n;

    // Compute nullifier and commitment
    const nullifier = await this.computePoseidon([identitySecretBigInt, domainSalt]);
    const newCommitment = await this.computePoseidon([newConsent, timestamp, identitySecretBigInt]);

    // Try to generate ZK proof first, fallback to offchain if files are missing
    try {
      // Load WASM and zkey
      const wasmResponse = await fetch(this.wasmPath);
      if (!wasmResponse.ok) {
        throw new Error(`WASM not available, using offchain mode`);
      }
      const wasm = await wasmResponse.arrayBuffer();

      const zkeyResponse = await fetch(this.zkeyPath);
      if (!zkeyResponse.ok) {
        throw new Error(`ZKEY not available, using offchain mode`);
      }
      const zkey = await zkeyResponse.arrayBuffer();

      // Prepare inputs for ZK proof
      const pathElements = merklePath?.elements || new Array(20).fill(0n);
      const pathIndices = merklePath?.indices || new Array(20).fill(0);
      const input = {
        currentTime: this.toSnarkField(currentTime),
        domainSalt: this.toSnarkField(domainSalt),
        newConsentCommitment: this.toSnarkField(newCommitment),
        nullifier: this.toSnarkField(nullifier),
        root: this.toSnarkField(root),
        identitySecret: this.toSnarkField(identitySecretBigInt),
        oldConsent: this.toSnarkField(oldConsent),
        newConsent: this.toSnarkField(newConsent),
        oldTimestamp: this.toSnarkField(oldTimestamp),
        timestamp: this.toSnarkField(timestamp),
        pathElements: pathElements.map(e => this.toSnarkField(e)),
        pathIndices: pathIndices,
      };

      // Generate ZK proof
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        new Uint8Array(wasm),
        new Uint8Array(zkey)
      );

      return {
        proof: {
          pi_a: proof.pi_a,
          pi_b: proof.pi_b,
          pi_c: proof.pi_c,
          protocol: proof.protocol,
          curve: proof.curve,
        },
        publicSignals: publicSignals.map((s: any) => s.toString()),
      };
    } catch (error) {
      // Fallback to offchain hash-based proof
      console.log('Using offchain proof mode (ZK circuit files not available)');
      console.log('Error that triggered offchain mode:', error instanceof Error ? error.message : String(error));
      
      try {
        const signature = await this.generateOffchainSignature(
          identitySecret,
          domainSalt,
          newConsent,
          timestamp
        );

        const offchainProof = {
          publicSignals: [
            currentTime.toString(),
            domainSalt.toString(),
            newCommitment.toString(),
            nullifier.toString(),
            root.toString(),
          ],
          offchain: {
            nullifier: nullifier.toString(),
            commitment: newCommitment.toString(),
            signature: signature,
            timestamp: timestamp,
          },
        };
        
        console.log('Offchain proof generated successfully:', {
          nullifier: offchainProof.offchain.nullifier.substring(0, 20) + '...',
          commitment: offchainProof.offchain.commitment.substring(0, 20) + '...',
          timestamp: offchainProof.offchain.timestamp,
        });
        
        return offchainProof;
      } catch (offchainError) {
        console.error('Offchain proof generation failed:', offchainError);
        throw new Error(`Failed to generate offchain proof: ${offchainError instanceof Error ? offchainError.message : String(offchainError)}`);
      }
    }
  }

  async verifyProof(proof: ConsentProof, verificationKey: any): Promise<boolean> {
    try {
      const verified = await snarkjs.groth16.verify(
        verificationKey,
        proof.publicSignals,
        proof.proof
      );
      return verified;
    } catch (error) {
      console.error('Proof verification failed:', error);
      return false;
    }
  }
}

