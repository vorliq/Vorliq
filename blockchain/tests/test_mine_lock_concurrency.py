"""A read request issued while a block is being mined must return promptly,
because proof of work now runs outside the chain lock. Before the fix, the mine
endpoint held the write lock for the whole (multi-second) proof of work, so any
read that arrived during that window blocked until the block was done.

The test makes proof of work take a fixed, observable time, fires a read 0.4s into
it (i.e. while the miner is grinding), and asserts the read comes back in a small
fraction of the proof-of-work time. With the lock held during PoW the read would
instead take roughly the full PoW duration and the assertion would fail.
"""
import os
import tempfile
import time
import concurrent.futures as cf

_TEST_DATA_DIR = tempfile.TemporaryDirectory()
os.environ.setdefault("VORLIQ_DATA_DIR", _TEST_DATA_DIR.name)
os.environ["VORLIQ_MINING_ENABLED"] = "true"

from app import app  # noqa: E402
import app as app_module  # noqa: E402
from block import Block  # noqa: E402
from blockchain import Blockchain  # noqa: E402
from wallet import Wallet  # noqa: E402

# A few seconds of simulated proof of work. Kept generous so the "read returned
# in well under the PoW time" assertion has margin and does not flake on a busy
# CI runner where an unrelated read can momentarily be slow under CPU contention.
POW_SECONDS = 3.0


def test_read_is_not_blocked_during_mine_proof_of_work():
    # Keep proof of work itself trivially fast, and remove spacing cooldowns, so
    # the only meaningful delay is the injected POW_SECONDS sleep.
    # With BLOCK_TIME_MINIMUM=0 the spacing cooldown is always satisfied, so we do
    # not need to (and must not) mutate any existing block's timestamp. These are
    # class attributes shared across the session, so they are restored in the
    # finally block to avoid leaking state into other tests.
    saved_min = Blockchain.BLOCK_TIME_MINIMUM
    saved_gap = Blockchain.SAME_MINER_MIN_GAP
    Blockchain.BLOCK_TIME_MINIMUM = 0
    Blockchain.SAME_MINER_MIN_GAP = 0
    app_module.node.blockchain.difficulty = 1
    app_module.node.blockchain.proof_target = "0"

    miner = Wallet().address
    original_pow = Block.proof_of_work

    def slow_pow(self, difficulty=None):
        # The sleep stands in for a real difficulty-5 proof of work. Critically it
        # runs in the phase where the chain lock is NOT held.
        time.sleep(POW_SECONDS)
        return original_pow(self, difficulty)

    Block.proof_of_work = slow_pow
    results = {}
    try:
        client = app.test_client()

        def do_mine():
            r = client.post("/mine", json={"miner_address": miner})
            results["mine_status"] = r.status_code

        def do_read():
            time.sleep(0.4)  # let the miner enter the proof-of-work phase
            start = time.perf_counter()
            r = client.get("/chain/summary")
            results["read_latency"] = time.perf_counter() - start
            results["read_status"] = r.status_code

        with cf.ThreadPoolExecutor(max_workers=2) as ex:
            mine_future = ex.submit(do_mine)
            read_future = ex.submit(do_read)
            read_future.result(timeout=10)
            mine_future.result(timeout=10)
    finally:
        Block.proof_of_work = original_pow
        Blockchain.BLOCK_TIME_MINIMUM = saved_min
        Blockchain.SAME_MINER_MIN_GAP = saved_gap

    # The read succeeded...
    assert results["read_status"] == 200
    # ...and returned in a small fraction of the proof-of-work time, proving the
    # lock was not held while the block was being solved.
    assert results["read_latency"] < POW_SECONDS * 0.5, (
        f"read took {results['read_latency']:.2f}s during a {POW_SECONDS}s mine — "
        "it was blocked by the mining lock"
    )
    # And the block was still mined successfully.
    assert results["mine_status"] == 201
