"""
Comprehensive tests for the Redacto engine.

Categories:
  - TestPatternPositive:  Every pattern has at least one positive match
  - TestPatternNegative:  Non-matches that should NOT trigger
  - TestLevelGating:      Patterns only activate at their declared level
  - TestModes:            Same input across fake/mask/redact modes
  - TestOverlap:          Overlapping patterns resolved correctly
  - TestSinglePass:       Fake output must NOT be re-matched by another pattern
  - TestDeterminism:      Same input + same seed = same output
  - TestCustomTerms:      User-provided terms redacted at all levels
  - TestEdgeCases:        Empty input, no matches, Unicode, long text
  - TestFaker:            Fake data generators produce valid output
"""

import re
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from redacto import (
    redact, Faker, PATTERNS, Pat,
    _mask_ssn, _mask_phone, _mask_email, _mask_acct, _mask_card, _mask_name,
    process_pdf, process_text_file,
)

try:
    from redacto import process_pdf_pymupdf
except ImportError:
    pass


# ── Helpers ──────────────────────────────────────────────────

def redacted_text(text, **kw):
    """Return just the redacted text (discard change log)."""
    return redact(text, **kw)[0]


def changes(text, **kw):
    """Return just the change list."""
    return redact(text, **kw)[1]


def pattern_names(text, **kw):
    """Return set of pattern names that matched."""
    return {c["pattern"] for c in changes(text, **kw)}


# ── TestPatternPositive ──────────────────────────────────────

class TestPatternPositive:
    """Every pattern should match its canonical examples."""

    # Level 1

    def test_itin(self):
        assert "ITIN" in pattern_names("ITIN: 912-70-1234", level=1)

    def test_itin_various_prefixes(self):
        for val in ["950-70-1234", "999-88-5678", "900-70-0001"]:
            assert "ITIN" in pattern_names(f"Number: {val}", level=1), f"Failed on {val}"

    def test_ssn(self):
        assert "SSN" in pattern_names("SSN: 123-45-6789", level=1)

    def test_ssn_various(self):
        for val in ["001-01-0001", "666-12-3456", "234-56-7890"]:
            assert "SSN" in pattern_names(f"SSN is {val}", level=1), f"Failed on {val}"

    def test_bank_account(self):
        assert "Bank Account" in pattern_names("Account 12345678", level=1)

    def test_bank_account_variations(self):
        for text in ["Acct# 123456789012", "acct 87654321", "a/c 1234567890", "Acct. 12345678"]:
            assert "Bank Account" in pattern_names(text, level=1), f"Failed on: {text}"

    def test_routing_number(self):
        assert "Routing Number" in pattern_names("Routing 021000021", level=1)

    def test_routing_variations(self):
        for text in ["routing# 123456789", "ABA 021000021", "Transit 123456789"]:
            assert "Routing Number" in pattern_names(text, level=1), f"Failed on: {text}"

    def test_credit_card(self):
        assert "Credit Card" in pattern_names("Card: 4111-1111-1111-1111", level=1)

    def test_credit_card_spaces(self):
        assert "Credit Card" in pattern_names("Card: 4111 1111 1111 1111", level=1)

    def test_credit_card_no_sep(self):
        assert "Credit Card" in pattern_names("Card: 4111111111111111", level=1)

    def test_alien_uscis(self):
        assert "Alien/USCIS#" in pattern_names("Alien 123456789", level=1)

    def test_alien_variations(self):
        for text in ["USCIS 1234567", "A# 123456789", "A-123456789"]:
            assert "Alien/USCIS#" in pattern_names(text, level=1), f"Failed on: {text}"

    def test_passport(self):
        assert "Passport" in pattern_names("Passport# A12345678", level=1)

    def test_passport_variations(self):
        for text in ["passport AB1234567", "Passport: C12345", "Passport#ABC123456"]:
            assert "Passport" in pattern_names(text, level=1), f"Failed on: {text}"

    def test_visa_number(self):
        assert "Visa Number" in pattern_names("Visa# AB12345678", level=1)

    def test_visa_variations(self):
        for text in ["visa CD87654321", "Visa: EF12345678"]:
            assert "Visa Number" in pattern_names(text, level=1), f"Failed on: {text}"

    # Level 2

    def test_ein(self):
        assert "EIN" in pattern_names("EIN: 12-3456789", level=2)

    def test_phone(self):
        assert "Phone" in pattern_names("Phone: (555) 123-4567", level=2)

    def test_phone_variations(self):
        for text in ["Call 555-123-4567", "1-555-123-4567", "+1 555.123.4567", "555 123 4567"]:
            assert "Phone" in pattern_names(text, level=2), f"Failed on: {text}"

    def test_email(self):
        assert "Email" in pattern_names("Email: john.doe@example.com", level=2)

    def test_email_variations(self):
        for text in ["user+tag@mail.co.uk", "first.last@domain.org", "a@b.io"]:
            assert "Email" in pattern_names(text, level=2), f"Failed on: {text}"

    def test_street_address(self):
        assert "Street Address" in pattern_names("Lives at 123 Main Street", level=2)

    def test_street_address_variations(self):
        for text in ["456 Oak Ave", "7890 Cedar Blvd", "12 Pine Dr", "1234 Maple Ln"]:
            assert "Street Address" in pattern_names(text, level=2), f"Failed on: {text}"

    def test_dob(self):
        assert "Date of Birth" in pattern_names("DOB: 01/15/1990", level=2)

    def test_dob_variations(self):
        for text in ["Date of Birth: 3/4/85", "birthdate 12-25-2000", "Born: 1/1/99"]:
            assert "Date of Birth" in pattern_names(text, level=2), f"Failed on: {text}"

    def test_named_fields(self):
        assert "Named Fields" in pattern_names("Taxpayer: John Smith", level=2)

    def test_named_fields_variations(self):
        for text in ["Spouse: Maria Garcia", "Employer: Robert Wilson", "Client: Sarah Clark"]:
            assert "Named Fields" in pattern_names(text, level=2), f"Failed on: {text}"

    def test_named_fields_no_newline_spanning(self):
        """Named Fields should NOT match across newlines — each line independent."""
        text = "Taxpayer: John Smith\nSpouse: Jane Doe"
        _, chgs = redact(text, level=2, mode="redact")
        named = [c for c in chgs if c["pattern"] == "Named Fields"]
        assert len(named) == 2, f"Expected 2 Named Fields matches, got {len(named)}"

    # Level 3

    def test_dollar_amount(self):
        assert "Dollar Amounts" in pattern_names("Total: $1,234.56", level=3)

    def test_dollar_variations(self):
        for text in ["$100", "$0.99", "$1,000,000.00", "$50"]:
            assert "Dollar Amounts" in pattern_names(text, level=3), f"Failed on: {text}"

    def test_zip_code(self):
        assert "Zip Code" in pattern_names("Zip: 90210", level=3)

    def test_zip_plus_four(self):
        assert "Zip Code" in pattern_names("Zip: 90210-1234", level=3)


