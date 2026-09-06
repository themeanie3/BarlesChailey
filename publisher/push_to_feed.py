"""
push_to_feed.py — drop-in publisher for the station Pi.

The BarlesChailey API accepts the exact same push the sta03-dashboard Worker
does: POST the raw FSAS table HTML with `X-Push-Secret` and `X-Feed-Ts`. This
module lets the existing scraper loop fan out to both without touching its
notification logic.

Usage inside IYAFYLv3.py (next to the existing table_bus.publish_table call):

    from push_to_feed import FeedPublisher
    feed = FeedPublisher()                      # reads env: FEED_URL, FEED_PUSH_SECRET
    ...
    if table_bus.publish_table(html):           # only when the table changed
        feed.publish(html)

Environment:
    FEED_URL          e.g. https://barleschailey-api.<account>.workers.dev/push
    FEED_PUSH_SECRET  the PUSH_SECRET configured on the Worker (wrangler secret put PUSH_SECRET)
    FEED_IFACE        optional, e.g. wlan0 — binds the socket like the rest of sta03 does

The publisher is fail-soft: a dead API must never stall the scraper, so
requests use short timeouts and errors are logged, not raised.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
import time

import requests

try:  # optional, only used when FEED_IFACE is set
    from requests_toolbelt.adapters.socket_options import SocketOptionsAdapter
except Exception:  # pragma: no cover
    SocketOptionsAdapter = None  # type: ignore

log = logging.getLogger("push_to_feed")


class FeedPublisher:
    def __init__(self, url: str | None = None, secret: str | None = None, iface: str | None = None, timeout=(3.05, 5)):
        self.url = url or os.getenv("FEED_URL", "")
        self.secret = secret or os.getenv("FEED_PUSH_SECRET", "")
        self.timeout = timeout
        self._lock = threading.Lock()
        self._last_error_at = 0.0
        self.session = requests.Session()
        iface = iface or os.getenv("FEED_IFACE")
        if iface and SocketOptionsAdapter is not None:
            options = [(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, iface.encode())]
            for prefix in ("http://", "https://"):
                self.session.mount(prefix, SocketOptionsAdapter(socket_options=options))
        if not self.url or not self.secret:
            log.warning("FeedPublisher disabled: FEED_URL / FEED_PUSH_SECRET not set")

    @property
    def enabled(self) -> bool:
        return bool(self.url and self.secret)

    def publish(self, html: str, ts: float | None = None) -> bool:
        """POST one table snapshot. Returns True when the API accepted it."""
        if not self.enabled or not html or not html.strip():
            return False
        headers = {
            "X-Push-Secret": self.secret,
            "X-Feed-Ts": str(ts if ts is not None else time.time()),
            "Content-Type": "text/html; charset=utf-8",
        }
        try:
            with self._lock:
                r = self.session.post(self.url, data=html.encode("utf-8"), headers=headers, timeout=self.timeout)
            if r.status_code == 200:
                return True
            self._log_once(f"feed rejected push: {r.status_code} {r.text[:120]}")
        except requests.RequestException as e:
            self._log_once(f"feed unreachable: {e}")
        return False

    def publish_async(self, html: str, ts: float | None = None) -> None:
        """Fire-and-forget variant so the 100 ms scrape loop never waits on the network."""
        threading.Thread(target=self.publish, args=(html, ts), daemon=True).start()

    def _log_once(self, message: str, every: float = 60.0) -> None:
        now = time.time()
        if now - self._last_error_at > every:
            self._last_error_at = now
            log.warning(message)


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    path = sys.argv[1] if len(sys.argv) > 1 else None
    body = open(path, encoding="utf-8").read() if path else sys.stdin.read()
    ok = FeedPublisher().publish(body)
    print("ok" if ok else "failed")
    sys.exit(0 if ok else 1)
