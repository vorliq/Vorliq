from __future__ import annotations

import threading

from block import Block
from blockchain import Blockchain, MiningCooldownError


class SlowValidationBlockchain(Blockchain):
    """Widens the validate-then-append window so an unlocked add_block
    would reliably let two competing blocks through."""

    VALIDATION_DELAY_SECONDS = 0.05

    def _transactions_are_valid_for_next_block(self, transactions) -> bool:
        import time

        time.sleep(self.VALIDATION_DELAY_SECONDS)
        return super()._transactions_are_valid_for_next_block(transactions)


def _competing_block(blockchain: Blockchain, miner_address: str, timestamp_offset: float) -> Block:
    tip = blockchain.get_latest_block()
    block = Block(
        index=tip.index + 1,
        transactions=[],
        previous_hash=tip.hash,
        timestamp=tip.timestamp + blockchain.BLOCK_TIME_MINIMUM + timestamp_offset,
        miner_address=miner_address,
    )
    block.proof_of_work(blockchain.difficulty)
    return block


def test_concurrent_competing_blocks_only_one_appends() -> None:
    blockchain = SlowValidationBlockchain()
    first_candidate = _competing_block(blockchain, "VLQ_RACE_MINER_ONE", 1.0)
    second_candidate = _competing_block(blockchain, "VLQ_RACE_MINER_TWO", 2.0)

    barrier = threading.Barrier(2)
    results: dict[str, bool] = {}

    def submit(name: str, candidate: Block) -> None:
        barrier.wait()
        results[name] = blockchain.add_block(candidate)

    threads = [
        threading.Thread(target=submit, args=("first", first_candidate)),
        threading.Thread(target=submit, args=("second", second_candidate)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(results.values()) == [False, True]
    assert len(blockchain.chain) == 2
    indices = [block.index for block in blockchain.chain]
    assert indices == sorted(set(indices))
    assert blockchain.is_chain_valid()


def test_concurrent_mining_requests_never_fork_the_chain() -> None:
    blockchain = Blockchain()
    barrier = threading.Barrier(2)
    outcomes: dict[str, str] = {}

    def mine(name: str, miner_address: str) -> None:
        barrier.wait()
        try:
            blockchain.mine_pending_transactions(miner_address)
            outcomes[name] = "mined"
        except MiningCooldownError:
            outcomes[name] = "cooldown"
        except RuntimeError:
            outcomes[name] = "lost_race"

    threads = [
        threading.Thread(target=mine, args=("first", "VLQ_RACE_MINER_ONE")),
        threading.Thread(target=mine, args=("second", "VLQ_RACE_MINER_TWO")),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    mined_count = sum(1 for outcome in outcomes.values() if outcome == "mined")
    assert mined_count >= 1
    assert len(blockchain.chain) == 1 + mined_count
    indices = [block.index for block in blockchain.chain]
    assert indices == list(range(len(blockchain.chain)))
    assert blockchain.is_chain_valid()