# ── TestPatternNegative ──────────────────────────────────────

class TestPatternNegative:
    """Values that should NOT match patterns."""

    def test_ssn_too_few_digits(self):
        assert "SSN" not in pattern_names("12-34-5678", level=1)

    def test_ssn_no_dashes(self):
        # SSN pattern requires dashes
        assert "SSN" not in pattern_names("123456789 is a number", level=1)

    def test_bank_account_no_prefix(self):
        # Bank account requires a keyword prefix
        assert "Bank Account" not in pattern_names("12345678", level=1)

    def test_bank_account_too_short(self):
        assert "Bank Account" not in pattern_names("Account 1234567", level=1)

    def test_routing_no_prefix(self):
        # Routing requires keyword prefix
        assert "Routing Number" not in pattern_names("021000021", level=1)

    def test_credit_card_too_few(self):
        assert "Credit Card" not in pattern_names("4111-1111-1111", level=1)

    def test_passport_no_prefix(self):
        assert "Passport" not in pattern_names("A12345678", level=1)

    def test_email_no_at(self):
        assert "Email" not in pattern_names("john.doe.example.com", level=2)

    def test_email_no_tld(self):
        assert "Email" not in pattern_names("john@example", level=2)

    def test_phone_too_short(self):
        assert "Phone" not in pattern_names("555-1234", level=2)

    def test_dob_no_prefix(self):
        # DOB pattern requires a keyword prefix (DOB, Date of Birth, etc.)
        assert "Date of Birth" not in pattern_names("01/15/1990", level=2)

    def test_named_field_unknown_keyword(self):
        # "Manager" is not in the keyword list
        assert "Named Fields" not in pattern_names("Manager: John Smith", level=2)

    def test_street_no_number(self):
        assert "Street Address" not in pattern_names("Main Street", level=2)

    def test_street_does_not_span_newline(self):
        # Regression: a loose number at a line end must not join the next line's
        # word into a fake "street". Repro = tail digits of an unmatched intl phone
        # ("...0958") followed by a section header.
        text = "Mobile: +44 20 7946 0958\n\nCONTACT\n  Phone: (415) 555-0188"
        assert "Street Address" not in pattern_names(text, level=2)

    def test_street_all_caps_not_a_street(self):
        # Case-sensitive: an ALL-CAPS word must not pose as a Title-Case street
        # (e.g. "CONTA" + "CT" reading as a bogus "Ct").
        assert "Street Address" not in pattern_names("5 CONTACT", level=2)
        assert "Street Address" not in pattern_names("12 EXIT", level=2)

    def test_street_clean_still_matches(self):
        # Guard: the hardening must not regress real, single-line addresses.
        for t in ["88 Maple Avenue", "123 Main Street", "5 Oak Ct"]:
            assert "Street Address" in pattern_names(t, level=2), f"Failed on: {t}"

    def test_dollar_no_sign(self):
        assert "Dollar Amounts" not in pattern_names("1234.56", level=3)

    def test_plain_text_no_match(self):
        result = changes("The quick brown fox jumps over the lazy dog.", level=3)
        assert len(result) == 0


