import tempfile
import time
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from meta_gateway import ClientRateLimiter, SearchCache, cache_key_for, validate_target


class GatewayTests(unittest.TestCase):
    def test_allowlist_accepts_only_supported_scholarly_apis(self):
        validate_target("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed")
        validate_target("https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=test")
        validate_target("https://api.crossref.org/works?rows=1")
        validate_target("https://api.openalex.org/works?per-page=1")
        with self.assertRaises(ValueError):
            validate_target("https://example.com/")
        with self.assertRaises(ValueError):
            validate_target("http://api.crossref.org/works")
        with self.assertRaises(ValueError):
            validate_target("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=pubmed")
        with self.assertRaises(ValueError):
            validate_target("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=protein")
        with self.assertRaises(ValueError):
            validate_target("https://api.crossref.org/works?rows=1001")
        with self.assertRaises(ValueError):
            validate_target("https://api.openalex.org/works?per-page=201")
        with self.assertRaises(ValueError):
            validate_target("https://api.crossref.org/works?callback=https%3A%2F%2Fevil.example")

    def test_cache_uses_hash_key_and_ttl(self):
        secret_url = "https://api.openalex.org/works?api_key=secret-value&search=test"
        key = cache_key_for(secret_url)
        self.assertNotIn("secret-value", key)
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            cache = SearchCache(Path(directory) / "cache.sqlite3")
            cache.put(key, b"{}", "application/json", time.time())
            self.assertEqual(cache.get(key, 60)[0], b"{}")
            self.assertIsNone(cache.get(key, -1))

    def test_rate_limiter_enforces_burst_and_concurrency(self):
        limiter = ClientRateLimiter(window_seconds=10, max_requests=2, max_concurrent=1)
        allowed, _, _ = limiter.acquire("client-a", now=100.0)
        self.assertTrue(allowed)

        allowed, retry_after, reason = limiter.acquire("client-a", now=100.1)
        self.assertFalse(allowed)
        self.assertEqual(retry_after, 1)
        self.assertIn("并发", reason)

        limiter.release("client-a")
        allowed, _, _ = limiter.acquire("client-a", now=100.2)
        self.assertTrue(allowed)
        limiter.release("client-a")

        allowed, retry_after, reason = limiter.acquire("client-a", now=100.3)
        self.assertFalse(allowed)
        self.assertGreaterEqual(retry_after, 1)
        self.assertIn("频繁", reason)

        allowed, _, _ = limiter.acquire("client-a", now=111.0)
        self.assertTrue(allowed)
        limiter.release("client-a")


if __name__ == "__main__":
    unittest.main()
