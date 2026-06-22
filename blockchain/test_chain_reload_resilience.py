"""Startup resilience: a chain whose blocks were mined faster than the current
minimum block spacing must survive a service restart without data loss.

This reproduces the production risk directly: blocks are mined under a permissive
spacing policy (as a local/dev node or an earlier policy version would), the
spacing minimum is then raised (as production config might be), and the chain is
reloaded from disk through the real Storage path. The reload must keep every
block (no silent "start fresh" that wipes history) and report the chain as valid
on structural integrity, because historical block spacing is admission policy
that is grandfathered, not a permanent chain invariant.
"""
from __future__ import annotations

import tempfile
import time

from blockchain import Blockchain
from storage import Storage


def _mine_fast_chain(num_blocks: int) -> Blockchain:
    """Mine a chain whose blocks are spaced well under any realistic minimum."""
    blockchain = Blockchain()
    miners = ["miner-one-address", "miner-two-address"]
    for i in range(num_blocks):
        # Move the tip back so the cooldown lets the next block in immediately,
        # producing blocks only a second or two apart in stored time.
        tip = blockchain.get_latest_block()
        tip.timestamp = time.time() - 2
        tip.proof_of_work(blockchain.difficulty)
        blockchain.mine_pending_transactions(miners[i % len(miners)])
    return blockchain


def test_fast_mined_chain_survives_reload_without_data_loss():
    original_min = Blockchain.BLOCK_TIME_MINIMUM
    original_gap = Blockchain.SAME_MINER_MIN_GAP
    try:
        # Mine under a permissive policy: no minimum spacing.
        Blockchain.BLOCK_TIME_MINIMUM = 0
        Blockchain.SAME_MINER_MIN_GAP = 0
        blockchain = _mine_fast_chain(3)
        height_before = blockchain.get_block_height()
        assert height_before == 3, "expected genesis plus three mined blocks"

        with tempfile.TemporaryDirectory() as data_dir:
            storage = Storage(data_dir)
            storage.save_chain(blockchain)

            # Now tighten the policy, exactly as a production config change or a
            # software upgrade would. The stored blocks are now "too close".
            Blockchain.BLOCK_TIME_MINIMUM = 30
            Blockchain.SAME_MINER_MIN_GAP = 60

            # Under the old behaviour (full enforcement) this chain would be
            # judged invalid purely because of historical spacing...
            assert blockchain.is_chain_valid(enforce_block_spacing=True) is False

            # ...but it is structurally intact, so integrity-only validation —
            # the mode used on reload — must accept it.
            assert blockchain.is_chain_valid(enforce_block_spacing=False) is True

            # The real reload path must return the chain (never None / fresh) and
            # preserve every block.
            reloaded = storage.load_chain()
            assert reloaded is not None, "reload returned no chain: history would be lost"
            assert reloaded.get_block_height() == height_before
            assert not storage.chain_write_protected
            assert reloaded.is_chain_valid(enforce_block_spacing=False) is True
    finally:
        Blockchain.BLOCK_TIME_MINIMUM = original_min
        Blockchain.SAME_MINER_MIN_GAP = original_gap


def test_structurally_broken_chain_is_still_rejected_on_reload():
    """Grandfathering spacing must not weaken tamper detection: a chain with a
    corrupted block hash must still fail integrity-only validation."""
    original_min = Blockchain.BLOCK_TIME_MINIMUM
    original_gap = Blockchain.SAME_MINER_MIN_GAP
    try:
        Blockchain.BLOCK_TIME_MINIMUM = 0
        Blockchain.SAME_MINER_MIN_GAP = 0
        blockchain = _mine_fast_chain(2)
        # Tamper with a confirmed block's hash.
        blockchain.chain[1].hash = "0" * len(blockchain.chain[1].hash)
        assert blockchain.is_chain_valid(enforce_block_spacing=False) is False
    finally:
        Blockchain.BLOCK_TIME_MINIMUM = original_min
        Blockchain.SAME_MINER_MIN_GAP = original_gap


if __name__ == "__main__":
    test_fast_mined_chain_survives_reload_without_data_loss()
    test_structurally_broken_chain_is_still_rejected_on_reload()
    print("PASS: chain reload resilience")