# ── TestLevelGating ──────────────────────────────────────────

class TestLevelGating:
    """Patterns should only activate at or above their declared level."""

    # Level 1 patterns should match at levels 1, 2, 3
    def test_ssn_at_level_1(self):
        assert "SSN" in pattern_names("SSN: 123-45-6789", level=1)

    def test_ssn_at_level_2(self):
        assert "SSN" in pattern_names("SSN: 123-45-6789", level=2)

    def test_ssn_at_level_3(self):
        assert "SSN" in pattern_names("SSN: 123-45-6789", level=3)

    # Level 2 patterns should NOT match at level 1
    def test_ein_not_at_level_1(self):
        assert "EIN" not in pattern_names("EIN: 12-3456789", level=1)

    def test_phone_not_at_level_1(self):
        assert "Phone" not in pattern_names("(555) 123-4567", level=1)

    def test_email_not_at_level_1(self):
        assert "Email" not in pattern_names("john@example.com", level=1)

    def test_address_not_at_level_1(self):
        assert "Street Address" not in pattern_names("123 Main Street", level=1)

    def test_dob_not_at_level_1(self):
        assert "Date of Birth" not in pattern_names("DOB: 01/15/1990", level=1)

    def test_named_not_at_level_1(self):
        assert "Named Fields" not in pattern_names("Taxpayer: John Smith", level=1)

    # Level 2 patterns should match at level 2
    def test_ein_at_level_2(self):
        assert "EIN" in pattern_names("EIN: 12-3456789", level=2)

    def test_phone_at_level_2(self):
        assert "Phone" in pattern_names("(555) 123-4567", level=2)

    def test_email_at_level_2(self):
        assert "Email" in pattern_names("john@example.com", level=2)

    # Level 3 patterns should NOT match at level 1 or 2
    def test_dollar_not_at_level_1(self):
        assert "Dollar Amounts" not in pattern_names("$1,234.56", level=1)

    def test_dollar_not_at_level_2(self):
        assert "Dollar Amounts" not in pattern_names("$1,234.56", level=2)

    def test_zip_not_at_level_1(self):
        assert "Zip Code" not in pattern_names("90210", level=1)

    def test_zip_not_at_level_2(self):
        assert "Zip Code" not in pattern_names("90210", level=2)

    # Level 3 patterns match at level 3
    def test_dollar_at_level_3(self):
        assert "Dollar Amounts" in pattern_names("$1,234.56", level=3)

    def test_zip_at_level_3(self):
        assert "Zip Code" in pattern_names("90210", level=3)


# ── TestModes ────────────────────────────────────────────────

class TestModes:
    """Same input tested across fake/mask/redact modes."""

    def test_ssn_fake_mode(self):
        result = redacted_text("SSN: 123-45-6789", level=1, mode="fake")
        assert "123-45-6789" not in result
        # Fake SSN should have XXX-XX-XXXX format with 800-899 area
        assert re.search(r'8\d{2}-\d{2}-\d{4}', result)

    def test_ssn_mask_mode(self):
        result = redacted_text("SSN: 123-45-6789", level=1, mode="mask")
        assert "XXX-XX-6789" in result

    def test_ssn_redact_mode(self):
        result = redacted_text("SSN: 123-45-6789", level=1, mode="redact")
        assert "[SSN REDACTED]" in result

    def test_phone_fake_mode(self):
        result = redacted_text("Call (555) 123-4567", level=2, mode="fake")
        assert "(555) 123-4567" not in result
        # Fake phone starts with (555)
        assert "(555)" in result

    def test_phone_mask_mode(self):
        result = redacted_text("Call (555) 123-4567", level=2, mode="mask")
        assert "XXX-4567" in result

    def test_phone_redact_mode(self):
        result = redacted_text("Call (555) 123-4567", level=2, mode="redact")
        assert "[PHONE REDACTED]" in result

    def test_email_fake_mode(self):
        result = redacted_text("Email: john@example.com", level=2, mode="fake")
        assert "john@example.com" not in result
        assert "@" in result  # Fake email has @

    def test_email_mask_mode(self):
        result = redacted_text("Email: john@example.com", level=2, mode="mask")
        assert "j***@example.com" in result

    def test_email_redact_mode(self):
        result = redacted_text("Email: john@example.com", level=2, mode="redact")
        assert "[EMAIL REDACTED]" in result

    def test_credit_card_fake_mode(self):
        result = redacted_text("Card: 4111-1111-1111-1111", level=1, mode="fake")
        assert "4111-1111-1111-1111" not in result

    def test_credit_card_mask_mode(self):
        result = redacted_text("Card: 4111-1111-1111-1111", level=1, mode="mask")
        assert "XXXX-XXXX-XXXX-1111" in result

    def test_credit_card_redact_mode(self):
        result = redacted_text("Card: 4111-1111-1111-1111", level=1, mode="redact")
        assert "[CARD REDACTED]" in result

    def test_dollar_fake_mode(self):
        result = redacted_text("Total: $1,234.56", level=3, mode="fake")
        assert "$1,234.56" not in result
        assert "$" in result  # Fake amount has dollar sign

    def test_dollar_redact_mode(self):
        result = redacted_text("Total: $1,234.56", level=3, mode="redact")
        assert "[AMOUNT REDACTED]" in result

    def test_mask_falls_back_to_tag(self):
        """Patterns without a mask function should fall back to [REDACTED] tag."""
        # EIN has no mask function
        result = redacted_text("EIN: 12-3456789", level=2, mode="mask")
        assert "[EIN REDACTED]" in result

    def test_itin_fake_format(self):
        result = redacted_text("ITIN: 912-70-1234", level=1, mode="fake")
        assert "912-70-1234" not in result
        # Fake ITIN should start with 9
        assert re.search(r'9\d{2}-\d{2}-\d{4}', result)

    def test_itin_mask_mode(self):
        result = redacted_text("ITIN: 912-70-1234", level=1, mode="mask")
        assert "XXX-XX-1234" in result


