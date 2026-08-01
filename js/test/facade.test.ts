import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Baseh, BasehError,
  basehExpandableV1,
  encode, decode, validate
} from "../src/index.js";

describe("zero-config facade", () => {
  it("encode returns a string", () => {
    assert.equal(typeof encode(42), "string");
  });

  it("decode(encode(i)) round-trips", () => {
    for (const id of [0n, 1n, 42n, 32768n, 1_336_336n, 9_007_199_254_740_991n]) {
      assert.equal(decode(encode(id)).id, id);
    }
    // number input works too
    assert.equal(decode(encode(12345)).id, 12345n);
  });

  it("agrees with a manually constructed default-profile instance", () => {
    const instance = new Baseh(basehExpandableV1());
    for (const id of [0n, 7n, 123_456_789n]) {
      assert.equal(encode(id), instance.encode(id));
      assert.deepEqual(decode(instance.encode(id)), instance.decode(instance.encode(id)));
    }
  });

  it("decode errors surface like the instance API", () => {
    const instance = new Baseh(basehExpandableV1());
    assert.throws(
      () => decode("!!!"),
      (e: unknown) => e instanceof BasehError && e.code === "INVALID_CHARACTER"
    );
    const bad = encode(100n).slice(0, -1) + "0";
    assert.throws(() => decode(bad), (e: unknown) => e instanceof BasehError);
    assert.throws(
      () => instance.decode(bad),
      (e: unknown) => e instanceof BasehError && e.code === (() => { try { decode(bad); } catch (err) { return (err as BasehError).code; } })()
    );
    // validate never throws and reports invalid
    assert.equal(validate("!!!").valid, false);
  });
});
