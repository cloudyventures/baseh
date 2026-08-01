"""Runnable examples for the baseh Python package.

Run from python/:  PYTHONPATH=src python3 examples/examples.py
"""
from baseh import Baseh, BasehError, baseh_medium_v1, from_code, to_code


def show(label, fn):
    try:
        print(f"{label} -> {fn()}")
    except BasehError as e:
        print(f"{label} -> raises BasehError [{e.code}]: {e}")


# 1. Zero configuration: the default Medium tier behind two functions.
print("== zero config ==")
show("to_code(123456789)", lambda: to_code(123456789))
show('to_code("123456789")', lambda: to_code("123456789"))
show('from_code("C8XP-8J49")', lambda: from_code("C8XP-8J49"))
show('from_code("c8xp 8j49")', lambda: from_code("c8xp 8j49"))
show('from_code("C8XP-8J4X")', lambda: from_code("C8XP-8J4X"))
show("to_code(481890304)", lambda: to_code(481890304))

# 2. A frozen preset: load baseh-medium-v1 and use the full codec.
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

# 3. Customized: load a preset, extend the body and regroup the output.
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
