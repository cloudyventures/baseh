//! # baseh
//!
//! Rust implementation of the baseH codec:
//! fixed-length, checksummed, optionally permuted human-readable
//! identifiers. Mirrors the normative specification in
//! `spec/IMPLEMENTATION_CODEC.md` at the repository root.
//!
//! ```
//! use num_bigint::BigUint;
//!
//! let profile = baseh::baseh_medium_v1();
//! let baseh = baseh::Baseh::new(profile).unwrap();
//! let code = baseh.encode(&BigUint::from(42u64)).unwrap();
//! let result = baseh.decode(&code, &baseh::DecodeOptions::default()).unwrap();
//! assert_eq!(result.id, BigUint::from(42u64));
//! ```

mod basen;
mod checksum;
mod codec;
mod error;
mod profile;
mod profiles;
mod zero;

pub mod feistel;

pub use codec::{Baseh, ConfusionProfile, DecodeOptions, DecodeResult, ValidateOutcome};
pub use error::{BasehError, ErrorCode};
pub use profile::{Permutation, Profanity, ProfanityMode, Profile, DEFAULT_BLOCKLIST};
pub use profiles::{
    baseh_heavy_p_v1, baseh_heavy_v1, baseh_light_p_v1, baseh_light_v1, baseh_medium_p_v1,
    baseh_medium_v1, baseh_minimum_p_v1, baseh_minimum_v1, FROZEN_KEY_BYTES,
};
pub use zero::{from_code, to_code, ToCodeId};
