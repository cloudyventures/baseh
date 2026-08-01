"""Runnable examples for the baseh Python package.

Run from python/:  PYTHONPATH=src python3 examples/examples.py
"""
from baseh import (
    Baseh,
    BasehError,
    baseh_expandable_v1,
    baseh_medium_v1,
    from_code,
    to_code,
)


def show(label, fn):
    try:
        print(f"{label} -> {fn()}")
    except BasehError as e:
        print(f"{label} -> raises BasehError [{e.code}]: {e}")


# 1. Expandable mode: shipping in the next release; shown here as the new
# default. Codes start at 4 characters and grow automatically as ids climb;
# shorter codes keep decoding forever.
print("== expandable ==")
expandable = Baseh(baseh_expandable_v1())
show("encode(123456789)", lambda: expandable.encode(123456789))
# 4 characters at this namespace size; grows as ids climb
show(
    "decode(...) round trip",
    lambda: expandable.decode(expandable.encode(123456789)).id,
)
show('decode lowercase', lambda: expandable.decode(expandable.encode(42).lower()).id)

# 2. Zero configuration: the default Medium tier behind two functions.
print("== zero config ==")
show("to_code(123456789)", lambda: to_code(123456789))
show('to_code("123456789")', lambda: to_code("123456789"))
show('from_code("C8XP-8J49")', lambda: from_code("C8XP-8J49"))
show('from_code("c8xp 8j49")', lambda: from_code("c8xp 8j49"))
show('from_code("C8XP-8J4X")', lambda: from_code("C8XP-8J4X"))
show("to_code(481890304)", lambda: to_code(481890304))

# 3. A frozen preset: load baseh-medium-v1 and use the full codec.
print("== preset ==")
medium = Baseh(baseh_medium_v1())
show("encode(123456789)", lambda: medium.encode(123456789))
show('decode("C8XP-8J49").id', lambda: medium.decode("C8XP-8J49").id)
show('decode("UORY-PDCA").id (typed aliases)', lambda: medium.decode("UORY-PDCA").id)
show("encode(813) (blocked word)", lambda: medium.encode(813))
show('decode("CC8G-AZ2X") (checksum typo)', lambda: medium.decode("CC8G-AZ2X"))
show("capacity", lambda: medium.capacity())


# Assisted correction: a user heard a spoken C as a G and typed it wrong.
def corrected_demo():
    result = medium.decode(
        "GC8G-AZ2V", try_correction=True, confusion_profile="heavy"
    )
    return f"Identifier: {result.id}, corrected to {result.canonical_code}"


show('decode("GC8G-AZ2V") (heard C as G)', corrected_demo)

# 4. Customized: load a preset, extend the body and regroup the output.
print("== customized ==")
custom = baseh_medium_v1()
custom["profileId"] = "orders-v1"
custom["bodyLength"] = 7
custom["grouping"] = [4, 5]
orders = Baseh(custom)
show("encode(123456789)", lambda: orders.encode(123456789))
show("decode(...) round trip", lambda: orders.decode(orders.encode(123456789)).id)
show('decode("ZC8V-REMJ2") (bad check)', lambda: orders.decode("ZC8V-REMJ2"))
show("capacity", lambda: orders.capacity())

# 5. Customized expandable: start longer, hyphenate only at 8+ characters.
# Profiles carry "mode" ("expandable" or "fixed"); expandable adds
# "minLength" (default 4) and "separatorMinLength" (the shipped tier
# uses 6). A custom bodyAlphabet has any 0/O silently removed.
print("== customized expandable ==")
custom_exp = baseh_expandable_v1()
custom_exp["profileId"] = "tickets-v1"
custom_exp["mode"] = "expandable"  # already set by the helper; shown for clarity
custom_exp["minLength"] = 5
custom_exp["separatorMinLength"] = 8
tickets = Baseh(custom_exp)
show("encode(123456789)", lambda: tickets.encode(123456789))
# 5+ characters, no hyphen until codes reach 8 characters
show(
    "decode(...) round trip",
    lambda: tickets.decode(tickets.encode(123456789)).id,
)
