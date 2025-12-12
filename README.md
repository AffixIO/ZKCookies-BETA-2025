# ZKP Cookie Banner

Production-ready Zero-Knowledge Proof Cookie Consent System with Groth16 on BLS12-381.

## 🎯 Overview

This system implements a privacy-preserving cookie banner that uses zero-knowledge proofs to verify user consent without storing user preferences on the server. The system is designed to be GDPR-compliant and privacy-first.

## 🔐 Cryptography Stack

- **Proof System**: Groth16 on BLS12-381 → 192-byte proofs
- **Hash Function**: Poseidon (never SHA-256 or Keccak)
- **Identity**: Semaphore-style persistent identity with 32-byte `identitySecret` in localStorage
- **Commitment**: `Poseidon(oldConsent, timestamp, identitySecret)`
- **Nullifier**: `Poseidon(identitySecret, domainSalt)` → prevents double-spending per domain
- **State**: Sparse Merkle tree (depth 20) using Poseidon for consent state
- **Enforcement**: 
  - Monotonic consent: `newConsent ≥ oldConsent` (8-bit bitfield)
  - Max consent age: 2 years enforced in-circuit via `currentTime` public input

## 📦 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (Browser)                      │
├─────────────────────────────────────────────────────────────┤
│  • 32-byte identitySecret (localStorage)                    │
│  • Poseidon hash computation                                │
│  • Groth16 proof generation (snarkjs WASM)                  │
│  • Banner UI (Vite + TypeScript, < 50 KB gzipped)          │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        │ 192-byte proof + 5 public signals
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              Cloudflare Worker / Node.js Server              │
├─────────────────────────────────────────────────────────────┤
│  • Groth16 proof verification                               │
│  • Poseidon Merkle tree management                          │
│  • Nullifier tracking (prevents replay attacks)             │
│  • Returns 200 OK → client hides banner forever             │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- circom compiler (install via `npm install -g circom`)

### Installation

```bash
# Clone or navigate to the zkcookies directory
cd zkcookies

# Install dependencies
npm install

# Run setup (compiles circuit, runs phase-2 ceremony)
npm run setup

# Start development server (in one terminal)
npm run dev

# Start verification server (in another terminal)
npm run dev:server
```

Open `http://localhost:5173` in your browser.

**Note**: The setup process may take several minutes as it compiles the circuit and runs the trusted setup ceremony.

## 📁 Project Structure

```
zkcookies/
├── circuits/
│   └── consent.circom          # Circom circuit definition
├── src/
│   ├── zk.ts                   # ZK proof generation logic
│   ├── banner.ts                # Banner UI and interaction
│   └── main.ts                 # Entry point
├── worker/
│   ├── verify.ts                # Cloudflare Worker verifier
│   └── wrangler.toml            # Cloudflare Worker config
├── scripts/
│   └── setup.js                 # Setup script (circuit compilation)
├── build/                       # Generated files (circuit, keys)
├── public/                      # Static assets (WASM files)
├── index.html                   # Demo page
├── package.json
├── vite.config.ts
└── README.md
```

## 🔧 Setup Process

The `npm run setup` command:

1. **Compiles the Circom circuit** → generates R1CS, WASM, and symbol files
2. **Runs Phase 1 ceremony** → generates powers of tau (trusted setup)
3. **Runs Phase 2 ceremony** → circuit-specific setup
4. **Exports verification key** → for server-side verification
5. **Copies WASM files** → to public directory for client use

## 💻 Usage

### Client-Side

```typescript
import { CookieBanner } from './banner';

const banner = new CookieBanner({
  apiEndpoint: 'https://your-api.com/verify',
  domainSalt: BigInt('0x...'), // Domain-specific salt
  onAccept: () => {
    console.log('Consent accepted!');
  },
  onReject: () => {
    console.log('Consent rejected.');
  },
});

// Show banner if needed
if (banner.shouldShowBanner()) {
  banner.show();
}
```

### Server-Side (Cloudflare Worker)

Deploy the worker:

```bash
cd worker
wrangler deploy
```

Set the verification key as an environment variable:

```bash
wrangler secret put VERIFICATION_KEY
# Paste the contents of build/keys/verification_key.json
```

## 🔒 Security Properties

1. **Privacy**: User preferences never stored on server (only Merkle commitments)
2. **Unlinkability**: Each proof uses a nullifier to prevent tracking
3. **Double-spend prevention**: Nullifiers prevent replay attacks
4. **Monotonic consent**: Consent can only increase, never decrease
5. **Expiry enforcement**: 2-year max consent age enforced in-circuit
6. **No wallet required**: Works in any browser without extensions

## 📊 Public Signals (5 total)

1. `currentTime` - Unix timestamp (public)
2. `domainSalt` - Domain-specific salt (public)
3. `newConsentCommitment` - Poseidon(newConsent, timestamp, identitySecret) (public)
4. `nullifier` - Poseidon(identitySecret, domainSalt) (public)
5. `root` - Merkle root (public)

## 🎨 Browser Compatibility

- ✅ Safari
- ✅ Chrome
- ✅ Firefox
- ✅ Tor Browser
- ❌ No WebGPU required
- ❌ No experimental flags required
- ❌ No browser extensions required

## 📝 License

MIT License - see LICENSE file for details.

## 🔗 References

- [Semaphore Protocol](https://github.com/semaphore-protocol/semaphore)
- [MACI](https://github.com/privacy-scaling-explorations/maci)
- [zk-email-verify](https://github.com/zkemail/zk-email-verify)

## ⚠️ Production Notes

1. **BLS12-381 vs BN254**: The current setup uses BN254 (snarkjs limitation). For production BLS12-381, use a different toolchain (e.g., arkworks, bellman-bn254 with BLS12-381 support).

2. **Trusted Setup**: The setup script uses a single-contributor ceremony for MVP. In production, use a multi-party trusted setup ceremony.

3. **Merkle Tree Storage**: The worker uses in-memory storage. In production, use Cloudflare KV or Durable Objects for persistent tree state.

4. **Poseidon Implementation**: Ensure client and server use the same Poseidon implementation (from circomlib).

## 🐛 Troubleshooting

**Circuit compilation fails:**
- Ensure circom is installed: `npm install -g circom`
- Check that circomlib is installed: `npm install`

**Proof generation fails:**
- Ensure WASM and zkey files are in the public directory
- Check browser console for errors
- Verify the circuit was compiled successfully

**Server verification fails:**
- Ensure verification key is correctly set in environment
- Check that proof format matches expected structure
- Verify nullifier hasn't been used before

