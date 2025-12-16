/**
 * Simple Node.js server for local development
 * In production, use the Cloudflare Worker (worker/verify.ts)
 */

import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { groth16 } from 'snarkjs';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Load verification key
let verificationKey = null;
try {
  const vkeyPath = join(__dirname, 'build', 'keys', 'verification_key.json');
  verificationKey = JSON.parse(readFileSync(vkeyPath, 'utf8'));
  console.log('✓ Verification key loaded');
} catch (e) {
  console.error('✗ Failed to load verification key:', e.message);
  console.error('  Run "npm run setup" first to generate the verification key');
  process.exit(1);
}

// Simple in-memory Merkle tree state
const treeState = {
  root: '0',
  leaves: new Map(),
  nullifiers: new Set(),
};

// Simple Poseidon hash (placeholder - use proper implementation in production)
// In production, use proper Poseidon from circomlib or @zk-kit/poseidon
function poseidonHash(inputs) {
  // This is a placeholder - in production use proper Poseidon from circomlib
  const inputStr = inputs.map(x => BigInt(x).toString()).join(',');
  const hash = createHash('sha256').update(inputStr).digest('hex');
  return BigInt('0x' + hash.slice(0, 16));
}

// Update Merkle tree
function updateMerkleTree(commitment) {
  treeState.leaves.set(commitment, treeState.leaves.size.toString());
  const leafCount = treeState.leaves.size;
  const newRoot = poseidonHash([BigInt(commitment), BigInt(leafCount)]);
  treeState.root = newRoot.toString();
  return treeState.root;
}

// Verify proof endpoint
app.post('/verify', async (req, res) => {
  try {
    const { proof, publicSignals } = req.body;

    if (!proof || !publicSignals) {
      return res.status(400).json({ error: 'Missing proof or publicSignals' });
    }

    // Verify proof
    const verified = await groth16.verify(verificationKey, publicSignals, proof);

    if (!verified) {
      return res.status(400).json({ error: 'Proof verification failed' });
    }

    // Extract public signals
    // Expected: [currentTime, domainSalt, newConsentCommitment, nullifier, root]
    const newConsentCommitment = publicSignals[2];
    const nullifier = publicSignals[3];
    const claimedRoot = publicSignals[4];

    // Check nullifier hasn't been used
    if (treeState.nullifiers.has(nullifier)) {
      return res.status(400).json({ error: 'Nullifier already used (double-spend detected)' });
    }

    // Verify root matches (for existing consents)
    if (claimedRoot !== '0' && claimedRoot !== treeState.root) {
      return res.status(400).json({ error: 'Merkle root mismatch' });
    }

    // Add nullifier to prevent replay
    treeState.nullifiers.add(nullifier);

    // Update Merkle tree
    const newRoot = updateMerkleTree(newConsentCommitment);

    return res.json({
      success: true,
      root: newRoot,
      message: 'Proof verified and tree updated',
    });
  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', treeSize: treeState.leaves.size });
});

const PORT = process.env.PORT || 3041;
app.listen(PORT, () => {
  console.log(`\n🚀 ZKP Cookie Banner Server running on http://localhost:${PORT}`);
  console.log(`   POST /verify - Verify proof and update tree`);
  console.log(`   GET  /health - Health check\n`);
});

