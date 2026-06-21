"""Flask-only concurrent A/B probe: 10 users x mixed read endpoints against a
single Flask base URL. Used to compare single-threaded vs threaded serving on an
identical fresh instance. Usage: python flask_ab.py <baseurl> [users] [per_user]
"""
import concurrent.futures as cf
import sys
import time

import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5099"
USERS = int(sys.argv[2]) if len(sys.argv) > 2 else 10
PER = int(sys.argv[3]) if len(sys.argv) > 3 else 18
ADDR = "3gLnfy1gSXXnwSMeeWAMC6F9e3v3"
PATHS = [f"/balance?address={ADDR}", "/chain/summary", "/chain/blocks?limit=10&offset=0"]


def worker(_):
    s = requests.Session()
    lat = []
    for i in range(PER):
        p = PATHS[i % len(PATHS)]
        t0 = time.perf_counter()
        try:
            r = s.get(BASE + p, timeout=60)
            ms = (time.perf_counter() - t0) * 1000
            lat.append(ms if r.status_code == 200 else -ms)
        except Exception:
            lat.append(-1)
    return lat


def pctl(vals, p):
    ok = sorted(v for v in vals if v >= 0)
    if not ok:
        return float("nan")
    return ok[max(0, min(len(ok) - 1, int(round(p / 100 * (len(ok) - 1)))))]


all_lat = []
t0 = time.perf_counter()
with cf.ThreadPoolExecutor(max_workers=USERS) as ex:
    for r in ex.map(worker, range(USERS)):
        all_lat.extend(r)
wall = time.perf_counter() - t0
ok = [v for v in all_lat if v >= 0]
print(f"{BASE}  {USERS}u x {PER}  n={len(all_lat)} ok={len(ok)}  wall={wall:.2f}s  thru={len(all_lat)/wall:.1f}/s")
print(f"  p50={pctl(all_lat,50):.0f}ms  p95={pctl(all_lat,95):.0f}ms  max={max(ok):.0f}ms")
