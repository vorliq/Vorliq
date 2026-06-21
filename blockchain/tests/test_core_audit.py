"""Core correctness audit: double-spend prevention, spending an already-spent
output, block-reward consistency with the Mining page figure, and minimum block
time enforcement. One regression test per deferred audit item."""
from __future__ import annotations

import re
import time

import pytest

from blockchain import Blockchain, MiningCooldownError
from transaction import SYSTEM_ADDRESS, Transaction
from wallet import Wallet


def _fast_chain() -> Blockchain:
    # A chain with no minimum block spacing, set on the instance so the (class
    # level) production minimum that test 4 relies on is untouched. This keeps the
    # inter-block-gap validation consistent while letting the test mine quickly.
    blockchain = Blockchain()
    blockchain.BLOCK_TIME_MINIMUM = 0
    return blockchain


def _mine(blockchain: Blockchain, miner: str):
    return blockchain.mine_pending_transactions(miner)


def _fund(blockchain: Blockchain, address: str, amount: float, miner: str) -> None:
    blockchain.add_pending_transaction(Transaction(SYSTEM_ADDRESS, address, amount))
    _mine(blockchain, miner)


def test_double_spend_one_accepted_one_rejected_with_clear_reason() -> None:
    """Two transactions spending the same confirmed VLQ are submitted back to
    back: exactly one is accepted, the other is rejected with a clear reason."""
    blockchain = _fast_chain()
    sender, miner_a, miner_b = Wallet(), Wallet(), Wallet()
    recipient_one, recipient_two = Wallet(), Wallet()

    _fund(blockchain, sender.address, 100, miner_a.address)
    assert blockchain.get_balance(sender.address) == 100

    first = Transaction(sender.address, recipient_one.address, 100)
    first.sign_transaction(sender)
    second = Transaction(sender.address, recipient_two.address, 100)
    second.sign_transaction(sender)

    assert blockchain.add_pending_transaction(first) is True

    with pytest.raises(ValueError) as excinfo:
        blockchain.add_pending_transaction(second)
    # Rejected with a clear reason, not silently dropped.
    assert "enough confirmed VLQ" in str(excinfo.value)

    assert first in blockchain.pending_transactions
    assert second not in blockchain.pending_transactions

    _mine(blockchain, miner_b.address)
    assert blockchain.get_balance(recipient_one.address) == 100
    assert blockchain.get_balance(recipient_two.address) == 0
    assert blockchain.get_balance(sender.address) == 0


def test_spending_an_already_confirmed_output_is_rejected_at_the_mempool() -> None:
    """A transaction that reuses funds already spent in a confirmed block is
    rejected when it enters the mempool, before any block validation runs."""
    blockchain = _fast_chain()
    sender, miner_a, miner_b = Wallet(), Wallet(), Wallet()
    recipient_one, recipient_two = Wallet(), Wallet()

    _fund(blockchain, sender.address, 100, miner_a.address)

    spend = Transaction(sender.address, recipient_one.address, 100)
    spend.sign_transaction(sender)
    blockchain.add_pending_transaction(spend)
    _mine(blockchain, miner_b.address)  # the 100 VLQ is now spent in a confirmed block
    assert blockchain.get_balance(sender.address) == 0

    pending_before = len(blockchain.pending_transactions)
    reuse = Transaction(sender.address, recipient_two.address, 100)
    reuse.sign_transaction(sender)

    with pytest.raises(ValueError) as excinfo:
        blockchain.add_pending_transaction(reuse)
    assert "enough confirmed VLQ" in str(excinfo.value)

    # Rejected at the mempool: it never even joined the pending pool.
    assert reuse not in blockchain.pending_transactions
    assert len(blockchain.pending_transactions) == pending_before


def test_block_reward_matches_the_mining_page_figure_and_recorded_reward() -> None:
    """The reward the core calculates, the figure the Mining page shows
    (/mining/status), and the reward actually recorded in a block all agree."""
    blockchain = _fast_chain()

    core_reward = blockchain.get_current_mining_reward()

    status = blockchain.get_mining_status()
    # The Mining page shows miner share + treasury share as the block reward.
    displayed = round(status["miner_reward_after_treasury"] + status["treasury_reward_per_block"], 8)
    assert displayed == pytest.approx(core_reward, abs=1e-8)

    # Mine twice: the reward for block N is recorded in block N+1.
    _mine(blockchain, Wallet().address)
    reward_block = _mine(blockchain, Wallet().address)
    recorded = 0.0
    for raw in reward_block.transactions:
        transaction = raw if isinstance(raw, Transaction) else Transaction.from_dict(raw)
        if transaction.sender_address == SYSTEM_ADDRESS:
            recorded += float(transaction.amount)

    assert recorded == pytest.approx(core_reward, abs=1e-8)
    assert recorded == pytest.approx(displayed, abs=1e-8)


def test_block_submitted_before_minimum_block_time_is_rejected_with_wait_time() -> None:
    """A block mined before the minimum block time elapses is rejected with a
    message that names the required wait, not silently dropped."""
    blockchain = Blockchain()
    assert blockchain.BLOCK_TIME_MINIMUM > 0, "this test requires the production minimum block time"

    blockchain.mine_pending_transactions(Wallet().address)  # first block: allowed

    with pytest.raises(MiningCooldownError) as excinfo:
        blockchain.mine_pending_transactions(Wallet().address)  # immediately again: too soon

    message = str(excinfo.value)
    assert "too soon" in message
    assert re.search(r"wait \d+ seconds", message), message
    assert excinfo.value.wait_seconds >= 1
