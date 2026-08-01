//! # base-human
//!
//! Rust implementation of the BaseH (Base Human) codec:
//! fixed-length, checksummed, optionally permuted human-readable
//! identifiers. Mirrors the normative specification in
//! `spec/IMPLEMENTATION_CODEC.md` at the repository root.
//!
//! ```
//! use num_bigint::BigUint;
//!
//! let profile = base_human::baseh32_v1(b"application-key-material", "app-key-1");
//! let baseh = base_human::Baseh::new(profile).unwrap();
//! let code = baseh.encode(&BigUint::from(42u64)).unwrap();
//! let result = baseh.decode(&code, &base_human::DecodeOptions::default()).unwrap();
//! assert_eq!(result.id, BigUint::from(42u64));
//! ```

mod basen;
mod checksum;
mod codec;
mod error;
mod profile;
mod profiles;

pub mod feistel;

pub use codec::{Baseh, ConfusionProfile, DecodeOptions, DecodeResult, ValidateOutcome};
pub use error::{BasehError, ErrorCode};
pub use profile::{Permutation, Profanity, ProfanityMode, Profile, DEFAULT_BLOCKLIST};
pub use profiles::{baseh32_v1, baseh32s_v1};