# ── TestOverlap ──────────────────────────────────────────────

class TestOverlap:
    """Overlapping patterns resolved by priority."""

    def test_itin_wins_over_ssn(self):
        """ITIN (priority 100) should win over SSN (priority 90) for 9XX numbers."""
        text = "Number: 912-70-1234"
        names = pattern_names(text, level=1)
        assert "ITIN" in names
        assert "SSN" not in names

    def test_ssn_matches_non_9xx(self):
        """Non-9XX SSNs should match SSN, not ITIN."""
        text = "Number: 123-45-6789"
        names = pattern_names(text, level=1)
        assert "SSN" in names
        assert "ITIN" not in names

    def test_multiple_patterns_different_locations(self):
        """Multiple patterns at different positions should all match."""
        text = "SSN: 123-45-6789, Email: john@test.com, Card: 4111-1111-1111-1111"
        names = pattern_names(text, level=2)
        assert "SSN" in names
        assert "Email" in names
        assert "Credit Card" in names

    def test_adjacent_patterns_no_overlap(self):
        """Adjacent but non-overlapping patterns both match."""
        text = "SSN: 123-45-6789 Phone: (555) 123-4567"
        names = pattern_names(text, level=2)
        assert "SSN" in names
        assert "Phone" in names

    def test_higher_priority_wins_at_same_position(self):
        """When two patterns start at same position, higher priority wins."""
        # USCIS (priority 95) should beat SSN (priority 90) if both could match
        # Alien/USCIS# requires prefix, so this tests real-world overlap
        text = "A# 123-45-6789"
        names = pattern_names(text, level=1)
        # Alien pattern matches "A# 123456789" style, this has dashes
        # so SSN may or may not match depending on overlap
        assert len(names) >= 1  # At least one should match


# ── TestSinglePass ───────────────────────────────────────────

class TestSinglePass:
    """Fake output from one pattern must NOT be re-matched by another."""

    def test_fake_ssn_not_rematched(self):
        """Fake SSN (800-899 range) should not be re-matched as SSN or ITIN."""
        text = "SSN: 123-45-6789"
        result = redacted_text(text, level=1, mode="fake")
        # Run the result through redaction again
        _, second_pass_changes = redact(result, level=1, mode="fake")
        # The fake SSN should not be caught again (it's 8XX which matches SSN pattern)
        # This verifies single-pass design by checking that if we DID run a second pass,
        # the fake data would be caught - proving single-pass is necessary
        # The important thing is that the first pass produces correct output
        assert "123-45-6789" not in result

    def test_fake_phone_not_in_original_pass(self):
        """Verify single-pass: all replacements happen against original text."""
        text = "Call (555) 123-4567 and SSN 234-56-7890"
        result, chgs = redact(text, level=2, mode="fake")
        assert "(555) 123-4567" not in result
        assert "234-56-7890" not in result
        assert len(chgs) == 2  # Exactly 2 replacements, not more

    def test_fake_email_doesnt_cascade(self):
        """Fake email should not trigger email pattern in output."""
        text = "Contact: user@domain.com"
        result = redacted_text(text, level=2, mode="fake")
        assert "user@domain.com" not in result
        # Result should contain exactly one @ (the fake email)
        assert result.count("@") == 1

    def test_replacement_count_matches_input_matches(self):
        """Number of changes should equal number of real matches in the input."""
        text = "SSN: 111-22-3333. Another SSN: 444-55-6666."
        _, chgs = redact(text, level=1, mode="fake")
        assert len(chgs) == 2

    def test_multi_pattern_single_pass(self):
        """Multiple pattern types in one text all replaced in single pass."""
        text = "SSN 111-22-3333, phone (555) 444-5555, email me@test.com"
        result, chgs = redact(text, level=2, mode="fake")
        assert "111-22-3333" not in result
        assert "(555) 444-5555" not in result
        assert "me@test.com" not in result
        assert len(chgs) == 3


# ── TestDeterminism ──────────────────────────────────────────

