from __future__ import annotations

import json
import multiprocessing
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import requests


ROOT_DIR = Path(__file__).resolve().parents[1]
BLOCKCHAIN_DIR = ROOT_DIR / "blockchain"
DATA_ROOT = ROOT_DIR / "stress_test" / "node_data"
PORTS = [5101, 5102, 5103, 5104, 5105]
NODE_URLS = [f"http://127.0.0.1:{port}" for port in PORTS]
REQUEST_TIMEOUT = 120


def run_flask_node(port: int, data_dir: str) -> None:
    os.environ["VORLIQ_HOST"] = "127.0.0.1"
    os.environ["VORLIQ_PORT"] = str(port)
    os.environ["VORLIQ_NODE_URL"] = f"http://127.0.0.1:{port}"
    os.environ["VORLIQ_DATA_DIR"] = data_dir
    os.chdir(BLOCKCHAIN_DIR)
    sys.path.insert(0, str(BLOCKCHAIN_DIR))

    from app import app  # pylint: disable=import-outside-toplevel

    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)


class StressTest:
    def __init__(self) -> None:
        self.processes: dict[int, multiprocessing.Process] = {}
        self.wallets: list[dict[str, str]] = []
        self.passed = 0
        self.failed = 0

    def log(self, message: str) -> None:
        print(message, flush=True)

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        if condition:
            self.passed += 1
            self.log(f"PASS: {name}{f' - {detail}' if detail else ''}")
        else:
            self.failed += 1
            self.log(f"FAIL: {name}{f' - {detail}' if detail else ''}")

    def start_node(self, node_index: int) -> None:
        port = PORTS[node_index]
        data_dir = DATA_ROOT / f"node_{port}"
        data_dir.mkdir(parents=True, exist_ok=True)
        process = multiprocessing.Process(
            target=run_flask_node,
            args=(port, str(data_dir)),
            name=f"vorliq-node-{port}",
        )
        process.start()
        self.processes[node_index] = process
        self.log(f"Started node {node_index + 1} on port {port} with PID {process.pid}")

    def start_all_nodes(self) -> None:
        if DATA_ROOT.exists():
            shutil.rmtree(DATA_ROOT)
        DATA_ROOT.mkdir(parents=True, exist_ok=True)

        for index in range(len(PORTS)):
            self.start_node(index)

        self.log("Waiting five seconds for all nodes to boot...")
        time.sleep(5)
        self.wait_until_ready()

    def wait_until_ready(self) -> None:
        deadline = time.time() + 45
        for url in NODE_URLS:
            while time.time() < deadline:
                try:
                    response = requests.get(f"{url}/health", timeout=2)
                    if response.ok:
                        self.log(f"Node ready: {url}")
                        break
                except requests.RequestException:
                    time.sleep(0.5)
            else:
                raise RuntimeError(f"Node did not become ready: {url}")

    def stop_node(self, node_index: int) -> None:
        process = self.processes.get(node_index)
        if not process:
            return
        self.log(f"Stopping node {node_index + 1} abruptly")
        process.terminate()
        process.join(timeout=8)
        if process.is_alive():
            process.kill()
            process.join(timeout=4)

    def stop_all_nodes(self) -> None:
        for index in list(self.processes):
            self.stop_node(index)

    def request_json(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        response = requests.request(method, url, timeout=REQUEST_TIMEOUT, **kwargs)
        try:
            data = response.json()
        except ValueError:
            data = {"raw": response.text}
        if not response.ok:
            raise RuntimeError(f"{method} {url} returned {response.status_code}: {data}")
        return data

    def register_peers(self) -> None:
        self.log("Registering every node with every other node...")
        for source in NODE_URLS:
            for peer in NODE_URLS:
                if source == peer:
                    continue
                self.request_json("POST", f"{source}/peers/register", json={"peer": peer})

        peer_counts = []
        for url in NODE_URLS:
            peers = self.request_json("GET", f"{url}/peers").get("peers", [])
            peer_counts.append(len(peers))
            self.log(f"{url} peers: {peers}")

        self.check(
            "Every node has four peers",
            all(count == 4 for count in peer_counts),
            f"peer counts={peer_counts}",
        )

    def create_wallets(self) -> None:
        self.log("Creating one wallet on each node...")
        self.wallets = []
        for index, url in enumerate(NODE_URLS):
            wallet = self.request_json("POST", f"{url}/wallet")
            self.wallets.append(wallet)
            self.log(f"Node {index + 1} wallet: {wallet['address']}")

    def mine(self, node_index: int, wallet_index: int | None = None) -> dict[str, Any]:
        wallet_index = node_index if wallet_index is None else wallet_index
        miner_address = self.wallets[wallet_index]["address"]
        result = self.request_json("POST", f"{NODE_URLS[node_index]}/mine", json={"miner_address": miner_address})
        block = result["block"]
        self.log(f"Node {node_index + 1} mined block #{block['index']} {block['hash']}")
        return block

    def sync_all(self, active_urls: list[str] | None = None) -> None:
        urls = active_urls or NODE_URLS
        for url in urls:
            try:
                result = self.request_json("GET", f"{url}/peers/sync")
                self.log(f"Sync {url}: updated={result.get('updated')} height={result.get('chain_height')}")
            except Exception as exc:
                self.log(f"Sync failed for {url}: {exc}")

    def chain_lengths(self, urls: list[str] | None = None) -> list[int]:
        return [len(self.request_json("GET", f"{url}/chain").get("chain", [])) for url in (urls or NODE_URLS)]

    def chain_heights(self, urls: list[str] | None = None) -> list[int]:
        return [length - 1 for length in self.chain_lengths(urls)]

    def fund_wallets(self) -> None:
        self.log("Mining initial funding blocks.")
        self.mine(0, 0)
        self.sync_all()
        first_lengths = self.chain_lengths()
        self.check(
            "Initial node-one block reached every node",
            all(length == 2 for length in first_lengths),
            f"chain lengths={first_lengths}",
        )

        self.mine(0, 0)
        self.sync_all()
        self.mine(1, 1)
        self.sync_all()
        self.mine(1, 1)
        self.sync_all()

        lengths = self.chain_lengths()
        self.check(
            "All nodes agree after node-one and node-two funding blocks",
            len(set(lengths)) == 1,
            f"chain lengths={lengths}",
        )

    def import_blockchain_core(self):
        sys.path.insert(0, str(BLOCKCHAIN_DIR))
        from transaction import Transaction  # pylint: disable=import-outside-toplevel
        from wallet import Wallet  # pylint: disable=import-outside-toplevel

        return Transaction, Wallet

    def signed_transaction(
        self,
        sender_wallet: dict[str, str],
        receiver_address: str,
        amount: float,
    ) -> dict[str, Any]:
        Transaction, Wallet = self.import_blockchain_core()
        wallet = Wallet.from_private_key_pem(sender_wallet["private_key"])
        transaction = Transaction(wallet.address, receiver_address, amount)
        transaction.sign_transaction(wallet)
        return transaction.to_dict()

    def pending_user_counts(self) -> list[int]:
        counts = []
        for url in NODE_URLS:
            pending = self.request_json("GET", f"{url}/pending").get("pending_transactions", [])
            user_pending = [tx for tx in pending if tx.get("sender_address") != "SYSTEM"]
            counts.append(len(user_pending))
        return counts

    def submit_ten_transactions(self) -> list[str]:
        self.log("Submitting ten signed 5 VLQ transactions from node one wallet to node two wallet...")
        signatures = []
        for index in range(10):
            transaction = self.signed_transaction(
                self.wallets[0],
                self.wallets[1]["address"],
                5,
            )
            signatures.append(transaction["signature"])
            self.request_json("POST", f"{NODE_URLS[0]}/transaction", json=transaction)
            self.log(f"Submitted transaction {index + 1}: {transaction['signature'][:24]}...")

        time.sleep(2)
        counts = self.pending_user_counts()
        self.check(
            "All nodes received ten user pending transactions",
            all(count == 10 for count in counts),
            f"user pending counts={counts}",
        )
        return signatures

    def block_contains_signatures(self, chain: list[dict[str, Any]], signatures: list[str]) -> bool:
        signature_set = set(signatures)
        for block in chain:
            block_signatures = {
                tx.get("signature")
                for tx in block.get("transactions", [])
                if tx.get("sender_address") != "SYSTEM"
            }
            if signature_set.issubset(block_signatures):
                return True
        return False

    def confirm_ten_transactions(self, signatures: list[str]) -> None:
        self.log("Mining node three to confirm the ten transactions.")
        self.mine(2, 2)
        self.sync_all()

        heights = self.chain_heights()
        self.check(
            "All nodes agree on block height after transaction confirmation",
            len(set(heights)) == 1,
            f"block heights={heights}",
        )

        contains_all = []
        for url in NODE_URLS:
            chain = self.request_json("GET", f"{url}/chain").get("chain", [])
            contains_all.append(self.block_contains_signatures(chain, signatures))

        self.check(
            "The confirmed block contains all ten user transactions on every node",
            all(contains_all),
            f"contains_all={contains_all}",
        )

    def simulate_partition(self) -> None:
        self.log("Simulating network partition by stopping node four and node five.")
        self.stop_node(3)
        self.stop_node(4)
        active_urls = NODE_URLS[:3]
        time.sleep(2)

        self.mine(0, 0)
        self.mine(0, 0)
        self.mine(0, 0)
        self.sync_all(active_urls)
        active_height = self.chain_heights(active_urls)[0]
        self.log(f"Active partition height after three node-one blocks: {active_height}")

        self.log("Restarting node four and node five.")
        self.start_node(3)
        self.start_node(4)
        time.sleep(5)
        self.wait_until_ready()
        self.sync_all()
        time.sleep(1)
        self.sync_all()

        heights = self.chain_heights()
        self.check(
            "Restarted nodes adopted the longer chain after partition recovery",
            len(set(heights)) == 1 and heights[3] == active_height and heights[4] == active_height,
            f"block heights={heights}",
        )

    def double_spend_attempt(self) -> None:
        self.log("Running double spend attempt from node two wallet.")
        node_two_balance = self.request_json(
            "GET",
            f"{NODE_URLS[0]}/balance",
            params={"address": self.wallets[1]["address"]},
        )["balance"]
        if node_two_balance > 50:
            amount_to_move = node_two_balance - 50
            self.log(
                f"Normalizing node two wallet from {node_two_balance} VLQ to 50 VLQ "
                f"by moving {amount_to_move} VLQ back to node one before the double-spend test."
            )
            normalization_tx = self.signed_transaction(
                self.wallets[1],
                self.wallets[0]["address"],
                amount_to_move,
            )
            self.request_json("POST", f"{NODE_URLS[0]}/transaction", json=normalization_tx)
            time.sleep(1)
            self.mine(0, 0)
            self.sync_all()

        tx_one = self.signed_transaction(self.wallets[1], self.wallets[2]["address"], 50)
        tx_two = self.signed_transaction(self.wallets[1], self.wallets[3]["address"], 50)

        self.request_json("POST", f"{NODE_URLS[0]}/transaction", json=tx_one)
        second_rejected = False
        try:
            self.request_json("POST", f"{NODE_URLS[1]}/transaction", json=tx_two)
        except Exception as exc:
            second_rejected = True
            self.log(f"Second conflicting transaction rejected before mining: {exc}")

        self.mine(0, 0)
        self.sync_all()

        confirmed = 0
        for transaction in self.all_confirmed_transactions(NODE_URLS[0]):
            if transaction.get("signature") in {tx_one["signature"], tx_two["signature"]}:
                confirmed += 1

        self.check(
            "Double spend attempt confirmed only one conflicting transaction",
            confirmed == 1 and second_rejected,
            f"confirmed_conflicts={confirmed}, second_rejected={second_rejected}",
        )

    def all_confirmed_transactions(self, url: str) -> list[dict[str, Any]]:
        chain = self.request_json("GET", f"{url}/chain").get("chain", [])
        return [tx for block in chain for tx in block.get("transactions", [])]

    def print_final_state(self) -> None:
        state = {}
        for index, url in enumerate(NODE_URLS, start=1):
            state[f"node_{index}"] = self.request_json("GET", f"{url}/chain")
        self.log("FINAL_CHAIN_STATE_JSON:")
        self.log(json.dumps(state, indent=2, sort_keys=True))

    def run(self) -> None:
        try:
            self.start_all_nodes()
            self.register_peers()
            self.create_wallets()
            self.fund_wallets()
            signatures = self.submit_ten_transactions()
            self.confirm_ten_transactions(signatures)
            self.simulate_partition()
            self.double_spend_attempt()
            self.print_final_state()
        finally:
            self.stop_all_nodes()
            self.log(f"FINAL SUMMARY: {self.passed} passed, {self.failed} failed, {self.passed + self.failed} total checks")


def main() -> int:
    multiprocessing.set_start_method("spawn", force=True)
    stress_test = StressTest()
    try:
        stress_test.run()
    except Exception as exc:
        stress_test.failed += 1
        stress_test.log(f"FATAL: {exc}")
        stress_test.stop_all_nodes()
        stress_test.log(
            f"FINAL SUMMARY: {stress_test.passed} passed, {stress_test.failed} failed, "
            f"{stress_test.passed + stress_test.failed} total checks"
        )
        return 1

    return 0 if stress_test.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
