//! Runnable examples for the baseh Rust crate.
//! Run from rust/:  cargo run --example examples

use baseh::{baseh_medium_v1, from_code, to_code, Baseh, DecodeOptions};
use num_bigint::BigUint;

fn show_str(label: &str, r: Result<String, baseh::BasehError>) {
    match r {
        Ok(v) => println!("{label} -> {v}"),
        Err(e) => println!("{label} -> returns BasehError [{:?}]: {}", e.code, e.message),
    }
}

fn show_id(label: &str, r: Result<BigUint, baseh::BasehError>) {
    match r {
        Ok(v) => println!("{label} -> {v}"),
        Err(e) => println!("{label} -> returns BasehError [{:?}]: {}", e.code, e.message),
    }
}

fn main() {
    let id = BigUint::from(123456789u64);

    // 1. Zero configuration: the default Medium tier behind two functions.
    println!("== zero config ==");
    show_str("to_code(123456789u64)", to_code(123456789u64));
    show_str("to_code(id.clone())", to_code(id.clone()));
    show_str("to_code(\"123456789\")", to_code("123456789"));
    show_id("from_code(\"74UYC19\")", from_code("74UYC19"));
    show_id("from_code(\"74uyc 19\")", from_code("74uyc 19"));
    show_id("from_code(\"74UYC1X\")", from_code("74UYC1X"));
    show_str("to_code(481890304u64)", to_code(481890304u64));

    // 2. A frozen preset: load baseh-medium-v1 and use the full codec.
    println!("== preset ==");
    let medium = Baseh::new(baseh_medium_v1()).expect("valid profile");
    show_str("encode(123456789)", medium.encode(&id));
    show_id(
        "decode(\"74UYC19\").id",
        medium.decode("74UYC19", &DecodeOptions::strict()).map(|r| r.id),
    );
    show_id(
        "decode(\"OOOOOOC\").id (typed aliases)",
        medium.decode("OOOOOOC", &DecodeOptions::strict()).map(|r| r.id),
    );
    show_str("encode(1131) (blocked word)", medium.encode(&BigUint::from(1131u64)));
    show_id(
        "decode(\"742YC19\") (checksum typo)",
        medium.decode("742YC19", &DecodeOptions::strict()).map(|r| r.id),
    );
    println!("capacity -> {}", medium.capacity());

    // 3. Customized: load a preset, extend the body and add a delimiter.
    println!("== customized ==");
    let mut custom = baseh_medium_v1();
    custom.profile_id = "orders-v1".to_string();
    custom.body_length = 7;
    custom.separator = "-".to_string();
    custom.grouping = vec![4, 4];
    let orders = Baseh::new(custom).expect("valid profile");
    show_str("encode(123456789)", orders.encode(&id));
    let code = orders.encode(&id).expect("in range");
    show_id(
        "decode(...) round trip",
        orders.decode(&code, &DecodeOptions::strict()).map(|r| r.id),
    );
    show_id(
        "decode(\"D4UY-C190\") (bad check)",
        orders.decode("D4UY-C190", &DecodeOptions::strict()).map(|r| r.id),
    );
    println!("capacity -> {}", orders.capacity());
}