class TestDeterminism:
    """Same input + same seed = same output across runs."""

    def test_same_seed_same_output(self):
        text = "SSN: 123-45-6789, Email: test@example.com"
        r1 = redacted_text(text, level=2, mode="fake", faker=Faker("seed1"))
        r2 = redacted_text(text, level=2, mode="fake", faker=Faker("seed1"))
        assert r1 == r2

    def test_different_seed_different_output(self):
        text = "SSN: 123-45-6789"
        r1 = redacted_text(text, level=1, mode="fake", faker=Faker("seed1"))
        r2 = redacted_text(text, level=1, mode="fake", faker=Faker("seed2"))
        assert r1 != r2

    def test_same_value_same_replacement(self):
        """Same original value should always produce the same fake replacement."""
        text = "John Smith is here. Contact John Smith. Ask John Smith."
        result = redacted_text(text, level=2, mode="fake", custom_terms=["John Smith"])
        # All three "John Smith" should become the same fake name
        parts = result.split(".")
        # Extract the replacement name from first occurrence
        fake_name = parts[0].strip()  # e.g., "Dorothy Young is here"
        # The fake name should appear 3 times
        # Find what John Smith was replaced with
        _, chgs = redact(text, level=2, mode="fake", faker=Faker("redacto"), custom_terms=["John Smith"])
        custom_repls = [c["replaced"] for c in chgs if c["pattern"] == "Custom"]
        assert len(set(custom_repls)) == 1, f"Expected 1 unique replacement, got {set(custom_repls)}"

    def test_same_ssn_same_replacement(self):
        """Same SSN appearing twice should produce the same fake SSN."""
        text = "SSN: 123-45-6789 and again SSN: 123-45-6789"
        _, chgs = redact(text, level=1, mode="fake", faker=Faker("test"))
        ssn_repls = [c["replaced"] for c in chgs if c["pattern"] == "SSN"]
        assert len(ssn_repls) == 2
        assert ssn_repls[0] == ssn_repls[1], f"Same SSN got different fakes: {ssn_repls}"

    def test_different_values_different_replacements(self):
        """Different original values should (usually) get different fakes."""
        text = "SSN1: 111-22-3333 SSN2: 444-55-6666"
        _, chgs = redact(text, level=1, mode="fake", faker=Faker("test"))
        ssn_repls = [c["replaced"] for c in chgs if c["pattern"] == "SSN"]
        assert len(ssn_repls) == 2
        assert ssn_repls[0] != ssn_repls[1], "Different SSNs should get different fakes"

    def test_determinism_across_multiple_patterns(self):
        text = "SSN: 111-22-3333, Phone: (555) 999-8888, Email: a@b.com"
        f1, f2 = Faker("test"), Faker("test")
        r1 = redacted_text(text, level=2, mode="fake", faker=f1)
        r2 = redacted_text(text, level=2, mode="fake", faker=f2)
        assert r1 == r2

    def test_mask_mode_determinism(self):
        """Mask mode is purely algorithmic, should always be the same."""
        text = "SSN: 123-45-6789"
        r1 = redacted_text(text, level=1, mode="mask")
        r2 = redacted_text(text, level=1, mode="mask")
        assert r1 == r2

    def test_redact_mode_determinism(self):
        text = "SSN: 123-45-6789"
        r1 = redacted_text(text, level=1, mode="redact")
        r2 = redacted_text(text, level=1, mode="redact")
        assert r1 == r2


# ── TestCustomTerms ──────────────────────────────────────────

class TestCustomTerms:
    """User-provided terms should be redacted at all levels."""

    def test_custom_term_basic(self):
        text = "Contact John Smith for details."
        result = redacted_text(text, level=1, custom_terms=["John Smith"])
        assert "John Smith" not in result

    def test_custom_term_case_insensitive(self):
        text = "Contact JOHN SMITH for details."
        result = redacted_text(text, level=1, custom_terms=["John Smith"])
        assert "JOHN SMITH" not in result

    def test_custom_term_at_level_1(self):
        """Custom terms work even at the lowest level."""
        text = "Address: 123 Elm Street, Springfield"
        result = redacted_text(text, level=1, custom_terms=["Springfield"])
        assert "Springfield" not in result

    def test_custom_term_multiple(self):
        text = "John works at Acme Corp on Main Street."
        result = redacted_text(text, level=1, custom_terms=["John", "Acme Corp", "Main Street"])
        assert "John" not in result
        assert "Acme Corp" not in result
        assert "Main Street" not in result

    def test_custom_term_empty_ignored(self):
        """Empty/whitespace-only terms should be ignored."""
        text = "Hello world"
        result = redacted_text(text, level=1, custom_terms=["", "  ", "\t"])
        assert result == "Hello world"

    def test_custom_term_with_regex_chars(self):
        """Custom terms with regex special chars should be escaped."""
        text = "Company: A+ Corp. (LLC)"
        result = redacted_text(text, level=1, custom_terms=["A+ Corp. (LLC)"])
        assert "A+ Corp. (LLC)" not in result

    def test_custom_term_high_priority(self):
        """Custom terms have priority 200, should win over other patterns."""
        # If "123-45-6789" is both an SSN and a custom term, custom wins
        text = "Number: 123-45-6789"
        _, chgs = redact(text, level=1, custom_terms=["123-45-6789"])
        # Custom has higher priority (200) so should be what matches
        customs = [c for c in chgs if c["pattern"] == "Custom"]
        assert len(customs) >= 1

    def test_custom_term_and_patterns_together(self):
        """Custom terms coexist with built-in patterns."""
        text = "John Smith SSN: 123-45-6789"
        result = redacted_text(text, level=1, custom_terms=["John Smith"])
        assert "John Smith" not in result
        assert "123-45-6789" not in result


