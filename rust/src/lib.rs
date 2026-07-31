//! # base-human
//!
//! Rust implementation of the HRC (Human Reference Code) codec:
//! fixed-length, checksummed, optionally permuted human-readable
//! identifiers. Mirrors the normative specification in
//! `spec/IMPLEMENTATION_CODEC.md` at the repository root.
//!
//! ```
//! use num_bigint::BigUint;
//!
//! let profile = base_human::hrc32_v1(b"application-key-material", "app-key-1");
//! let hrc = base_human::Hrc::new(profile).unwrap();
//! let code = hrc.encode(&BigUint::from(42u64)).unwrap();
//! let result = hrc.decode(&code, &base_human::DecodeOptions::default()).unwrap();
//! assert_eq!(result.id, BigUint::from(42u64));
//! ```

mod basen;
mod checksum;
mod codec;
mod error;
mod profile;
mod profiles;

pub mod feistel;

pub use codec::{ConfusionProfile, DecodeOptions, DecodeResult, Hrc, ValidateOutcome};
pub use error::{ErrorCode, HrcError};
pub use profile::{Permutation, Profile};
pub use profiles::{hrc32_v1, hrc32s_v1};
