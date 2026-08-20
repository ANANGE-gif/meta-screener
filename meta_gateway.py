"""MetaEvidence local search gateway.

Serves the static application and proxies only the four approved scholarly APIs.
Responses are cached by a SHA-256 key so API keys and search terms are not stored
in the cache database or written to the access log.
"""

from __future__ import annotations

import argparse
from collections import deque
import hashlib
import json
import sqlite3
import threading
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
MAX_TARGET_URL_BYTES = 16 * 1024
MAX_QUERY_FIELDS = 32
MAX_QUERY_VALUE_BYTES = 10 * 1024
RATE_LIMIT_WINDOW_SECONDS = 60
MAX_REQUESTS_PER_WINDOW = 36
MAX_CONCURRENT_PER_CLIENT = 3
MAX_CONCURRENT_GLOBAL = 12
USER_AGENT = "MetaEvidence/4.0 systematic-review-search-gateway"


def _bounded_int(params: dict[str, list[str]], name: str, *, maximum: int) -> None:
    values = params.get(name)
    if not values:
        return
    try:
        value = int(values[0])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"参数 {name} 必须为整数") from exc
    if value < 0 or value > maximum:
        raise ValueError(f"参数 {name} 超出允许范围")


def _validate_target_query(parsed: urllib.parse.SplitResult) -> None:
    try:
        params = urllib.parse.parse_qs(
            parsed.query,
            keep_blank_values=True,
            max_num_fields=MAX_QUERY_FIELDS,
        )
    except ValueError as exc:
        raise ValueError("查询参数过多") from exc

    if any(len(value.encode("utf-8")) > MAX_QUERY_VALUE_BYTES for values in params.values() for value in values):
        raise ValueError("查询参数过长")
    if any(name.lower() in {"url", "uri", "callback", "redirect", "redirect_uri"} for name in params):
        raise ValueError("查询参数包含不允许的跳转字段")

    host = (parsed.hostname or "").lower()
    if host == "eutils.ncbi.nlm.nih.gov":
        if parsed.path not in {
            "/entrez/eutils/esearch.fcgi",
            "/entrez/eutils/efetch.fcgi",
        }:
            raise ValueError("NCBI 接口路径不在允许列表中")
        if (params.get("db") or [""])[0].lower() != "pubmed":
            raise ValueError("仅允许检索 PubMed")
        _bounded_int(params, "retmax", maximum=500)
        _bounded_int(params, "retstart", maximum=10000)
        ids = (params.get("id") or [""])[0]
        if ids and len([item for item in ids.split(",") if item]) > 500:
            raise ValueError("单次 PubMed 详情请求最多 500 条")
    elif host == "www.ebi.ac.uk":
        if parsed.path != "/europepmc/webservices/rest/search":
            raise ValueError("Europe PMC 接口路径不在允许列表中")
        _bounded_int(params, "pageSize", maximum=1000)
    elif host == "api.crossref.org":
        if parsed.path != "/works":
            raise ValueError("Crossref 接口路径不在允许列表中")
        _bounded_int(params, "rows", maximum=1000)
    elif host == "api.openalex.org":
        if parsed.path != "/works":
            raise ValueError("OpenAlex 接口路径不在允许列表中")
        _bounded_int(params, "per-page", maximum=200)


