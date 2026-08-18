"""MetaEvidence local search gateway.

Serves the static application and proxies only the four approved scholarly APIs.
Responses are cached by a SHA-256 key so API keys and search terms are not stored
in the cache database or written to the access log.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from contextlib import closing


ALLOWED_TARGETS = {
    "eutils.ncbi.nlm.nih.gov": "/entrez/eutils/",
    "www.ebi.ac.uk": "/europepmc/webservices/rest/",
    "api.crossref.org": "/works",
    "api.openalex.org": "/works",
}

CACHE_TTL_SECONDS = {
    "eutils.ncbi.nlm.nih.gov": 6 * 60 * 60,
    "www.ebi.ac.uk": 12 * 60 * 60,
    "api.crossref.org": 24 * 60 * 60,
    "api.openalex.org": 24 * 60 * 60,
}

MAX_RESPONSE_BYTES = 30 * 1024 * 1024
USER_AGENT = "MetaEvidence/4.0 systematic-review-search-gateway"


class SearchCache:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with closing(self._connect()) as db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS responses (
                    cache_key TEXT PRIMARY KEY,
                    body BLOB NOT NULL,
                    content_type TEXT NOT NULL,
                    fetched_at REAL NOT NULL
                )
                """
            )
            db.commit()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def get(self, cache_key: str, ttl_seconds: int):
        with closing(self._connect()) as db:
            row = db.execute(
                "SELECT body, content_type, fetched_at FROM responses WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
        if not row or time.time() - float(row[2]) > ttl_seconds:
            return None
        return bytes(row[0]), str(row[1]), float(row[2])

    def put(self, cache_key: str, body: bytes, content_type: str, fetched_at: float) -> None:
        if len(body) > MAX_RESPONSE_BYTES:
            return
        with closing(self._connect()) as db:
            db.execute(
                "INSERT OR REPLACE INTO responses(cache_key, body, content_type, fetched_at) VALUES(?,?,?,?)",
                (cache_key, body, content_type, fetched_at),
            )
            db.commit()


def validate_target(raw_url: str) -> urllib.parse.SplitResult:
    parsed = urllib.parse.urlsplit(raw_url)
    host = (parsed.hostname or "").lower()
    allowed_path = ALLOWED_TARGETS.get(host)
    if parsed.scheme != "https" or not allowed_path or not parsed.path.startswith(allowed_path):
        raise ValueError("目标接口不在允许列表中")
    if parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("目标接口地址无效")
    return parsed


def cache_key_for(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


class MetaEvidenceHandler(SimpleHTTPRequestHandler):
    server_version = "MetaEvidenceGateway/4.0"

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    @property
    def cache(self) -> SearchCache:
        return self.server.search_cache  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args) -> None:
        # Never log query strings because they can contain API keys.
        safe_path = urllib.parse.urlsplit(self.path).path
        print(f"{self.address_string()} [{self.log_date_time_string()}] {self.command} {safe_path}")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed_request = urllib.parse.urlsplit(self.path)
        if parsed_request.path == "/api/health":
            self._send_json(200, {"ok": True, "service": "MetaEvidence search gateway", "version": 4})
            return
        if parsed_request.path == "/api/proxy":
            self._proxy(parsed_request)
            return
        super().do_GET()

    def _proxy(self, request: urllib.parse.SplitResult) -> None:
        params = urllib.parse.parse_qs(request.query)
        target = (params.get("url") or [""])[0]
        refresh = (params.get("refresh") or [""])[0] == "1"
        try:
            parsed_target = validate_target(target)
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
            return

        key = cache_key_for(target)
        ttl = CACHE_TTL_SECONDS[parsed_target.hostname.lower()]  # type: ignore[union-attr]
        cached = None if refresh else self.cache.get(key, ttl)
        if cached:
            body, content_type, fetched_at = cached
            self._send_proxy_response(body, content_type, "hit", fetched_at)
            return

        last_error = None
        for attempt in range(3):
            try:
                upstream_request = urllib.request.Request(
                    target,
                    headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/xml, text/xml;q=0.9, */*;q=0.8"},
                )
                with urllib.request.urlopen(upstream_request, timeout=35) as response:
                    body = response.read(MAX_RESPONSE_BYTES + 1)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise ValueError("数据库响应过大，请缩小检索范围")
                    content_type = response.headers.get("Content-Type", "application/octet-stream")
                fetched_at = time.time()
                self.cache.put(key, body, content_type, fetched_at)
                self._send_proxy_response(body, content_type, "miss", fetched_at)
                return
            except urllib.error.HTTPError as exc:
                last_error = exc
                retryable = exc.code == 429 or 500 <= exc.code < 600
                if not retryable or attempt == 2:
                    detail = exc.read(1024).decode("utf-8", errors="replace")
                    self._send_json(exc.code, {"error": f"上游数据库 HTTP {exc.code}", "detail": detail[:500]})
                    return
                retry_after = exc.headers.get("Retry-After", "")
                wait = min(8.0, float(retry_after)) if retry_after.replace(".", "", 1).isdigit() else 0.75 * (2**attempt)
                time.sleep(wait)
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.75 * (2**attempt))

        self._send_json(502, {"error": "上游数据库连接失败", "detail": str(last_error or "未知错误")})

    def _send_proxy_response(self, body: bytes, content_type: str, cache_state: str, fetched_at: float) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Meta-Cache", cache_state)
        self.send_header("X-Meta-Fetched-At", str(int(fetched_at)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve MetaEvidence with a cached scholarly-search gateway")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--directory", default=str(Path(__file__).resolve().parent))
    args = parser.parse_args()

    root = Path(args.directory).resolve()
    cache = SearchCache(root / ".meta-cache" / "search-cache.sqlite3")
    handler = lambda *h_args, **h_kwargs: MetaEvidenceHandler(*h_args, directory=str(root), **h_kwargs)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    server.search_cache = cache  # type: ignore[attr-defined]
    print(f"MetaEvidence running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
