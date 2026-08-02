//! Zero-config facade over the frozen baseh-expandable-v1 profile.
//!
//! Most callers only ever want the recommended default tier; these
//! package-level functions encode and decode through a lazily-constructed
//! shared [`Baseh`] instance so no profile object is ever needed.
//!
//! ```
//! use num_bigint::BigUint;
//!
//! let code = baseh::encode(&BigUint::from(42u64)).unwrap();
//! let result = baseh::decode(&code).unwrap();
//! assert_eq!(result.id, BigUint::from(42u64));
//! ```

use std::sync::OnceLock;

use num_bigint::BigUint;

use crate::codec::{Baseh, DecodeOptions, DecodeResult, ValidateOutcome};
use crate::error::BasehError;
use crate::profiles::baseh_expandable_v1;

static DEFAULT: OnceLock<Baseh> = OnceLock::new();

fn default() -> &'static Baseh {
    DEFAULT.get_or_init(|| {
        Baseh::new(baseh_expandable_v1()).expect("the frozen baseh-expandable-v1 profile is valid")
    })
}

/// Encode an identifier with the default expandable v1 profile.
pub fn encode(id: &BigUint) -> Result<String, BasehError> {
    default().encode(id)
}

/// Decode a code from the default expandable v1 profile.
///
/// Uses strict decode options, exactly like calling
/// `Baseh::decode(code, &DecodeOptions::default())` on an instance built
/// from [`baseh_expandable_v1`].
pub fn decode(code: &str) -> Result<DecodeResult, BasehError> {
    default().decode(code, &DecodeOptions::default())
}

/// Validate a code from the default expandable v1 profile.
///
/// Never fails on user input, exactly like calling
/// `Baseh::validate(code, &DecodeOptions::default())` on an instance built
/// from [`baseh_expandable_v1`].
pub fn validate(code: &str) -> ValidateOutcome {
    default().validate(code, &DecodeOptions::default())
}
