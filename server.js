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

// Load verification key (optional for offchain mode)
let verificationKey = null;
try {
  const vkeyPath = join(__dirname, 'build', 'keys', 'verification_key.json');
  verificationKey = JSON.parse(readFileSync(vkeyPath, 'utf8'));
  console.log('✓ Verification key loaded (ZK mode enabled)');
} catch (e) {
  console.log('⚠ Verification key not found - running in offchain mode');
  console.log('  ZK proofs will be rejected, offchain proofs will be accepted');
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

// Verify hash-based signature (offchain mode)
function verifyOffchainSignature(signature, domainSalt, newConsent, timestamp, commitment, nullifier) {
  // In offchain mode, we verify the commitment and nullifier are correctly computed
  // The signature is a proof that the client has the identity secret
  // For simplicity, we accept valid commitments and nullifiers
  // In production, you'd verify the signature matches the expected format
  
  // Verify timestamp is reasonable (not too far in past or future)
  const currentTime = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(currentTime - timestamp);
  // Allow up to 24 hours difference for clock skew
  if (timeDiff > 86400) {
    console.warn(`Timestamp too far from current time: ${timeDiff}s difference`);
    return false;
  }
  
  // Verify commitment and nullifier are valid bigints and non-zero
  try {
    const commitmentBigInt = BigInt(commitment);
    const nullifierBigInt = BigInt(nullifier);
    
    // Basic validation: values should be non-zero
    if (commitmentBigInt === 0n || nullifierBigInt === 0n) {
      return false;
    }
    
    // Verify signature is present and valid format (hex string)
    if (!signature || typeof signature !== 'string' || signature.length < 16) {
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('Offchain verification error:', e);
    return false;
  }
}

// Verify proof endpoint
app.post('/verify', async (req, res) => {
  try {
    const { proof, publicSignals, offchain } = req.body;

    if (!publicSignals) {
      return res.status(400).json({ error: 'Missing publicSignals' });
    }

    let verified = false;
    let newConsentCommitment, nullifier, claimedRoot;

    // Check if this is an offchain proof
    if (offchain) {
      // Offchain mode: verify hash-based proof
      newConsentCommitment = offchain.commitment;
      nullifier = offchain.nullifier;
      claimedRoot = publicSignals[4] || '0';
      
      // For offchain, we use newConsent = 255 (full consent) as default
      const newConsent = 255;
      
      console.log('Verifying offchain proof:', {
        nullifier: nullifier.substring(0, 20) + '...',
        commitment: newConsentCommitment.substring(0, 20) + '...',
        timestamp: offchain.timestamp,
      });
      
      verified = verifyOffchainSignature(
        offchain.signature,
        BigInt(publicSignals[1]), // domainSalt
        newConsent, // Use 255 for full consent
        offchain.timestamp,
        newConsentCommitment,
        nullifier
      );
      
      if (!verified) {
        console.error('Offchain verification failed');
        return res.status(400).json({ error: 'Offchain proof verification failed' });
      }
      
      console.log('Offchain proof verified successfully');
    } else if (proof && verificationKey) {
      // ZK proof mode
      try {
        verified = await groth16.verify(verificationKey, publicSignals, proof);
        if (!verified) {
          return res.status(400).json({ error: 'ZK proof verification failed' });
        }
        
        // Extract public signals
        // Expected: [currentTime, domainSalt, newConsentCommitment, nullifier, root]
        newConsentCommitment = publicSignals[2];
        nullifier = publicSignals[3];
        claimedRoot = publicSignals[4];
      } catch (e) {
        console.error('ZK verification error:', e);
        return res.status(400).json({ error: 'ZK proof verification error' });
      }
    } else {
      return res.status(400).json({ error: 'No valid proof provided (neither ZK nor offchain)' });
    }

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
      message: offchain ? 'Offchain proof verified and tree updated' : 'ZK proof verified and tree updated',
      mode: offchain ? 'offchain' : 'zk',
    });
  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', treeSize: treeState.leaves.size });
});

// Reset endpoint (for testing/demo purposes)
app.post('/reset', (req, res) => {
  treeState.root = '0';
  treeState.leaves.clear();
  treeState.nullifiers.clear();
  console.log('✓ Server state reset');
  res.json({ 
    success: true, 
    message: 'Server state reset - nullifiers and tree cleared',
    treeSize: 0 
  });
});

const PORT = process.env.PORT || 100;
app.listen(PORT, () => {
  console.log(`\n🚀 ZKP Cookie Banner Server running on http://localhost:${PORT}`);
  console.log(`   POST /verify - Verify proof and update tree (ZK or offchain)`);
  console.log(`   GET  /health - Health check`);
  console.log(`   Mode: ${verificationKey ? 'ZK + Offchain' : 'Offchain only'}\n`);
});

