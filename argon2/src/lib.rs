#[cfg(feature = "generate")]
use argon2::password_hash::{PasswordHasher, SaltString};
use argon2::{
    password_hash::{PasswordHash, PasswordVerifier},
    Algorithm, Argon2, Params, Version,
};
use wasm_bindgen::prelude::wasm_bindgen;
#[cfg(feature = "generate")]
use wasm_bindgen::JsValue;

#[cfg(feature = "generate")]
fn js_error(context: &str, error: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&format!("{context}: {error}"))
}
const MEMORY_COST_KIB: u32 = 8 * 1024;
const TIME_COST: u32 = 2;
const PARALLELISM: u32 = 1;
const OUTPUT_LENGTH: usize = 32;

fn argon2() -> Argon2<'static> {
    let params = Params::new(MEMORY_COST_KIB, TIME_COST, PARALLELISM, Some(OUTPUT_LENGTH))
        .expect("the built-in Argon2id parameters are valid");

    Argon2::new(Algorithm::default(), Version::default(), params)
}

#[cfg(feature = "generate")]
#[wasm_bindgen]
pub fn create_password_hash(password: &str, salt: &[u8]) -> Result<String, JsValue> {
    let salt = SaltString::encode_b64(salt)
        .map_err(|error| js_error("failed to encode password salt", error))?;

    argon2()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| js_error("failed to hash password", error))
}

#[wasm_bindgen]
pub fn verify_password_hash(password: &str, encoded_hash: &str) -> bool {
    let Ok(hash) = PasswordHash::new(encoded_hash) else {
        return false;
    };

    argon2().verify_password(password.as_bytes(), &hash).is_ok()
}
