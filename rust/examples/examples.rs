//! Runnable examples for the baseh Rust crate.
//! Run from rust/:  cargo run --example examples

use baseh::{
    baseh_expandable_v1, baseh_medium_v1, from_code, to_code, Baseh, ConfusionProfile,
    DecodeOptions,
};
use num_bigint::BigUint;

fn show_str(label: &str, r: Result<String, baseh::BasehError>) {
    match r {
        Ok(v) => println!("{label} -> {v}"),
        Err(e) => println!(
            "{label} -> returns BasehError [{:?}]: {}",
            e.code, e.message
        ),
    }
}

fn show_id(label: &str, r: Result<BigUint, baseh::BasehError>) {
    match r {
        Ok(v) => println!("{label} -> {v}"),
        Err(e) => println!(
            "{label} -> returns BasehError [{:?}]: {}",
            e.code, e.message
        ),
    }
}

fn main() {
    let id = BigUint::from(123456789u64);
    let strict = DecodeOptions::strict();

    // 1. Expandable mode: shipping in the next release; shown here as the new
    // default. Codes start at 4 characters and grow one character at a time
    // as the id sequence climbs — old shorter codes keep decoding forever.
    println!("== expandable ==");
    let expandable = Baseh::new(baseh_expandable_v1()).expect("valid profile");
    show_str("encode(813)", expandable.encode(&BigUint::from(813u64)));
    // 4 characters at this namespace size; grows as ids climb.
    show_str("encode(123456789)", expandable.encode(&id));
    // a few characters longer than the 4-character minimum; no left-padding.
    let code = expandable.encode(&id).expect("in range");
    show_id(
        "decode(...) round trip",
        expandable.decode(&code, &strict).map(|r| r.id),
    );

    // 2. Zero configuration: the default Medium tier behind two functions.
    println!("== zero config ==");
    show_str("to_code(123456789u64)", to_code(123456789u64));
    show_str("to_code(id.clone())", to_code(id.clone()));
    show_str("to_code(\"123456789\")", to_code("123456789"));
    show_id("from_code(\"C8XP-8J49\")", from_code("C8XP-8J49"));
    show_id("from_code(\"c8xp 8j49\")", from_code("c8xp 8j49"));
    show_id("from_code(\"C8XP-8J4X\")", from_code("C8XP-8J4X"));
    show_str("to_code(481890304u64)", to_code(481890304u64));

    // 3. A frozen preset: load baseh-medium-v1 and use the full codec.
    println!("== preset ==");
    let medium = Baseh::new(baseh_medium_v1()).expect("valid profile");
    show_str("encode(123456789)", medium.encode(&id));
    show_id(
        "decode(\"C8XP-8J49\").id",
        medium.decode("C8XP-8J49", &strict).map(|r| r.id),
    );
    show_id(
        "decode(\"UORY-PDCA\").id (typed aliases)",
        medium.decode("UORY-PDCA", &strict).map(|r| r.id),
    );
    show_str(
        "encode(813) (blocked word)",
        medium.encode(&BigUint::from(813u64)),
    );
    show_id(
        "decode(\"C8XP-8J4X\") (checksum typo)",
        medium.decode("C8XP-8J4X", &strict).map(|r| r.id),
    );

    // A spoken typo repairs itself: with correction armed the decoder returns
    // the id together with the amended canonical code.
    let repair = DecodeOptions {
        try_correction: true,
        confusion_profile: ConfusionProfile::Heavy,
        max_corrections: 1,
        ..strict.clone()
    };
    match medium.decode("MGV3-JKDJ", &repair) {
        Ok(result) => println!(
            "decode(\"MGV3-JKDJ\") (spoken typo) -> Identifier: {}, corrected to {}",
            result.id, result.canonical_code
        ),
        Err(e) => println!(
            "decode(\"MGV3-JKDJ\") (spoken typo) -> returns BasehError [{:?}]: {}",
            e.code, e.message
        ),
    }
    println!("capacity -> {}", medium.capacity());

    // 4. Customized: load a preset and extend the body length.
    println!("== customized ==");
    let mut custom = baseh_medium_v1();
    custom.profile_id = "orders-v1".to_string();
    custom.body_length = 7;
    custom.grouping = vec![5, 4];
    let orders = Baseh::new(custom).expect("valid profile");
    show_str("encode(123456789)", orders.encode(&id));
    let code = orders.encode(&id).expect("in range");
    show_id(
        "decode(...) round trip",
        orders.decode(&code, &strict).map(|r| r.id),
    );
    show_id(
        "decode(\"ZC8VR-EMJ0\") (bad check)",
        orders.decode("ZC8VR-EMJ0", &strict).map(|r| r.id),
    );
    println!("capacity -> {}", orders.capacity());

    // Expandable profiles customize the same way: `mode` is "expandable",
    // `min_length` sets the shortest codes (default 4) and
    // `separator_min_length` controls when hyphen grouping appears (the
    // shipped tier uses 6 — shorter codes carry no separator).
    let mut growing = baseh_expandable_v1();
    growing.profile_id = "invoices-v1".to_string();
    growing.min_length = 5;
    growing.separator_min_length = 7;
    let invoices = Baseh::new(growing).expect("valid profile");
    show_str("encode(123456789)", invoices.encode(&id));
}