class ClientRateLimiter:
    """Thread-safe rolling-window and in-flight request limiter."""

    def __init__(
        self,
        window_seconds: int = RATE_LIMIT_WINDOW_SECONDS,
        max_requests: int = MAX_REQUESTS_PER_WINDOW,
        max_concurrent: int = MAX_CONCURRENT_PER_CLIENT,
    ) -> None:
        self.window_seconds = window_seconds
        self.max_requests = max_requests
        self.max_concurrent = max_concurrent
        self._requests: dict[str, deque[float]] = {}
        self._inflight: dict[str, int] = {}
        self._lock = threading.Lock()
        self._last_cleanup = 0.0

    def acquire(self, client: str, now: float | None = None) -> tuple[bool, int, str]:
        current = time.monotonic() if now is None else now
        with self._lock:
            bucket = self._requests.setdefault(client, deque())
            cutoff = current - self.window_seconds
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if self._inflight.get(client, 0) >= self.max_concurrent:
                return False, 1, "并发请求过多"
            if len(bucket) >= self.max_requests:
                retry_after = max(1, int(self.window_seconds - (current - bucket[0])) + 1)
                return False, retry_after, "请求过于频繁"

            bucket.append(current)
            self._inflight[client] = self._inflight.get(client, 0) + 1
            if current - self._last_cleanup > self.window_seconds * 2:
                self._cleanup(cutoff)
                self._last_cleanup = current
            return True, 0, ""

    def release(self, client: str) -> None:
        with self._lock:
            count = self._inflight.get(client, 0)
            if count <= 1:
                self._inflight.pop(client, None)
            else:
                self._inflight[client] = count - 1

    def _cleanup(self, cutoff: float) -> None:
        stale = [client for client, bucket in self._requests.items() if not bucket or bucket[-1] <= cutoff]
        for client in stale:
            if not self._inflight.get(client):
                self._requests.pop(client, None)


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
    if not raw_url or len(raw_url.encode("utf-8")) > MAX_TARGET_URL_BYTES:
        raise ValueError("目标接口地址为空或过长")
    parsed = urllib.parse.urlsplit(raw_url)
    host = (parsed.hostname or "").lower()
    allowed_path = ALLOWED_TARGETS.get(host)
    if parsed.scheme != "https" or not allowed_path or not parsed.path.startswith(allowed_path):
        raise ValueError("目标接口不在允许列表中")
    if parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.fragment:
        raise ValueError("目标接口地址无效")
    _validate_target_query(parsed)
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

    @property
    def rate_limiter(self) -> ClientRateLimiter:
        return self.server.rate_limiter  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args) -> None:
        # Never log query strings because they can contain API keys.
        safe_path = urllib.parse.urlsplit(self.path).path
        print(f"{self.address_string()} [{self.log_date_time_string()}] {self.command} {safe_path}")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
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

    def do_POST(self) -> None:
        self._send_json(405, {"error": "仅允许 GET 请求"})

    def do_PUT(self) -> None:
        self._send_json(405, {"error": "仅允许 GET 请求"})

    def do_DELETE(self) -> None:
        self._send_json(405, {"error": "仅允许 GET 请求"})

    def _proxy(self, request: urllib.parse.SplitResult) -> None:
        client = str(self.client_address[0])
        allowed, retry_after, reason = self.rate_limiter.acquire(client)
        if not allowed:
            body = json.dumps({"error": reason}, ensure_ascii=False).encode("utf-8")
            self.send_response(429)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Retry-After", str(retry_after))
            self.end_headers()
            self.wfile.write(body)
            return

        global_slot = self.server.global_semaphore.acquire(blocking=False)  # type: ignore[attr-defined]
        if not global_slot:
            self.rate_limiter.release(client)
            self._send_json(503, {"error": "服务器繁忙，请稍后重试"})
            return

        try:
            self._proxy_limited(request)
        finally:
            self.server.global_semaphore.release()  # type: ignore[attr-defined]
            self.rate_limiter.release(client)

    def _proxy_limited(self, request: urllib.parse.SplitResult) -> None:
        params = urllib.parse.parse_qs(request.query)
        target = (params.get("url") or [""])[0]
        try:
            parsed_target = validate_target(target)
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
            return

        key = cache_key_for(target)
        ttl = CACHE_TTL_SECONDS[parsed_target.hostname.lower()]  # type: ignore[union-attr]
        cached = self.cache.get(key, ttl)
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
                    self._send_json(exc.code, {"error": f"上游数据库 HTTP {exc.code}"})
                    return
                retry_after = exc.headers.get("Retry-After", "")
                wait = min(8.0, float(retry_after)) if retry_after.replace(".", "", 1).isdigit() else 0.75 * (2**attempt)
                time.sleep(wait)
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.75 * (2**attempt))

        self._send_json(502, {"error": "上游数据库连接失败"})

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
    server.rate_limiter = ClientRateLimiter()  # type: ignore[attr-defined]
    server.global_semaphore = threading.BoundedSemaphore(MAX_CONCURRENT_GLOBAL)  # type: ignore[attr-defined]
    print(f"MetaEvidence running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
