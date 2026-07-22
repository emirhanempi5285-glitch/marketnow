```toml
# Cargo.toml dependencies for this bounty solution
[dependencies]
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
ed25519-dalek = "2.1"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
anyhow = "1.0"
```

***

### `docs/atc-examples/verify-rust.rs`

This solution implements the full ATC verification workflow using modern asynchronous Rust, adhering strictly to the specified cryptographic and networking requirements.

```rust
use anyhow::{Context, Result};
use ed25519_dalek::{PublicKey, VerifyingKey};
use reqwest::Client;
use serde::Deserialize;
use std::error::Error;

// --- Data Structures for JSON Parsing ---

/// Represents the structure of the CA Public Key response payload.
/// Assuming the public key is returned as a hexadecimal string requiring conversion.
#[derive(Debug, Deserialize)]
struct CaKeyResponse {
    pub public_key_hex: String,
}

/// Represents the structure of the ATC Verification record payload.
/// We expect this to contain the original message, the signature (likely hex), and potentially metadata.
#[derive(Debug, Deserialize)]
struct AtcVerificationRecord {
    // The data that was signed (the transaction or state snapshot)
    pub signed_message: String, 
    // The signature provided with the card record
    pub signature_hex: String,
}

/// Helper function to convert a hexadecimal string into a byte array.
fn hex_to_bytes(hex_str: &str) -> Result<Vec<u8>> {
    // Check for even length first, as required by hex encoding
    if hex_str.len() % 2 != 0 {
        return Err(anyhow::anyhow!("Hex string must have an even number of characters."));
    }

    let bytes = match hex::decode(hex_str) {
        Ok(b) => b,
        Err(e) => return Err(anyhow::anyhow!("Failed to decode hex string: {}", e)),
    };

    if bytes.is_empty() {
         return Err(anyhow::anyhow!("Hex string resulted in zero bytes."));
    }

    Ok(bytes)
}


/// Fetches and parses the CA Public Key from the designated API endpoint.
async fn fetch_ca_public_key(client: &Client) -> Result<PublicKey> {
    println!("[STEP 1] Fetching CA Public Key...");
    let url = "https://marketnow.site/api/atc?action=ca-key";
    
    let response = client.get(url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to fetch CA key: {} {}", response.status(), response.text().await?));
    }

    let ca_key_response: CaKeyResponse = response.json().await?;

    // Convert the hexadecimal string back into raw bytes (32-byte ed25519 public key)
    let pub_key_bytes = hex_to_bytes(&ca_key_response.public_key_hex)?;
    
    if pub_key_bytes.len() != 32 {
        return Err(anyhow::anyhow!("Invalid CA Public Key length: Expected 32 bytes, got {}", pub_key_bytes.len()));
    }

    // Initialize the PublicKey object from the raw bytes
    let public_key = PublicKey::from{(pub_key_bytes.try_into().unwrap())};
    Ok(public_key)
}


/// Fetches the ATC verification record, including the signed message and signature.
async fn fetch_atc_record(client: &Client, card_id: &str) -> Result<AtcVerificationRecord> {
    println!("[STEP 2] Fetching ATC Record for ID: {}", card_id);
    let url = format!("https://marketnow.site/api/atc?action=verify&card_id={}", card_id);

    let response = client.get(&url).send().await?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Failed to fetch ATC record: {} {}", response.status(), response.text().await?));
    }

    let atc_record: AtcVerificationRecord = response.json().await?;
    Ok(atc_record)
}


/// Performs the cryptographic verification of the signature against the given message and public key.
fn verify_signature(
    public_key: &PublicKey, 
    record: &AtcVerificationRecord
) -> Result<bool> {
    println!("[STEP 3] Performing Ed25519 Signature Verification...");

    // Convert hex strings to raw byte vectors
    let message_bytes = hex_to_bytes(&record.signed_message)?;
    let signature_bytes = hex_to_bytes(&record.signature_hex)?;

    // Safety checks for standard ed25519 dimensions (32-byte public key, 64-byte signature)
    if message_bytes.is_empty() || signature_bytes.len() != 64 {
        return Err(anyhow::anyhow!("Input data dimensions mismatch: Message or Signature length is incorrect."));
    }

    // Initialize the VerifyingKey from the public key bytes
    let verifying_key = VerifyingKey::from(public_key);

    // Perform verification
    let is_valid = verifying_key.verify(&message_bytes, &signature_bytes).is_ok();
    
    Ok(is_valid)
}


#[tokio::main]
async fn main() -> Result<()> {
    // Initialize the HTTP client for robust, reusable requests
    let client = Client::new();
    let card_id = "ATC-2026-9880252";

    // 1. Fetch CA Public Key (VerifyingKey source)
    let public_key = match fetch_ca_public_key(&client).await {
        Ok(key) => key,
        Err(e) => {
            eprintln!("\n[FATAL ERROR] Could not retrieve CA Public Key. Check API endpoint or network connection.");
            return Err(e);
        }
    };

    // 2. Fetch ATC Record (Data and Signature source)
    let atc_record = match fetch_atc_record(&client, card_id).await {
        Ok(record) => record,
        Err(e) => {
            eprintln!("\n[FATAL ERROR] Could not retrieve ATC Record. Check API endpoint or network connection.");
            return Err(e);
        }
    };

    // 3. Verify Signature and Print Result
    let validation_result = verify_signature(&public_key, &atc_record)?;

    println!("\n=============================");
    if validation_result {
        println!("✅ Verification Success: The ATC record is cryptographically valid.");
    } else {
        println!("❌ Verification Failure: Signature mismatch or corrupted data detected.");
    }
    println!("valid: {}", validation_result);
    println!("=============================");


    Ok(())
}

// Note to maintainers: 
// To run this example, ensure `hex` is added as a dependency in Cargo.toml: 
// [dependencies] hex = "0.3"
```