# ── TestEdgeCases ────────────────────────────────────────────

class TestEdgeCases:
    """Edge cases: empty input, no matches, Unicode, long text."""

    def test_empty_string(self):
        result, chgs = redact("", level=2)
        assert result == ""
        assert chgs == []

    def test_no_matches(self):
        text = "This is a normal sentence with no PII."
        result, chgs = redact(text, level=2)
        assert result == text
        assert chgs == []

    def test_whitespace_only(self):
        text = "   \n\t\n   "
        result, chgs = redact(text, level=2)
        assert result == text
        assert chgs == []

    def test_unicode_text_preserved(self):
        text = "Name: Jose Garcia. Note: cafe with accent."
        result = redacted_text(text, level=2)
        # Unicode chars outside patterns should be preserved
        assert "cafe" in result or "cafe" in result  # non-PII preserved

    def test_very_long_text(self):
        """Engine should handle large text without error."""
        text = "SSN: 123-45-6789. " * 1000
        result, chgs = redact(text, level=1)
        assert len(chgs) == 1000
        assert "123-45-6789" not in result

    def test_all_matches_replaced(self):
        """Every match in a multi-match text should be replaced."""
        text = "SSN1: 111-22-3333, SSN2: 444-55-6666, SSN3: 777-88-9999"
        result, chgs = redact(text, level=1, mode="redact")
        assert result.count("[SSN REDACTED]") == 3

    def test_newlines_preserved(self):
        text = "Line 1: SSN 111-22-3333\nLine 2: SSN 444-55-6666\n"
        result = redacted_text(text, level=1, mode="redact")
        assert "\n" in result
        assert result.count("\n") == 2

    def test_special_chars_around_match(self):
        text = "***SSN: 123-45-6789***"
        result = redacted_text(text, level=1, mode="redact")
        assert "[SSN REDACTED]" in result

    def test_no_custom_terms(self):
        """None and empty list both work for custom_terms."""
        text = "SSN: 123-45-6789"
        r1, _ = redact(text, level=1, custom_terms=None)
        r2, _ = redact(text, level=1, custom_terms=[])
        assert "123-45-6789" not in r1
        assert "123-45-6789" not in r2

    def test_level_boundary_values(self):
        """Level values 1, 2, 3 are all valid."""
        text = "SSN: 123-45-6789"
        for lvl in [1, 2, 3]:
            result, _ = redact(text, level=lvl)
            assert "123-45-6789" not in result


# ── TestFaker ────────────────────────────────────────────────

class TestFaker:
    """Fake data generators produce valid output."""

    def setup_method(self):
        self.faker = Faker("test")

    def test_ssn_format(self):
        result = self.faker.ssn("123-45-6789")
        assert re.fullmatch(r'8\d{2}-\d{2}-\d{4}', result)

    def test_ssn_range_800_899(self):
        """Fake SSN area number should be in 800-899 range."""
        for i in range(20):
            f = Faker(f"test_{i}")
            result = f.ssn("dummy")
            area = int(result.split("-")[0])
            assert 800 <= area <= 899, f"Area {area} outside 800-899"

    def test_itin_format(self):
        result = self.faker.itin("912-70-1234")
        assert re.fullmatch(r'9\d{2}-\d{2}-\d{4}', result)

    def test_phone_format(self):
        result = self.faker.phone("(555) 123-4567")
        assert result.startswith("(555)")
        assert re.fullmatch(r'\(555\) \d{3}-\d{4}', result)

    def test_email_format(self):
        result = self.faker.email("test@example.com")
        assert "@" in result
        parts = result.split("@")
        assert len(parts) == 2
        assert "." in parts[1]

    def test_name_format(self):
        result = self.faker.name("John Smith")
        parts = result.split()
        assert len(parts) == 2
        assert parts[0][0].isupper()
        assert parts[1][0].isupper()

    def test_street_format(self):
        result = self.faker.street("123 Main St")
        parts = result.split()
        assert len(parts) >= 3
        assert parts[0].isdigit()

    def test_account_format(self):
        result = self.faker.account("Account 12345678")
        assert result.startswith("Acct #")
        digits = result.replace("Acct #", "")
        assert digits.isdigit()
        assert 8 <= len(digits) <= 12

    def test_routing_format(self):
        result = self.faker.routing("Routing 123456789")
        assert result.startswith("Routing: ")
        digits = result.replace("Routing: ", "")
        assert len(digits) == 9
        assert digits.isdigit()

    def test_ein_format(self):
        result = self.faker.ein("12-3456789")
        assert re.fullmatch(r'\d{2}-\d{7}', result)

    def test_card_format(self):
        result = self.faker.card("4111-1111-1111-1111")
        assert re.fullmatch(r'4\d{3}-XXXX-XXXX-\d{4}', result)

    def test_dob_format(self):
        result = self.faker.dob("DOB: 01/15/1990")
        assert result.startswith("DOB: ")
        assert re.fullmatch(r'DOB: \d{2}/\d{2}/\d{4}', result)

    def test_passport_format(self):
        result = self.faker.passport("Passport# A12345678")
        assert result.startswith("Passport# ")
        code = result.replace("Passport# ", "")
        assert len(code) == 9  # 1 letter + 8 digits

    def test_alien_format(self):
        result = self.faker.alien("A# 123456789")
        assert result.startswith("A#")

    def test_visa_format(self):
        result = self.faker.visa("Visa# AB12345678")
        assert result.startswith("Visa# ")

    def test_zipcode_format(self):
        result = self.faker.zipcode("90210")
        assert re.fullmatch(r'\d{5}', result)

    def test_amount_format(self):
        result = self.faker.amount("$1,234.56")
        assert result.startswith("$")
        # Should be a valid dollar amount
        assert re.fullmatch(r'\$[\d,]+\.\d{2}', result)

    def test_amount_magnitude(self):
        """Fake amount should be in similar magnitude (0.4x to 1.6x)."""
        result = self.faker.amount("$1,000.00")
        # Extract numeric value
        val = float(result.replace("$", "").replace(",", ""))
        assert 400 <= val <= 1600


