"""Manual verification for the stuck-transaction incident fix.

Proves two things against the running Flask core:
  1. A LONE miner can keep the chain alive — it is blocked from mining a
     consecutive block only within the anti-monopoly window, then allowed again
     (the old code blocked it forever, halting the chain).
  2. A real signed send moves from pending to confirmed once a block is mined.
"""
from __future__ import annotations

import json
import time
import urllib.request

from wallet import Wallet
from transaction import Transaction

FLASK = "http://127.0.0.1:5001"


def post(path, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(f"{FLASK}{path}", data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return json.loads(error.read().decode("utf-8"))


def get(path):
    with urllib.request.urlopen(f"{FLASK}{path}", timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def mine(address):
    return post("/mine", {"miner_address": address})


def faucet_summary_treasury():
    return float(get("/faucet/summary").get("summary", {}).get("treasury_balance") or 0)


# --- 1. Lone-miner liveness ---------------------------------------------------
lone = Wallet().address
first = mine(lone)
assert first.get("success") is not False, first
blocked = mine(lone)  # immediately again, inside the cooldown window
assert "wait" in str(blocked.get("message", "")).lower(), ("expected a cooldown wait, got", blocked)
print(f"[1] cooldown enforced as expected: {blocked.get('message')}")
time.sleep(5)  # exceed the ~4s gap (2 x block-time-min of 2s)
again = mine(lone)
assert again.get("success") is not False, ("LONE MINER STILL BLOCKED AFTER GAP", again)
print(f"[1] LIVENESS OK: the lone miner mined a consecutive block #{again['block']['index']}")

# --- 2. A real signed send goes pending -> confirmed --------------------------
def mine_spaced():
    # A fresh miner each time, so only the 2s block-time spacing applies (never
    # the same-miner cooldown), keeping this setup helper simple.
    time.sleep(2.6)
    return mine(Wallet().address)


for _ in range(12):  # fund the treasury
    if faucet_summary_treasury() >= 15:
        break
    mine_spaced()

sender = Wallet()
faucet = post("/faucet/claim", {"wallet_address": sender.address})
assert faucet.get("success"), ("faucet claim failed", faucet)
mine_spaced()  # confirm the faucet credit so the sender has spendable VLQ
balance = float(get(f"/balance?address={sender.address}").get("balance") or 0)
assert balance > 0, ("sender was not funded", balance)
print(f"[2] sender funded with {balance} VLQ")

receiver = Wallet()
transaction = Transaction(sender_address=sender.address, receiver_address=receiver.address, amount=0.5)
sender.sign_transaction(transaction)
submitted = post("/transaction", transaction.to_dict())
assert submitted.get("success"), ("send submission failed", submitted)
tx_id = submitted["transaction"]["tx_id"]
detail = get(f"/transactions/{tx_id}")
assert (detail.get("transaction") or {}).get("status") == "pending", ("expected pending", detail)
print(f"[2] send {tx_id[:12]}… submitted and is PENDING")

mine_spaced()  # one mining cycle confirms it
confirmed = get(f"/transactions/{tx_id}").get("transaction") or {}
assert confirmed.get("status") == "confirmed" and confirmed.get("block_index") is not None, ("NOT CONFIRMED", confirmed)
print(f"[2] CONFIRMED OK: send {tx_id[:12]}… is in block #{confirmed['block_index']}")
assert float(get(f"/balance?address={receiver.address}").get("balance") or 0) == 0.5
print("INCIDENT FIX VERIFIED: lone-miner liveness + pending->confirmed send.")
