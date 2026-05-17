import unittest

from blockchain import Blockchain
from exchange import Exchange
from transaction import Transaction
from wallet import Wallet


def mine_now(blockchain, miner="miner"):
    blockchain.chain[-1].timestamp -= blockchain.BLOCK_TIME_MINIMUM + 1
    return blockchain.mine_pending_transactions(miner)


class ExchangeLifecycleTests(unittest.TestCase):
    def test_new_offer_starts_open(self):
        exchange = Exchange()
        offer_id = exchange.create_offer("creator", "sell", 25, "10 USD", "local trade")

        offer = exchange.get_offer(offer_id)

        self.assertEqual(offer["status"], "open")
        self.assertEqual(offer["status_history"][0]["status"], "open")

    def test_accept_moves_to_accepted(self):
        exchange = Exchange()
        offer_id = exchange.create_offer("creator", "sell", 25, "10 USD", "local trade")

        offer = exchange.accept_offer(offer_id, "acceptor")

        self.assertEqual(offer["status"], "accepted")
        self.assertEqual(offer["acceptor_address"], "acceptor")
        self.assertIsNotNone(offer["accepted_at"])

    def test_creator_can_cancel_open_offer(self):
        exchange = Exchange()
        offer_id = exchange.create_offer("creator", "sell", 25, "10 USD", "local trade")

        offer = exchange.cancel_offer(offer_id, "creator")

        self.assertEqual(offer["status"], "cancelled")
        self.assertIsNotNone(offer["cancelled_at"])

    def test_non_creator_cannot_cancel(self):
        exchange = Exchange()
        offer_id = exchange.create_offer("creator", "sell", 25, "10 USD", "local trade")

        with self.assertRaises(ValueError):
            exchange.cancel_offer(offer_id, "acceptor")

    def test_record_vlq_tx_moves_to_pending_and_sync_confirms(self):
        blockchain = Blockchain()
        seller = Wallet()
        buyer = Wallet()
        exchange = Exchange()
        offer_id = exchange.create_offer(seller.address, "sell", 25, "10 USD", "local trade")
        exchange.accept_offer(offer_id, buyer.address)

        blockchain.add_pending_transaction(Transaction("SYSTEM", seller.address, 30))
        mine_now(blockchain, "miner-a")
        tx = Transaction(seller.address, buyer.address, 25)
        tx.sign_transaction(seller)
        blockchain.add_pending_transaction(tx)

        offer = exchange.record_vlq_tx(offer_id, tx.tx_id, seller.address, blockchain)
        self.assertEqual(offer["status"], "vlq_pending")
        self.assertEqual(offer["vlq_tx_id"], tx.tx_id)

        mine_now(blockchain, "miner-b")
        changed = exchange.sync_trade_statuses(blockchain)

        self.assertTrue(changed)
        self.assertEqual(exchange.get_offer(offer_id)["status"], "vlq_confirmed")

    def test_both_parties_confirming_moves_trade_to_completed(self):
        exchange = Exchange()
        offer_id = exchange.create_offer("creator", "sell", 25, "10 USD", "local trade")
        exchange.accept_offer(offer_id, "acceptor")
        exchange.offers[offer_id]["status"] = "vlq_confirmed"

        first = exchange.confirm_trade_complete(offer_id, "creator")
        second = exchange.confirm_trade_complete(offer_id, "acceptor")

        self.assertEqual(first["status"], "vlq_confirmed")
        self.assertEqual(second["status"], "completed")
        self.assertTrue(second["offchain_confirmation_creator"])
        self.assertTrue(second["offchain_confirmation_acceptor"])

    def test_one_party_confirm_does_not_complete(self):
        exchange = Exchange()
        offer_id = exchange.create_offer("creator", "sell", 25, "10 USD", "local trade")
        exchange.accept_offer(offer_id, "acceptor")
        exchange.offers[offer_id]["status"] = "vlq_confirmed"

        offer = exchange.confirm_trade_complete(offer_id, "creator")

        self.assertEqual(offer["status"], "vlq_confirmed")
        self.assertTrue(offer["offchain_confirmation_creator"])
        self.assertFalse(offer["offchain_confirmation_acceptor"])

    def test_dispute_moves_active_trade_to_disputed(self):
        exchange = Exchange()
        offer_id = exchange.create_offer("creator", "sell", 25, "10 USD", "local trade")
        exchange.accept_offer(offer_id, "acceptor")

        offer = exchange.open_dispute(offer_id, "acceptor", "Off-chain item was not delivered.")

        self.assertEqual(offer["status"], "disputed")
        self.assertEqual(offer["dispute_reason"], "Off-chain item was not delivered.")

    def test_legacy_statuses_load_safely(self):
        exchange = Exchange()
        exchange.offers["legacy"] = {
            "offer_id": "legacy",
            "creator_address": "creator",
            "offer_type": "sell",
            "amount": 10,
            "price": "terms",
            "description": "legacy",
            "timestamp": 1,
            "status": "mystery",
        }

        offer = exchange.get_offer("legacy")

        self.assertEqual(offer["status"], "open")
        self.assertIn("compatibility_note", offer)


if __name__ == "__main__":
    unittest.main()