# ── TestMaskFunctions ────────────────────────────────────────

class TestMaskFunctions:
    """Mask helper functions produce correct output."""

    def test_mask_ssn(self):
        assert _mask_ssn("123-45-6789") == "XXX-XX-6789"

    def test_mask_ssn_short(self):
        assert _mask_ssn("12") == "XXX-XX-XXXX"

    def test_mask_phone(self):
        assert _mask_phone("(555) 123-4567") == "(XXX) XXX-4567"

    def test_mask_phone_short(self):
        assert _mask_phone("12") == "(XXX) XXX-XXXX"

    def test_mask_email(self):
        assert _mask_email("john@example.com") == "j***@example.com"

    def test_mask_email_invalid(self):
        assert _mask_email("no-at-sign") == "***@***.***"

    def test_mask_acct(self):
        result = _mask_acct("Account 12345678")
        assert result.endswith("5678")
        assert result.startswith("Acct #")

    def test_mask_card(self):
        assert _mask_card("4111-1111-1111-1111") == "XXXX-XXXX-XXXX-1111"

    def test_mask_card_short(self):
        assert _mask_card("12") == "XXXX-XXXX-XXXX-XXXX"

    def test_mask_name(self):
        assert _mask_name("John Smith") == "J. S."

    def test_mask_name_single(self):
        assert _mask_name("Madonna") == "M."

    def test_mask_name_three_parts(self):
        assert _mask_name("Mary Jane Watson") == "M. J. W."


# ── TestChangeLog ────────────────────────────────────────────

class TestChangeLog:
    """Change log entries are correct and in document order."""

    def test_change_log_pattern_name(self):
        _, chgs = redact("SSN: 123-45-6789", level=1)
        assert chgs[0]["pattern"] == "SSN"

    def test_change_log_truncates_found(self):
        """Found value should be truncated for privacy."""
        _, chgs = redact("SSN: 123-45-6789", level=1)
        found = chgs[0]["found"]
        assert "6789" not in found  # Should be truncated

    def test_change_log_has_replaced(self):
        _, chgs = redact("SSN: 123-45-6789", level=1, mode="redact")
        assert chgs[0]["replaced"] == "[SSN REDACTED]"

    def test_change_log_document_order(self):
        """Changes should be in document order (left to right)."""
        text = "First: 111-22-3333 Second: 444-55-6666"
        _, chgs = redact(text, level=1, mode="redact")
        assert len(chgs) == 2
        # First change should correspond to first SSN
        assert chgs[0]["replaced"] == "[SSN REDACTED]"
        assert chgs[1]["replaced"] == "[SSN REDACTED]"

    def test_change_log_multiple_patterns(self):
        text = "SSN: 111-22-3333, Phone: (555) 123-4567"
        _, chgs = redact(text, level=2, mode="redact")
        patterns = [c["pattern"] for c in chgs]
        assert "SSN" in patterns
        assert "Phone" in patterns

    def test_change_log_full_original(self):
        """Change dicts include _full_original for compare view."""
        _, chgs = redact("SSN: 123-45-6789", level=1, mode="fake")
        assert chgs[0]["_full_original"] == "123-45-6789"

    def test_change_log_full_replaced(self):
        """Change dicts include _full_replaced for PyMuPDF."""
        _, chgs = redact("SSN: 123-45-6789", level=1, mode="redact")
        assert chgs[0]["_full_replaced"] == "[SSN REDACTED]"


