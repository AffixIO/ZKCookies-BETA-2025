pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/smt/smtverifier.circom";

template ConsentCircuit() {
    // Public inputs (5 total)
    signal input currentTime;          // Unix timestamp (public)
    signal input domainSalt;           // Domain-specific salt (public)
    signal input newConsentCommitment; // Poseidon(newConsent, timestamp, identitySecret) (public)
    signal input nullifier;            // Poseidon(identitySecret, domainSalt) (public)
    signal input root;                 // Merkle root (public)

    // Private inputs
    signal input identitySecret;       // 32-byte secret (private)
    signal input oldConsent;           // 8-bit bitfield (private)
    signal input newConsent;           // 8-bit bitfield (private)
    signal input oldTimestamp;         // Unix timestamp of old consent (private)
    signal input timestamp;             // Unix timestamp when new consent was given (private)
    signal input pathElements[20];     // Merkle path elements (depth 20)
    signal input pathIndices[20];      // Merkle path indices

    // Poseidon hashers
    component poseidon2 = Poseidon(2);
    component poseidon3Old = Poseidon(3);
    component poseidon3New = Poseidon(3);

    // Comparators for monotonic consent and expiry
    component consentCheck = GreaterEqThan(8);
    component timeCheck = LessEqThan(32);

    // Merkle tree verifier (depth 20)
    component tree = SMTVerifier(20);

    // Compute old commitment = Poseidon(oldConsent, oldTimestamp, identitySecret)
    poseidon3Old.inputs[0] <== oldConsent;
    poseidon3Old.inputs[1] <== oldTimestamp;
    poseidon3Old.inputs[2] <== identitySecret;
    
    // Verify the old commitment is in the Merkle tree (if root is non-zero)
    // For first-time consent, root = 0 and we skip this check
    // Note: SMTVerifier will handle empty tree case
    tree.leaf <== poseidon3Old.out;
    for (var i = 0; i < 20; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root <== root;

    // Verify nullifier = Poseidon(identitySecret, domainSalt)
    poseidon2.inputs[0] <== identitySecret;
    poseidon2.inputs[1] <== domainSalt;
    nullifier === poseidon2.out;

    // Verify new commitment = Poseidon(newConsent, timestamp, identitySecret)
    poseidon3New.inputs[0] <== newConsent;
    poseidon3New.inputs[1] <== timestamp;
    poseidon3New.inputs[2] <== identitySecret;
    newConsentCommitment === poseidon3New.out;

    // Enforce monotonic consent: newConsent >= oldConsent
    consentCheck.in[0] <== newConsent;
    consentCheck.in[1] <== oldConsent;
    consentCheck.out === 1; // newConsent >= oldConsent
    
    // Enforce max consent age: currentTime - timestamp <= 2 years (63072000 seconds)
    var TWO_YEARS = 63072000;
    timeCheck.in[0] <== currentTime - timestamp;
    timeCheck.in[1] <== TWO_YEARS;
    timeCheck.out === 1; // currentTime - timestamp <= TWO_YEARS
}

component main = ConsentCircuit();

