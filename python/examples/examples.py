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
show('from_code("74UYC19")', lambda: from_code("74UYC19"))
show('from_code("74uyc 19")', lambda: from_code("74uyc 19"))
show('from_code("74UYC1X")', lambda: from_code("74UYC1X"))
show("to_code(481890304)", lambda: to_code(481890304))

# 2. A frozen preset: load baseh-medium-v1 and use the full codec.
print("== preset ==")
medium = Baseh(baseh_medium_v1())
show("encode(123456789)", lambda: medium.encode(123456789))
show('decode("74UYC19").id', lambda: medium.decode("74UYC19").id)
show('decode("OOOOOOC").id (typed aliases)', lambda: medium.decode("OOOOOOC").id)
show("encode(1131) (blocked word)", lambda: medium.encode(1131))
show('decode("742YC19") (checksum typo)', lambda: medium.decode("742YC19"))
show("capacity", lambda: medium.capacity())

# 3. Customized: load a preset, extend the body and add a delimiter.
print("== customized ==")
custom = baseh_medium_v1()
custom["profileId"] = "orders-v1"
custom["bodyLength"] = 7
custom["separator"] = "-"
custom["grouping"] = [4, 4]
orders = Baseh(custom)
show("encode(123456789)", lambda: orders.encode(123456789))
show("decode(...) round trip", lambda: orders.decode(orders.encode(123456789)).id)
show('decode("D4UY-C190") (bad check)', lambda: orders.decode("D4UY-C190"))
show("capacity", lambda: orders.capacity())
