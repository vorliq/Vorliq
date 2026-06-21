"""Concurrent load audit for the Vorliq read path.

Simulates N concurrent users each issuing a mix of balance reads, chain-summary
fetches, and recent-block reads, measured separately at the Node layer (5000)
and the Flask layer (5001). Reports p50/p95/max and throughput so the effect of
server-side concurrency changes is visible before/after.

Usage:  python concurrent_audit.py [users] [requests_per_user]
"""
import concurrent.futures as cf
import statistics
import sys
import time

import requests

NODE = "http://localhost:5000/api"
FLASK = "http://localhost:5001"
ADDRESS = "3gLnfy1gSXXnwSMeeWAMC6F9e3v3"

USERS = int(sys.argv[1]) if len(sys.argv) > 1 else 10
PER_USER = int(sys.argv[2]) if len(sys.argv) > 2 else 15

# (label, base, path) — a realistic read mix a logged-in dashboard generates.
ENDPOINTS = [
    ("flask/balance", FLASK, f"/balance?address={ADDRESS}"),
    ("flask/summary", FLASK, "/chain/summary"),
    ("flask/blocks", FLASK, "/chain/blocks?limit=10&offset=0"),
    ("node/balance", NODE, f"/balance?address={ADDRESS}"),
    ("node/summary", NODE, "/chain/summary"),
    ("node/blocks", NODE, "/chain/blocks?limit=10&offset=0"),
]


def worker(_n):
    out = {label: [] for label, _, _ in ENDPOINTS}
    sess = requests.Session()
    for i in range(PER_USER):
        label, base, path = ENDPOINTS[i % len(ENDPOINTS)]
        t0 = time.perf_counter()
        try:
            r = sess.get(base + path, timeout=30)
            ms = (time.perf_counter() - t0) * 1000
            out[label].append(ms if r.status_code == 200 else -ms)
        except Exception:
            out[label].append(-99999)
    return out


def pct(values, p):
    ok = sorted(v for v in values if v >= 0)
    if not ok:
        return float("nan")
    k = max(0, min(len(ok) - 1, int(round((p / 100) * (len(ok) - 1)))))
    return ok[k]


def main():
    print(f"Concurrent audit: {USERS} users x {PER_USER} reqs (mixed read endpoints)")
    merged = {label: [] for label, _, _ in ENDPOINTS}
    wall0 = time.perf_counter()
    with cf.ThreadPoolExecutor(max_workers=USERS) as ex:
        for res in ex.map(worker, range(USERS)):
            for label, vals in res.items():
                merged[label].extend(vals)
    wall = time.perf_counter() - wall0

    total = sum(len(v) for v in merged.values())
    print(f"\nTotal {total} requests in {wall:.2f}s  ->  {total / wall:.1f} req/s\n")
    print(f"{'endpoint':<16}{'n':>4}{'ok':>4}{'p50ms':>9}{'p95ms':>9}{'maxms':>9}")
    for label, _, _ in ENDPOINTS:
        vals = merged[label]
        ok = [v for v in vals if v >= 0]
        p50 = pct(vals, 50)
        p95 = pct(vals, 95)
        mx = max((v for v in ok), default=float("nan"))
        print(f"{label:<16}{len(vals):>4}{len(ok):>4}{p50:>9.1f}{p95:>9.1f}{mx:>9.1f}")


if __name__ == "__main__":
    main()
