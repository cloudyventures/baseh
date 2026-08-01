//! Zero-config pair over the frozen baseh-medium-v1 profile.
//!
//! No profile object, no key: just the two functions an application needs
//! when it does not want to think about configuration.
//!
//! ```text
//! to_code(id)    -> "7KM4Q2H"
//! from_code(code) -> id
//! ```
//!
//! `to_code` accepts any unsigned integer type, a [`BigUint`] or a decimal
//! string. `from_code` strips every whitespace character (edges and
//! internal), accepts lowercase and the typed aliases (O, I, L) and returns
//! the id as a [`BigUint`]. Any invalid input returns [`BasehError`],
//! including the rare `BLOCKED_CODE` identifiers that spell a blocklisted
//! word; no correction attempts are ever made.

use std::sync::OnceLock;

use num_bigint::BigUint;

use crate::codec::{Baseh, DecodeOptions};
use crate::error::BasehError;
use crate::profiles::baseh_medium_v1;

static ZERO: OnceLock<Baseh> = OnceLock::new();

fn zero() -> &'static Baseh {
    ZERO.get_or_init(|| {
        Baseh::new(baseh_medium_v1()).expect("the frozen baseh-medium-v1 profile is valid")
    })
}

/// Identifier inputs accepted by [`to_code`].
///
/// Unsigned integer types and [`BigUint`] convert directly. A string must
/// be decimal digits with no sign or separators; anything else panics,
/// mirroring the `TypeError` the JS and Python ports raise for non-digit
/// strings.
pub trait ToCodeId {
    fn into_biguint(self) -> BigUint;
}

macro_rules! impl_to_code_id_for_uint {
    ($($t:ty),*) => {
        $(impl ToCodeId for $t {
            fn into_biguint(self) -> BigUint {
                BigUint::from(self)
            }
        })*
    };
}

impl_to_code_id_for_uint!(u8, u16, u32, u64, u128, usize);

impl ToCodeId for BigUint {
    fn into_biguint(self) -> BigUint {
        self
    }
}

impl ToCodeId for &BigUint {
    fn into_biguint(self) -> BigUint {
        self.clone()
    }
}

/// Strings must be digits only (spec 3.5 decimal form), like the JS and
/// Python ports. `+`, whitespace or any non-digit panics.
fn decimal_to_biguint(s: &str) -> BigUint {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        panic!("to_code expects a non-negative integer or a decimal string of digits");
    }
    BigUint::parse_bytes(s.as_bytes(), 10).expect("validated decimal digits")
}

impl ToCodeId for &str {
    fn into_biguint(self) -> BigUint {
        decimal_to_biguint(self)
    }
}

impl ToCodeId for String {
    fn into_biguint(self) -> BigUint {
        decimal_to_biguint(&self)
    }
}

impl ToCodeId for &String {
    fn into_biguint(self) -> BigUint {
        decimal_to_biguint(self)
    }
}

/// Encode an identifier with the zero-config Medium profile.
pub fn to_code(id: impl ToCodeId) -> Result<String, BasehError> {
    zero().encode(&id.into_biguint())
}

/// Decode a code from the zero-config Medium profile back to its identifier.
///
/// Every whitespace character (edges and internal) is stripped first, so
/// pasted or formatted codes decode without caller pre-cleaning.
pub fn from_code(code: &str) -> Result<BigUint, BasehError> {
    let stripped: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    Ok(zero().decode(&stripped, &DecodeOptions::default())?.id)
}
