"""Tests for normalization, parsing, and status mapping.

HTTP paths use httpx.MockTransport — no network, no extra dependency.
Run: python -m unittest discover -s tests
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402

import ttr_client  # noqa: E402

SAMPLES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples")


def _sample(name):
    with open(os.path.join(SAMPLES, f"{name}.json")) as fh:
        return json.load(fh)


def _mock(status_codes):
    """MockTransport that returns each (status, body) in turn, repeating last."""
    calls = {"n": 0}

    def handler(request):
        i = min(calls["n"], len(status_codes) - 1)
        calls["n"] += 1
        status, body = status_codes[i]
        return httpx.Response(status, json=body)

    t = httpx.MockTransport(handler)
    t.calls = calls
    return t


def _resolve(transport, addr="x"):
    return ttr_client.resolve(
        addr, api_key="k", retry_delay=0, min_interval=0, transport=transport
    )


class TestNormalize(unittest.TestCase):
    def test_round_trip_known_codes(self):
        cases = {
            "01-0006": "10006",   # Denver
            "44-0060": "440060",  # Vail
            "07-0003": "70003",   # Boulder
            "12-0044": "120044",  # Thornton
        }
        for dashed, expected in cases.items():
            self.assertEqual(ttr_client.normalize_code(dashed), expected, dashed)


class TestParse(unittest.TestCase):
    def test_denver_fixture(self):
        r = ttr_client._parse_success(_sample("denver"))
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["code_dashed"], "01-0006")
        self.assertEqual(r["code_dashless"], "10006")
        self.assertEqual(r["total_rate"], 0.0915)
        self.assertEqual(len(r["rate_breakdown"]), 4)
        self.assertEqual(r["rate_breakdown"][0], {"jurisdiction": "Colorado", "type": "state", "rate": 0.029})

    def test_vail_fixture(self):
        r = ttr_client._parse_success(_sample("vail"))
        self.assertEqual(r["code_dashless"], "440060")
        self.assertEqual(r["total_rate"], 0.094)

    def test_no_code_is_no_match(self):
        r = ttr_client._parse_success({"salesTax": []})
        self.assertEqual(r["status"], "no_match")


class TestStatusMapping(unittest.TestCase):
    def test_200_resolves(self):
        r = _resolve(_mock([(200, _sample("denver"))]))
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(r["code_dashless"], "10006")

    def test_persistent_500_is_no_match(self):
        r = _resolve(_mock([(500, {"id": "internal_server_error"})]))
        self.assertEqual(r["status"], "no_match")

    def test_401_then_200_recovers(self):
        # throttle on first call, success on the spaced retry
        t = _mock([(401, {"id": "authentication_error"}), (200, _sample("vail"))])
        r = _resolve(t)
        self.assertEqual(r["status"], "resolved")
        self.assertEqual(t.calls["n"], 2)

    def test_persistent_401_is_unavailable(self):
        r = _resolve(_mock([(401, {"id": "authentication_error"})]))
        self.assertEqual(r["status"], "unavailable")

    def test_missing_key_is_unavailable(self):
        r = ttr_client.resolve("x", api_key="", retry_delay=0)
        self.assertEqual(r["status"], "unavailable")

    def test_non_transient_400_not_retried(self):
        t = _mock([(400, {"id": "bad_request"})])
        r = _resolve(t)
        self.assertEqual(r["status"], "unavailable")
        self.assertEqual(t.calls["n"], 1)  # no retry on a 400


if __name__ == "__main__":
    unittest.main()
