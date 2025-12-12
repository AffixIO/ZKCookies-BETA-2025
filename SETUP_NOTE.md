# Setup Note

## Circom 2.x Installation Required

The circuit compilation requires Circom 2.x, which must be installed separately.

### Option 1: Install from Source (Recommended)

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install circom 2.x
git clone https://github.com/iden3/circom.git
cd circom
cargo build --release
cargo install --path circom
```

### Option 2: Use Pre-built Binary

Download from: https://github.com/iden3/circom/releases

### Option 3: Use Docker

```bash
docker run -it -v $(pwd):/workspace iden3/circom:latest circom circuits/consent.circom --r1cs --wasm --sym -o build/circuits
```

## Quick Start (Without Circuit)

For development/demo purposes, you can start the servers without circuit compilation:

```bash
npm run dev:server  # Terminal 1 - Verification server (port 3041)
npm run dev          # Terminal 2 - Client dev server (port 3040)
```

Note: Proof generation will fail without compiled circuit files, but the UI will work.

