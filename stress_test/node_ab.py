"""Node-layer concurrent A/B: 10 users hammering balance + recent-blocks reads
through a Node base URL (proxying to the same live Flask). Compares the live
backend (uncached balance/blocks) with the cached build. Usage:
  python node_ab.py <baseurl> [users] [per_user]
"""
import concurrent.futures as cf
import sys
import time

import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5000"
USERS = int(sys.argv[2]) if len(sys.argv) > 2 else 10
PER = int(sys.argv[3]) if len(sys.argv) > 3 else 18
ADDR = "3gLnfy1gSXXnwSMeeWAMC6F9e3v3"
PATHS = [
    f"/api/wallet/balance?address={ADDR}",
    "/api/chain/summary",
    "/api/chain/blocks?limit=10&offset=0",
]


def worker(_):
    s = requests.Session()
    out = {p: [] for p in PATHS}
    for i in range(PER):
        p = PATHS[i % len(PATHS)]
        t0 = time.perf_counter()
        try:
            r = s.get(BASE + p, timeout=60)
            ms = (time.perf_counter() - t0) * 1000
            out[p].append(ms if r.status_code == 200 else -ms)
        except Exception:
            out[p].append(-1)
    return out


def pctl(vals, p):
    ok = sorted(v for v in vals if v >= 0)
    if not ok:
        return float("nan")
    return ok[max(0, min(len(ok) - 1, int(round(p / 100 * (len(ok) - 1)))))]


merged = {p: [] for p in PATHS}
t0 = time.perf_counter()
with cf.ThreadPoolExecutor(max_workers=USERS) as ex:
    for res in ex.map(worker, range(USERS)):
        for p, v in res.items():
            merged[p].extend(v)
wall = time.perf_counter() - t0
total = sum(len(v) for v in merged.values())
print(f"{BASE}  {USERS}u x {PER}  total={total}  wall={wall:.2f}s  thru={total/wall:.1f}/s")
labels = {PATHS[0]: "balance", PATHS[1]: "summary", PATHS[2]: "blocks"}
for p in PATHS:
    v = merged[p]
    ok = [x for x in v if x >= 0]
    print(f"  {labels[p]:<8} n={len(v)} ok={len(ok)} p50={pctl(v,50):.0f}ms p95={pctl(v,95):.0f}ms max={max(ok) if ok else float('nan'):.0f}ms")
