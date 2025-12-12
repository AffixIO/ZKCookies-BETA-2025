# Quick Start Guide

## One-Line Install

```bash
npm install && npm run setup && npm run dev:server
```

Then in another terminal:
```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

## What Happens

1. **First Visit**: 
   - Browser generates a 32-byte `identitySecret` and stores it in localStorage
   - Cookie banner appears
   - User clicks "Accept"
   - Client generates a Groth16 proof (192 bytes)
   - Proof is sent to server
   - Server verifies proof and updates Merkle tree
   - Banner disappears forever

2. **Repeat Visits**:
   - Browser loads `identitySecret` from localStorage
   - Automatically generates proof
   - Sends proof to server
   - Banner never appears (already verified)

## Architecture Flow

```
User clicks "Accept"
    ↓
Generate identitySecret (if first time)
    ↓
Compute: nullifier = Poseidon(identitySecret, domainSalt)
Compute: commitment = Poseidon(newConsent, timestamp, identitySecret)
    ↓
Generate Groth16 proof (192 bytes)
    ↓
Send proof + 5 public signals to server
    ↓
Server verifies proof
    ↓
Server updates Merkle tree
    ↓
Server returns 200 OK
    ↓
Client hides banner forever
```

## Key Files

- `circuits/consent.circom` - ZK circuit definition
- `src/zk.ts` - Proof generation logic
- `src/banner.ts` - Banner UI
- `server.js` - Local dev server (Node.js)
- `worker/verify.ts` - Cloudflare Worker (production)

## Testing

1. Open browser console
2. Check `localStorage.getItem('zkcookies_identity_secret')` - should see 32-byte array
3. Click "Accept" on banner
4. Check network tab - should see POST to `/verify` with proof
5. Refresh page - banner should not appear
6. Clear localStorage - banner will reappear on next visit

## Production Deployment

1. Deploy Cloudflare Worker:
   ```bash
   cd worker
   wrangler deploy
   ```

2. Set verification key:
   ```bash
   wrangler secret put VERIFICATION_KEY
   # Paste contents of build/keys/verification_key.json
   ```

3. Update API endpoint in `src/main.ts`:
   ```typescript
   const API_ENDPOINT = 'https://your-worker.workers.dev/verify';
   ```

4. Build client:
   ```bash
   npm run build
   ```

5. Deploy `dist/` to your CDN/hosting.

