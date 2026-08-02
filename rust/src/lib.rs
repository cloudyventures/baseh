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

#![forbid(unsafe_code)]

mod basen;
mod checksum;
mod codec;
mod error;
mod facade;
mod profile;
mod profiles;

pub mod feistel;

pub use codec::{
    expandable_grouping, Baseh, ConfusionProfile, DecodeOptions, DecodeResult, InspectResult,
    ValidateOutcome,
};
pub use error::{BasehError, ErrorCode};
pub use facade::{decode, encode, inspect, validate};
pub use profile::{Mode, Permutation, Profanity, ProfanityMode, Profile, DEFAULT_BLOCKLIST};
pub use profiles::{
    baseh_expandable_p_v1, baseh_expandable_v1, baseh_heavy_p_v1, baseh_heavy_v1, baseh_light_p_v1,
    baseh_light_v1, baseh_medium_p_v1, baseh_medium_v1, baseh_minimum_p_v1, baseh_minimum_v1,
    FROZEN_KEY_BYTES,
};
