"""Unit tests for Baseh.inspect (spec 12.5), mirroring js/test/inspect.test.ts:
every state, fixed and expandable prefixes, aliases while typing,
whitespace, over-length, and the spec 3.4 padded-prefix case."""

import unittest

from baseh import (
    Baseh,
    InspectResult,
    baseh_expandable_v1,
    baseh_heavy_v1,
    baseh_medium_v1,
    baseh_minimum_v1,
    inspect,
)


def _filter_free(profile: dict) -> dict:
    """Clone without the blocklist, repetition filter or permutation, so
    scanning encode outputs is undisturbed."""
    clone = dict(profile)
    clone["profanity"] = {"mode": "none"}
    clone["maxRepetition"] = 0
    return clone


class TestInspectFixed(unittest.TestCase):
    """Fixed mode, baseh-medium-v1: expected 8 symbols, grouping [4, 4]."""

    @classmethod
    def setUpClass(cls):
        cls.medium = Baseh(baseh_medium_v1())
        cls.canonical = cls.medium.encode(123456789)
        cls.raw = cls.canonical.replace("-", "")

    def test_empty_states(self):
        self.assertEqual(self.medium.inspect(""), InspectResult(state="empty"))
        self.assertEqual(self.medium.inspect("   "), InspectResult(state="empty"))
        self.assertEqual(self.medium.inspect(" - \t"), InspectResult(state="empty"))

    def test_typing_prefixes_carry_normalized_symbols_and_progress(self):
        for n in range(1, 8):
            result = self.medium.inspect(self.raw[:n])
            self.assertEqual(result.state, "typing", f"prefix {n}")
            self.assertEqual(result.typed.replace("-", ""), self.raw[:n])
            self.assertAlmostEqual(result.progress, n / 8, delta=1e-12)
        # Separators inserted as far as the groups go (grouping [4, 4]).
        result = self.medium.inspect(self.raw[:5])
        self.assertEqual(result.typed, self.raw[:4] + "-" + self.raw[4])

    def test_typing_lowercase_and_aliases_normalize(self):
        lower = self.medium.inspect(self.raw[:5].lower())
        self.assertEqual(lower.state, "typing")
        self.assertEqual(lower.typed, self.raw[:4] + "-" + self.raw[4])
        # Alias source typed mid-code normalizes to its target (O -> 0 etc.).
        clone = Baseh(
            {
                **baseh_medium_v1(),
                "permutation": {"enabled": False},
                "profanity": {"mode": "none"},
                "maxRepetition": 0,
            }
        )
        aliased = clone.inspect("OIL")
        self.assertEqual(aliased.state, "typing")
        self.assertEqual(aliased.typed, "011")

    def test_typing_whitespace_and_stray_separators_ignored_for_counting(self):
        messy = " " + self.raw[:2] + " -" + self.raw[2:5] + "\t"
        result = self.medium.inspect(messy)
        self.assertEqual(result.state, "typing")
        self.assertEqual(result.typed.replace("-", ""), self.raw[:5])

    def test_spec_3_4_padded_prefix_still_reports_typing(self):
        # Find a short input whose re-padded form validates (the cookbook's
        # "false green"), on a filter-free clone so the scan is not disturbed
        # by the blocklist or repetition filter.
        clone = Baseh(_filter_free(baseh_medium_v1()))
        found = None
        for id in range(200000):
            raw = clone.encode(id).replace("-", "")
            stripped = raw.lstrip("0") or "0"
            if len(stripped) < len(raw) and len(stripped) >= 2:
                if clone.validate(stripped)["valid"]:
                    found = stripped
                    break
        self.assertIsNotNone(found, "no false-green prefix found in scan window")
        result = self.medium.inspect(found)
        self.assertEqual(result.state, "typing")

    def test_valid_complete_code(self):
        result = self.medium.inspect(self.canonical)
        self.assertEqual(
            result,
            InspectResult(state="valid", id=123456789, canonical_code=self.canonical),
        )
        # No separators, lowercase, surrounding whitespace all reach valid.
        messy = " " + self.raw.lower() + " "
        self.assertEqual(self.medium.inspect(messy), result)

    def test_valid_alias_typed_complete_code_decodes(self):
        clone = Baseh(_filter_free(baseh_medium_v1()))
        # Find a code containing 8, type it with B (B -> 8).
        for id in range(1, 100000):
            raw = clone.encode(id).replace("-", "")
            if "8" in raw:
                result = clone.inspect(raw.replace("8", "B", 1))
                self.assertEqual(result.state, "valid")
                self.assertEqual(result.id, id)
                return
        self.fail("no code containing 8 found")

    def test_invalid_wrong_checksum_carries_reason(self):
        canonical = self.medium.encode(77)
        raw = canonical.replace("-", "")
        bad_check = "3" if raw[6] == "2" else "2"
        bad = raw[:6] + bad_check + raw[7]
        self.assertEqual(
            self.medium.inspect(bad),
            InspectResult(state="invalid", reason="INVALID_CHECKSUM"),
        )

    def test_bad_char_symbol_outside_both_alphabets(self):
        self.assertEqual(self.medium.inspect("12@"), InspectResult(state="bad-char"))
        self.assertEqual(
            self.medium.inspect("1234-56@8"), InspectResult(state="bad-char")
        )

    def test_checksum_only_symbol_in_body_region_is_invalid_not_bad_char(self):
        # U is in the Heavy checksum alphabet but not its body alphabet: it
        # passes the union-membership gate and fails under validate, exactly
        # like the shared error vector (heavy "U00000A" -> INVALID_CHARACTER).
        heavy = Baseh(baseh_heavy_v1())
        self.assertEqual(
            heavy.inspect("U000000A"),
            InspectResult(state="invalid", reason="INVALID_CHARACTER"),
        )

    def test_too_long(self):
        self.assertEqual(
            self.medium.inspect("00000000C"), InspectResult(state="too-long")
        )
        self.assertEqual(
            self.medium.inspect("0000-0000-C"), InspectResult(state="too-long")
        )

    def test_no_checksum_fixed_profile_every_complete_length_validates(self):
        minimum = Baseh(baseh_minimum_v1())  # 6 symbols, no checksum
        canonical = minimum.encode(42)
        result = minimum.inspect(canonical)
        self.assertEqual(result.state, "valid")
        self.assertEqual(minimum.inspect(canonical[:3]).state, "typing")


