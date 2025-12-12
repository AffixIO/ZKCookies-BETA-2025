#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('🔧 Setting up ZKP Cookie Banner...\n');

// Create necessary directories
const dirs = ['build', 'build/circuits', 'build/keys'];
dirs.forEach(dir => {
  const fullPath = join(rootDir, dir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
    console.log(`✓ Created directory: ${dir}`);
  }
});

// Step 1: Compile circuit
console.log('\n📦 Step 1: Compiling Circom circuit...');
try {
  execSync(
    `circom circuits/consent.circom --r1cs --wasm --sym -o build/circuits`,
    { cwd: rootDir, stdio: 'inherit' }
  );
  console.log('✓ Circuit compiled successfully\n');
} catch (error) {
  console.error('✗ Circuit compilation failed');
  process.exit(1);
}

// Step 2: Phase 1 (powers of tau) - BLS12-381
console.log('🔐 Step 2: Running Phase 1 ceremony (powers of tau for BLS12-381)...');
const ptauFile = join(rootDir, 'build/keys/powersOfTau28_hez_final.ptau');
if (!existsSync(ptauFile)) {
  try {
    // For MVP, we'll use a small ceremony
    // In production, use a trusted setup ceremony with BLS12-381
    // Note: snarkjs uses BN254 by default, but we need BLS12-381
    // For now, we'll use BN254 for MVP (snarkjs limitation)
    // In production, use a BLS12-381 compatible setup
    console.log('⚠️  Note: Using BN254 for MVP (snarkjs limitation)');
    console.log('   For production BLS12-381, use a different toolchain\n');
    execSync(
      `snarkjs powersoftau new bn128 14 build/keys/pot14_0000.ptau -v`,
      { cwd: rootDir, stdio: 'inherit' }
    );
    execSync(
      `snarkjs powersoftau contribute build/keys/pot14_0000.ptau build/keys/pot14_0001.ptau --name="First contribution" -v -e="random text"`,
      { cwd: rootDir, stdio: 'inherit' }
    );
    execSync(
      `snarkjs powersoftau beacon build/keys/pot14_0001.ptau ${ptauFile} 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n="Final Beacon"`,
      { cwd: rootDir, stdio: 'inherit' }
    );
    console.log('✓ Phase 1 completed\n');
  } catch (error) {
    console.error('✗ Phase 1 failed');
    process.exit(1);
  }
} else {
  console.log('✓ Phase 1 already exists, skipping...\n');
}

// Step 3: Phase 2 (circuit-specific)
console.log('🔐 Step 3: Running Phase 2 ceremony (circuit-specific)...');
const zkeyFile = join(rootDir, 'build/circuits/consent_0000.zkey');
if (!existsSync(zkeyFile)) {
  try {
    execSync(
      `snarkjs groth16 setup build/circuits/consent.r1cs ${ptauFile} build/circuits/consent_0000.zkey`,
      { cwd: rootDir, stdio: 'inherit' }
    );
    execSync(
      `snarkjs zkey contribute build/circuits/consent_0000.zkey build/circuits/consent_0001.zkey --name="Second contribution" -v -e="another random text"`,
      { cwd: rootDir, stdio: 'inherit' }
    );
    execSync(
      `snarkjs zkey beacon build/circuits/consent_0001.zkey build/circuits/consent_final.zkey 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n="Final Beacon phase2"`,
      { cwd: rootDir, stdio: 'inherit' }
    );
    console.log('✓ Phase 2 completed\n');
  } catch (error) {
    console.error('✗ Phase 2 failed');
    process.exit(1);
  }
} else {
  console.log('✓ Phase 2 already exists, skipping...\n');
}

// Step 4: Export verification key
console.log('🔑 Step 4: Exporting verification key...');
try {
  execSync(
    `snarkjs zkey export verificationkey build/circuits/consent_final.zkey build/keys/verification_key.json`,
    { cwd: rootDir, stdio: 'inherit' }
  );
  console.log('✓ Verification key exported\n');
} catch (error) {
  console.error('✗ Verification key export failed');
  process.exit(1);
}

// Step 5: Copy WASM and zkey files to public directory
console.log('📦 Step 5: Preparing WASM and zkey files...');
try {
  const publicDir = join(rootDir, 'public');
  if (!existsSync(publicDir)) {
    mkdirSync(publicDir, { recursive: true });
  }
  execSync(
    `cp build/circuits/consent.wasm public/consent.wasm`,
    { cwd: rootDir, stdio: 'inherit' }
  );
  execSync(
    `cp build/circuits/consent_final.zkey public/consent_final.zkey`,
    { cwd: rootDir, stdio: 'inherit' }
  );
  console.log('✓ WASM and zkey files copied to public directory\n');
} catch (error) {
  console.error('✗ File copy failed');
  process.exit(1);
}

console.log('✅ Setup complete!');
console.log('\nNext steps:');
console.log('  1. Run: npm run dev');
console.log('  2. Open http://localhost:5173');
console.log('  3. Click "Accept" on the cookie banner');
console.log('  4. Refresh the page - banner should be gone forever!\n');

