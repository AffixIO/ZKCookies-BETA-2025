/**
 * Cloudflare Worker for ZKP Cookie Banner Verification
 * 
 * This worker:
 * 1. Verifies Groth16 proofs using the verification key
 * 2. Maintains a Poseidon Merkle tree of consent commitments
 * 3. Tracks nullifiers to prevent double-spending
 * 4. Returns 200 OK on successful verification
 */

import { groth16 } from 'snarkjs';

// Verification key (loaded at startup)
let verificationKey: any = null;

// Merkle tree state (in production, use Cloudflare KV or Durable Objects)
interface TreeState {
  root: string;
  leaves: Map<string, string>; // commitment -> leaf index
  nullifiers: Set<string>; // nullifier -> true
}

// Simple in-memory store (replace with KV in production)
const treeState: TreeState = {
  root: '0',
  leaves: new Map(),
  nullifiers: new Set(),
};

// Load verification key
async function loadVerificationKey(): Promise<any> {
  if (verificationKey) {
    return verificationKey;
  }

  // In production, load from KV or environment variable
  // For now, we'll expect it to be passed as an environment variable
  const vkeyJson = (globalThis as any).VERIFICATION_KEY;
  if (vkeyJson) {
    verificationKey = JSON.parse(vkeyJson);
    return verificationKey;
  }

  // Fallback: try to fetch from public URL
  try {
    const response = await fetch('https://your-domain.com/verification_key.json');
    if (response.ok) {
      verificationKey = await response.json();
      return verificationKey;
    }
  } catch (e) {
    console.error('Failed to load verification key:', e);
  }

  throw new Error('Verification key not found');
}

// Simple Poseidon hash (approximation for server-side)
// In production, use proper Poseidon implementation
function poseidonHash(inputs: bigint[]): bigint {
  // This is a placeholder - use proper Poseidon from circomlib
  // For now, return a simple hash
  const inputStr = inputs.map(x => x.toString()).join(',');
  // Use a simple hash approximation
  return BigInt('0x' + Array.from(new TextEncoder().encode(inputStr))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join(''));
}

// Update Merkle tree (simplified - in production use proper SMT library)
async function updateMerkleTree(commitment: string): Promise<string> {
  // For MVP, we'll use a simple append-only tree
  // In production, use proper sparse Merkle tree implementation
  treeState.leaves.set(commitment, treeState.leaves.size.toString());
  
  // Compute new root (simplified)
  // In production, use proper Merkle tree update
  const leafCount = treeState.leaves.size;
  const newRoot = poseidonHash([BigInt(commitment), BigInt(leafCount)]);
  treeState.root = newRoot.toString();
  
  return treeState.root;
}

// Verify proof and update tree
async function verifyAndUpdate(
  proof: any,
  publicSignals: string[]
): Promise<{ success: boolean; root: string }> {
  try {
    // Load verification key
    const vkey = await loadVerificationKey();

    // Verify proof
    const verified = await groth16.verify(
      vkey,
      publicSignals,
      proof
    );

    if (!verified) {
      return { success: false, root: treeState.root };
    }

    // Extract public signals
    // Expected order: [currentTime, domainSalt, newConsentCommitment, nullifier, root]
    const newConsentCommitment = publicSignals[2];
    const nullifier = publicSignals[3];
    const claimedRoot = publicSignals[4];

    // Check nullifier hasn't been used
    if (treeState.nullifiers.has(nullifier)) {
      return { success: false, root: treeState.root };
    }

    // Verify root matches (for existing consents)
    // For first-time consent, root should be 0
    if (claimedRoot !== '0' && claimedRoot !== treeState.root) {
      return { success: false, root: treeState.root };
    }

    // Add nullifier to prevent replay
    treeState.nullifiers.add(nullifier);

    // Update Merkle tree with new commitment
    const newRoot = await updateMerkleTree(newConsentCommitment);

    return { success: true, root: newRoot };
  } catch (error) {
    console.error('Verification error:', error);
    return { success: false, root: treeState.root };
  }
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: corsHeaders,
      });
    }

    try {
      const body = await request.json();
      const { proof, publicSignals } = body;

      if (!proof || !publicSignals) {
        return new Response(
          JSON.stringify({ error: 'Missing proof or publicSignals' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Verify proof and update tree
      const result = await verifyAndUpdate(proof, publicSignals);

      if (result.success) {
        return new Response(
          JSON.stringify({
            success: true,
            root: result.root,
            message: 'Proof verified and tree updated',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } else {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Proof verification failed or nullifier already used',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    } catch (error) {
      console.error('Request error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  },
};