class TestInspectExpandable(unittest.TestCase):
    """Expandable mode, baseh-expandable-v1: minLength 4, separatorMinLength 6."""

    @classmethod
    def setUpClass(cls):
        cls.expandable = Baseh(baseh_expandable_v1())

    def test_empty_and_below_min_length_typing(self):
        exp = self.expandable
        self.assertEqual(exp.inspect(""), InspectResult(state="empty"))
        self.assertEqual(
            exp.inspect("1"), InspectResult(state="typing", typed="1", progress=0.25)
        )
        self.assertEqual(
            exp.inspect("12"), InspectResult(state="typing", typed="12", progress=0.5)
        )
        self.assertEqual(
            exp.inspect("123"),
            InspectResult(state="typing", typed="123", progress=0.75),
        )
        # Below separatorMinLength the typing render is bare.
        self.assertEqual(
            exp.inspect("ab"), InspectResult(state="typing", typed="A8", progress=0.5)
        )
        # Aliases normalize while typing (O -> 0, and 0 is a checksum symbol).
        self.assertEqual(
            exp.inspect("O"), InspectResult(state="typing", typed="0", progress=0.25)
        )

    def test_generation_boundaries_min_length_is_first_complete_length(self):
        exp = self.expandable
        code4 = exp.encode(0)  # first id, generation 4
        self.assertEqual(len(code4), 4)
        self.assertEqual(
            exp.inspect(code4),
            InspectResult(state="valid", id=0, canonical_code=code4),
        )
        code5 = exp.encode(19683)  # first id of generation 5
        self.assertEqual(len(code5), 5)
        self.assertEqual(
            exp.inspect(code5),
            InspectResult(state="valid", id=19683, canonical_code=code5),
        )
        code6 = exp.encode(551124)  # first id of generation 6, hyphenated
        self.assertEqual(len(code6), 7)
        self.assertEqual(
            exp.inspect(code6),
            InspectResult(state="valid", id=551124, canonical_code=code6),
        )

    def test_every_length_at_min_length_is_complete_bad_checksum_is_invalid(self):
        # 5 symbols that fail the generation-5 checksum.
        sample = self.expandable.encode(777).replace("-", "")  # generation 4
        five = sample + "A"  # wrong-length presentation, checksum fails (19.7)
        result = self.expandable.inspect(five)
        self.assertEqual(result.state, "invalid")
        self.assertEqual(result.reason, "INVALID_CHECKSUM")

    def test_zero_or_o_in_body_position_is_invalid_character(self):
        sample = self.expandable.encode(777).replace("-", "")
        for bad in ("0" + sample[1:], "O" + sample[1:]):
            self.assertEqual(
                self.expandable.inspect(bad),
                InspectResult(state="invalid", reason="INVALID_CHARACTER"),
            )

    def test_bad_char_and_too_long(self):
        exp = self.expandable
        self.assertEqual(exp.inspect("A@"), InspectResult(state="bad-char"))
        self.assertEqual(exp.inspect("ABCD@"), InspectResult(state="bad-char"))
        self.assertEqual(exp.inspect("A" * 33), InspectResult(state="too-long"))
        # 32 real symbols pass the length gate and land on validate.
        self.assertEqual(exp.inspect("A" * 32).state, "invalid")

    def test_whitespace_and_separators_in_complete_code_still_reach_valid(self):
        code6 = self.expandable.encode(551124)
        raw = code6.replace("-", "")
        result = self.expandable.inspect(" " + raw[:3] + " - " + raw[3:])
        self.assertEqual(
            result,
            InspectResult(state="valid", id=551124, canonical_code=code6),
        )


class TestInspectFacade(unittest.TestCase):
    def test_matches_default_profile_instance(self):
        codec = Baseh(baseh_expandable_v1())
        for input_text in ("", "1", "AB@", "A" * 33, codec.encode(42)):
            self.assertEqual(inspect(input_text), codec.inspect(input_text))
        self.assertEqual(inspect(codec.encode(42)).state, "valid")


if __name__ == "__main__":
    unittest.main()