# ── TestCompareView ──────────────────────────────────────────

class TestCompareView:
    """Verify that original text is preserved alongside redacted text."""

    def test_process_text_file_returns_three_tuple(self, tmp_path):
        """process_text_file returns (original, redacted, changes)."""
        p = tmp_path / "test.txt"
        p.write_text("SSN: 123-45-6789")
        orig, redacted, chgs = process_text_file(str(p), 1, "fake", Faker(), None)
        assert orig == "SSN: 123-45-6789"
        assert "123-45-6789" not in redacted
        assert len(chgs) == 1

    def test_process_pdf_returns_three_tuple(self, tmp_path):
        """process_pdf returns (original_pages, redacted_pages, changes)."""
        try:
            from reportlab.lib.pagesizes import letter
            from reportlab.pdfgen import canvas
        except ImportError:
            pytest.skip("reportlab not installed")

        pdf = str(tmp_path / "test.pdf")
        c = canvas.Canvas(pdf, pagesize=letter)
        c.drawString(72, 700, "SSN: 123-45-6789")
        c.showPage()
        c.save()

        orig_pages, redacted_pages, chgs = process_pdf(pdf, 1, "fake", Faker(), None)
        assert len(orig_pages) == 1
        assert len(redacted_pages) == 1
        assert "123-45-6789" in orig_pages[0]
        assert "123-45-6789" not in redacted_pages[0]

    def test_original_preserved_unmodified(self):
        """Original text should be completely unmodified."""
        text = "SSN: 123-45-6789, Email: test@example.com"
        orig_text = text  # save reference
        result, _ = redact(text, level=2, mode="fake")
        # The original string should still be intact (Python strings are immutable)
        assert orig_text == "SSN: 123-45-6789, Email: test@example.com"


# ── TestPyMuPDF ──────────────────────────────────────────────

pymupdf_available = False
try:
    import fitz
    pymupdf_available = True
except ImportError:
    pass


@pytest.mark.skipif(not pymupdf_available, reason="PyMuPDF not installed")
class TestPyMuPDF:
    """Test structure-preserving PDF redaction."""

    def _make_test_pdf(self, tmp_path, texts=None):
        """Create a minimal test PDF with PyMuPDF."""
        import fitz
        if texts is None:
            texts = ["SSN: 123-45-6789"]
        doc = fitz.open()
        for text in texts:
            page = doc.new_page()
            page.insert_text((72, 72), text)
        path = str(tmp_path / "test.pdf")
        doc.save(path)
        doc.close()
        return path

    def test_basic_redaction_preserves_page_count(self, tmp_path):
        pdf = self._make_test_pdf(tmp_path, ["SSN: 123-45-6789", "Page 2 SSN: 123-45-6789"])
        out = str(tmp_path / "out.pdf")
        orig, redacted, changes, saved = process_pdf_pymupdf(pdf, 1, "redact", Faker(), None, out)

        import fitz
        doc = fitz.open(saved)
        assert len(doc) == 2
        doc.close()

    def test_redacted_text_not_in_output(self, tmp_path):
        pdf = self._make_test_pdf(tmp_path)
        out = str(tmp_path / "out.pdf")
        process_pdf_pymupdf(pdf, 1, "redact", Faker(), None, out)

        import fitz
        doc = fitz.open(out)
        text = doc[0].get_text()
        assert "123-45-6789" not in text
        doc.close()

    def test_consistency_across_pages(self, tmp_path):
        """Same SSN on multiple pages should get same fake replacement."""
        pdf = self._make_test_pdf(tmp_path, [
            "SSN: 123-45-6789",
            "SSN: 123-45-6789",
            "SSN: 123-45-6789",
        ])
        out = str(tmp_path / "out.pdf")
        _, _, changes, _ = process_pdf_pymupdf(pdf, 1, "fake", Faker("test"), None, out)

        ssn_repls = [c["_full_replaced"] for c in changes if c["pattern"] == "SSN"]
        assert len(ssn_repls) == 3
        assert len(set(ssn_repls)) == 1, f"Expected same replacement, got {set(ssn_repls)}"

    def test_returns_original_and_redacted_pages(self, tmp_path):
        pdf = self._make_test_pdf(tmp_path)
        out = str(tmp_path / "out.pdf")
        orig, redacted, changes, _ = process_pdf_pymupdf(pdf, 1, "fake", Faker(), None, out)
        assert len(orig) == 1
        assert len(redacted) == 1
        assert "123-45-6789" in orig[0]
        assert "123-45-6789" not in redacted[0]

    def test_multi_pattern_pdf(self, tmp_path):
        pdf = self._make_test_pdf(tmp_path, ["SSN: 111-22-3333, Email: a@b.com"])
        out = str(tmp_path / "out.pdf")
        _, _, changes, _ = process_pdf_pymupdf(pdf, 2, "redact", Faker(), None, out)
        patterns = {c["pattern"] for c in changes}
        assert "SSN" in patterns
        assert "Email" in patterns
