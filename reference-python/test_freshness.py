"""Pins the freshness rule. Run: python -m unittest discover tests"""

import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from freshness import check_freshness, expires_on, is_fresh  # noqa: E402


def _fresh(confirmed: str, as_of: str) -> bool:
    return is_fresh(date.fromisoformat(confirmed), date.fromisoformat(as_of))


class TestFreshness(unittest.TestCase):
    # (confirmed, as_of, expected_fresh, note)
    CASES = [
        ("2025-11-15", "2025-12-20", True, "35 days, no boundary crossed"),
        ("2025-11-15", "2026-01-05", False, "Jan 1 boundary passed"),
        ("2026-01-02", "2026-05-01", False, "119 days > 90"),
        ("2026-01-02", "2026-03-15", True, "72 days, after Jan 1"),
        ("2026-06-20", "2026-07-02", False, "Jul 1 boundary passed"),
        ("2026-07-01", "2026-08-01", True, "confirmed on the boundary counts"),
    ]

    def test_freshness_cases(self):
        for confirmed, as_of, expected, note in self.CASES:
            with self.subTest(confirmed=confirmed, as_of=as_of, note=note):
                self.assertEqual(_fresh(confirmed, as_of), expected, note)
                # check_freshness() must agree with the pure predicate
                self.assertEqual(
                    check_freshness(confirmed, as_of)["fresh"], expected, note
                )

    def test_expires_on(self):
        self.assertEqual(expires_on(date(2025, 11, 15)), date(2026, 1, 1))
        self.assertEqual(expires_on(date(2026, 1, 2)), date(2026, 4, 2))


if __name__ == "__main__":
    unittest.main()
