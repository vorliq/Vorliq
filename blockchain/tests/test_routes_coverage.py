"""Flask route-layer behaviour coverage.

Exercises the public read routes (they must answer a well-formed request without a
server error), the auth-gated admin routes (they must refuse an unauthenticated
caller rather than act), and representative write routes (malformed input must be a
client error, never a 500, and a missing resource must be a clean 404). This drives
the app.py route layer through its observable interface only — no consensus code is
touched and no implementation internals are asserted.
"""

import copy
import os
import time
import unittest
from unittest.mock import patch

import app as app_module
from app import app
from signed_authorization import AUTHORITY_ROUTES, authorization_message, body_hash, AUTHORIZATION_DOMAIN
from transaction import SYSTEM_ADDRESS, TREASURY_ADDRESS, Transaction
from wallet import Wallet


client = app.test_client()

# Admin-gated routes compare a Bearer token against the ADMIN_TOKEN env var; the
# success-path tests patch this value into the environment for their duration.
ADMIN_TOKEN = "route-coverage-admin-token"
ADMIN_HEADERS = {"Authorization": f"Bearer {ADMIN_TOKEN}"}

_MISSING = object()

# Module ledgers a write route may touch. Restored in place (data attributes only,
# never the threading lock) so a success-path test cannot leak into another test.
_SNAPSHOT_GLOBALS = [
    "lending_pool", "exchange", "treasury", "governance", "forum", "faucet",
    "profiles", "achievements", "node_registry", "notifications",
]

# After a success-path test restores the in-memory state, the restored state is
# written back to disk through these savers so a mined block or created ledger
# entry can never leak into the data directory a later test session loads from.
_LEDGER_SAVERS = {
    "lending_pool": "save_lending_pool",
    "exchange": "save_exchange",
    "treasury": "save_treasury",
    "governance": "save_governance",
    "forum": "save_forum",
    "faucet": "save_faucet",
    "profiles": "save_profiles",
    "achievements": "save_achievements",
    "node_registry": "save_registry",
    "notifications": "save_notifications",
}


def _snapshot_obj(obj):
    """Deep-copy an object's data attributes, skipping unpicklable ones (locks)
    and the blockchain back-reference (an identity that must never be replaced
    by a copy — the ledger must keep pointing at the live node chain)."""
    snap = {}
    for key, value in list(vars(obj).items()):
        if "lock" in key.lower() or key == "blockchain":
            continue
        try:
            snap[key] = copy.deepcopy(value)
        except Exception:
            pass
    return snap


def _restore_obj(obj, snapshot):
    for key, value in snapshot.items():
        setattr(obj, key, value)


def signed_body(action, actor_field, payload=None, *, wallet=None):
    """Build a validly-signed authority envelope so a request reaches the route's
    business logic rather than stopping at the signature gate."""
    signer = wallet or Wallet()
    body = dict(payload or {})
    body[actor_field] = signer.address
    digest = body_hash(body)
    created_at = int(time.time())
    nonce_value = f"nonce-{time.time_ns()}"
    message = authorization_message(
        action=action, body_hash_value=digest, nonce=nonce_value, timestamp=created_at, wallet=signer.address
    )
    body["authorization"] = {
        "wallet": signer.address,
        "public_key": signer.public_key_pem(),
        "signature": signer.sign(message),
        "message": message,
        "timestamp": created_at,
        "nonce": nonce_value,
        "action": action,
        "body_hash": digest,
        "domain": AUTHORIZATION_DOMAIN,
    }
    return body


# Minimal payloads that pass the signature gate but reference missing resources or
# omit required fields, so each handler runs its validation path and returns a
# clean client error (400/404/503) without creating or mutating any state.
AUTHORITY_PAYLOADS = {
    # Minimal / missing-resource payloads: they clear the signature gate and run the
    # handler's validation, then fail on empty fields or a missing resource, so
    # nothing is ever created or mutated. Success paths are exercised separately in
    # SuccessPathRouteTests, which snapshots and restores all shared state.
    "/governance/propose": {},
    "/governance/vote": {"proposal_id": "missing-proposal", "vote": "yes"},
    "/governance/cancel": {"proposal_id": "missing-proposal"},
    "/treasury/propose": {},
    "/treasury/vote": {"proposal_id": "missing-proposal", "vote": "yes"},
    "/treasury/cancel": {"proposal_id": "missing-proposal"},
    "/lending/request": {},
    "/lending/vote": {"loan_id": "missing-loan", "vote": "yes"},
    "/lending/repay": {"loan_id": "missing-loan"},
    "/registry/verify-operator": {"node_url": "https://missing.example.org", "release": False},
    "/exchange/offer": {},
    "/exchange/accept": {"offer_id": "missing-offer"},
    "/exchange/complete": {"offer_id": "missing-offer"},
    "/exchange/confirm-complete": {"offer_id": "missing-offer"},
    "/exchange/record-vlq-tx": {"offer_id": "missing-offer", "tx_id": "missing-tx"},
    "/exchange/dispute": {"offer_id": "missing-offer", "reason": "not received"},
    "/exchange/cancel": {"offer_id": "missing-offer"},
    "/notifications/preferences": {"in_app_enabled": True, "wanted": False},
}

# Read routes that must handle a well-formed request without a 5xx. Params are
# supplied where a route requires them so the handler runs its real path rather
# than a missing-arg guard.
READ_ROUTES = [
    "/health", "/storage/health", "/indexes/health",
    "/chain", "/chain/summary", "/chain/prune-info", "/chain/blocks?limit=5&offset=0",
    "/chain/address?address=VLQ_SAMPLE_ADDRESS", "/chain/block/0",
    "/pending", "/transactions/pending", "/transactions?status=confirmed&limit=5",
    "/mining/status", "/mining/history",
    "/balance?address=VLQ_SAMPLE_ADDRESS",
    "/economics", "/economics/overview", "/diagnostics",
    "/reports/weekly", "/api/reports/weekly",
    "/audit/chain", "/audit/treasury", "/audit/governance", "/audit/lending",
    "/audit/exchange", "/audit/registry",
    "/treasury/balance", "/treasury/summary", "/treasury/transparency",
    "/treasury/proposals", "/treasury/all", "/treasury/my?address=VLQ_SAMPLE_ADDRESS",
    "/treasury/ledger",
    "/faucet/summary", "/faucet/claims?address=VLQ_SAMPLE_ADDRESS", "/faucet/recent",
    "/price/signals", "/price/median?currency=USD",
    "/achievements?address=VLQ_SAMPLE_ADDRESS", "/achievements/all",
    "/profiles/profile?address=VLQ_SAMPLE_ADDRESS", "/profiles",
    "/profiles/search?q=a", "/profiles/top",
    "/peers", "/peers/sync", "/peers/propagation/status", "/peers/propagation/events",
    "/registry/nodes", "/registry/all", "/registry/summary", "/registry/lifecycle",
    "/registry/node?node_url=https://node.example.org",
    "/lending/loans", "/lending/summary", "/lending/my?address=VLQ_SAMPLE_ADDRESS",
    "/exchange/offers", "/exchange/all", "/exchange/summary",
    "/exchange/my?address=VLQ_SAMPLE_ADDRESS",
    "/forum/posts", "/forum/featured", "/forum/search?q=a",
    "/governance/proposals", "/governance/all", "/governance/summary",
    "/governance/my?address=VLQ_SAMPLE_ADDRESS", "/governance/settings",
    "/governance/rule-changes", "/governance/settings/history",
    "/notifications/preferences?wallet_address=VLQ_SAMPLE_ADDRESS",
    "/notifications/digest-recipients",
    "/leaderboard", "/community/stats", "/analytics/usage",
    "/admin/peers/propagation",
    "/transactions?status=pending",
    "/transactions?address=VLQ_SAMPLE_ADDRESS&type=transfer",
    "/transactions/pending?address=VLQ_SAMPLE_ADDRESS",
    "/mining/history?limit=2&offset=1",
    "/peers/propagation/events?status=accepted&type=block",
    "/profiles/top?limit=3",
]

# Missing-resource reads must be a clean 404 (never a 500 or silently-wrong 200).
NOT_FOUND_ROUTES = [
    "/transactions/nonexistent-tx-id",
    "/chain/block/999999999",
    "/treasury/proposal?proposal_id=nope",
    "/lending/loan?loan_id=nope",
    "/exchange/offer?offer_id=nope",
    "/forum/post?post_id=nope",
    "/governance/proposal?proposal_id=nope",
]

# Admin/operator routes must refuse an unauthenticated caller (401/403), not act.
ADMIN_ROUTES = [
    ("post", "/admin/chain/prune"),
    ("post", "/registry/admin/archive"),
    ("post", "/registry/admin/restore"),
    ("post", "/registry/admin/retire"),
    ("post", "/registry/admin/probe-sweep"),
    ("get", "/forum/admin/posts"),
    ("post", "/forum/admin/pin"),
    ("post", "/forum/admin/feature"),
    ("post", "/forum/admin/moderate"),
]

# Write routes: malformed/empty input must produce a handled response, never an
# unhandled 500 crash. (Some return 400/401/403, some a deliberate 503 when the
# signed-authority envelope is absent; none should surface a traceback.)
INVALID_WRITE_ROUTES = [
    "/transaction",
    "/mine",
    "/price/signal",
    "/forum/post",
    "/forum/reply",
    "/forum/upvote",
    "/forum/feature",
    "/governance/propose",
    "/lending/request",
    "/exchange/offer",
    "/treasury/propose",
    "/profiles/profile",
    "/profiles/verify/challenge",
    "/profiles/verify/submit",
    "/faucet/claim",
    "/faucet/referral-bonus",
    "/registry/register",
    "/peers/register",
    "/peers/announce",
    "/peer/transaction",
    "/peer/block",
]


class ReadRouteTests(unittest.TestCase):
    def test_read_routes_never_server_error(self):
        for route in READ_ROUTES:
            with self.subTest(route=route):
                response = client.get(route)
                self.assertLess(
                    response.status_code, 500,
                    f"{route} returned a server error: {response.status_code}",
                )

    def test_missing_resources_are_clean_404s(self):
        for route in NOT_FOUND_ROUTES:
            with self.subTest(route=route):
                response = client.get(route)
                self.assertIn(response.status_code, (400, 404), f"{route} -> {response.status_code}")


class BadRequestTests(unittest.TestCase):
    """Malformed query parameters and bodies must come back as clean 400s."""

    def test_invalid_pagination_is_a_client_error(self):
        for route in [
            "/chain/blocks?limit=abc",
            "/chain/blocks?limit=0",
            "/chain/blocks?offset=-1",
            "/transactions?limit=abc",
            "/forum/posts?limit=-2",
            "/peers/propagation/events?limit=abc",
        ]:
            with self.subTest(route=route):
                self.assertEqual(client.get(route).status_code, 400)

    def test_invalid_filters_are_a_client_error(self):
        for route in [
            "/peers/propagation/events?status=bogus",
            "/peers/propagation/events?type=bogus",
        ]:
            with self.subTest(route=route):
                self.assertEqual(client.get(route).status_code, 400)

    def test_missing_required_query_params_are_a_client_error(self):
        for route in ["/chain/address", "/profiles/search", "/lending/my", "/balance"]:
            with self.subTest(route=route):
                self.assertEqual(client.get(route).status_code, 400)

    def test_non_dict_json_body_is_a_client_error(self):
        for route in ["/forum/post", "/forum/reply", "/peers/register"]:
            with self.subTest(route=route):
                response = client.post(route, json=[1, 2, 3])
                self.assertEqual(response.status_code, 400)


class AuthGateTests(unittest.TestCase):
    def test_admin_routes_reject_unauthenticated_callers(self):
        for method, route in ADMIN_ROUTES:
            with self.subTest(route=route):
                call = client.get if method == "get" else client.post
                response = call(route, json={})
                self.assertIn(
                    response.status_code, (401, 403),
                    f"{method.upper()} {route} should require auth, got {response.status_code}",
                )


class InvalidInputTests(unittest.TestCase):
    def test_write_routes_handle_empty_body_without_crashing(self):
        for route in INVALID_WRITE_ROUTES:
            with self.subTest(route=route):
                response = client.post(route, json={})
                # A handled response (never an unhandled 500 traceback) and never a
                # silent success on empty input.
                self.assertNotEqual(response.status_code, 500, f"{route} -> {response.status_code}")
                self.assertGreaterEqual(response.status_code, 400, f"{route} -> {response.status_code}")

    def test_write_routes_handle_non_json_body_without_crashing(self):
        for route in INVALID_WRITE_ROUTES:
            with self.subTest(route=route):
                response = client.post(route, data="not json", content_type="text/plain")
                self.assertNotEqual(response.status_code, 500, f"{route} -> {response.status_code}")


class SignedAuthorityRouteTests(unittest.TestCase):
    """A validly-signed request must clear the signature gate and reach each route's
    business validation, which returns a clean client error for the missing/empty
    resources used here — never a 500 and never the SIGNED_AUTHORIZATION_REQUIRED
    gate (which would mean the signature was not accepted)."""

    def test_signed_requests_reach_business_validation(self):
        for route, (action, actor_fields) in AUTHORITY_ROUTES.items():
            with self.subTest(route=route):
                actor_field = actor_fields[0] if isinstance(actor_fields, tuple) else actor_fields
                payload = AUTHORITY_PAYLOADS.get(route, {})
                body = signed_body(action, actor_field, payload)
                response = client.post(route, json=body)
                self.assertNotEqual(response.status_code, 500, f"{route} -> {response.status_code}")
                # It cleared the signature gate (not the 503 SIGNED_AUTHORIZATION_REQUIRED
                # refusal that an unsigned request gets). The error field may be a plain
                # string (business validation) or a dict with a code (envelope errors).
                data = response.get_json(silent=True) or {}
                error = data.get("error")
                code = error.get("code") if isinstance(error, dict) else None
                self.assertNotEqual(code, "SIGNED_AUTHORIZATION_REQUIRED", f"{route} signature not accepted")


class SuccessPathRouteTests(unittest.TestCase):
    """Valid write requests exercising each handler's happy path. The chain, pending
    pool and every touched ledger are snapshotted in setUp and restored in tearDown
    (in place, preserving locks), so a mined block or created loan/offer cannot leak
    into any other test."""

    def setUp(self):
        bc = app_module.node.blockchain
        self._chain = list(bc.chain)
        self._pending = list(bc.pending_transactions)
        self._prune = bc.prune_point
        self._snaps = {}
        for name in _SNAPSHOT_GLOBALS:
            obj = getattr(app_module, name, None)
            if obj is not None:
                self._snaps[name] = (obj, _snapshot_obj(obj))
        # Ledgers hold a back-reference to the chain they issue transactions on
        # (app.py binds it at import). If an earlier test module swapped
        # node.blockchain, that reference is stale and a loan issuance would be
        # queued on a chain nobody mines — realign it with the live chain.
        self._ledger_chains = {}
        for name in ("lending_pool", "treasury"):
            ledger = getattr(app_module, name, None)
            if ledger is not None and hasattr(ledger, "blockchain"):
                self._ledger_chains[name] = ledger.blockchain
                ledger.blockchain = bc
        # Shadow the block-spacing rules and difficulty on THIS INSTANCE only so a
        # flow test can mine several funding blocks back-to-back. Every block mined
        # under the relaxed rules is discarded by tearDown (in memory AND on disk),
        # so no block that would fail production validation can ever persist.
        self._attr_snaps = {}
        for name, value in {"BLOCK_TIME_MINIMUM": 0, "SAME_MINER_MIN_GAP": 0, "difficulty": 1}.items():
            self._attr_snaps[name] = bc.__dict__.get(name, _MISSING)
            setattr(bc, name, value)
        env = patch.dict(os.environ, {
            "VORLIQ_DISABLE_DIFFICULTY_ADJUSTMENT": "true",
            "ADMIN_TOKEN": ADMIN_TOKEN,
            "VORLIQ_ENABLE_TEST_SEED": "true",
        })
        env.start()
        self.addCleanup(env.stop)
        # Peer broadcasts would try real HTTP calls to any registered node; the
        # broadcast layer has its own tests, so silence it here.
        for broadcast in ("broadcast_transaction", "broadcast_block"):
            if hasattr(app_module.peer_propagation, broadcast):
                patcher = patch.object(app_module.peer_propagation, broadcast, lambda *a, **k: None)
                patcher.start()
                self.addCleanup(patcher.stop)

    def tearDown(self):
        bc = app_module.node.blockchain
        bc.chain = self._chain
        bc.pending_transactions = self._pending
        bc.prune_point = self._prune
        for name, snapshot in self._attr_snaps.items():
            if snapshot is _MISSING:
                bc.__dict__.pop(name, None)
            else:
                setattr(bc, name, snapshot)
        bc._valid_cache = None
        bc._valid_cache_height = -1
        bc._valid_cache_tip = None
        bc._indexes = None
        bc.rebuild_indexes()
        for _name, (obj, snapshot) in self._snaps.items():
            _restore_obj(obj, snapshot)
        for name, original_chain in self._ledger_chains.items():
            getattr(app_module, name).blockchain = original_chain
        # The handlers persisted mid-test state to the data directory; write the
        # restored state back so the next test session starts from a clean chain
        # and ledgers (a relaxed-timing block on disk would fail the next startup
        # validation).
        storage = app_module.storage
        storage.save_chain(bc)
        storage.save_pending(bc.pending_transactions)
        for global_name, saver_name in _LEDGER_SAVERS.items():
            ledger = getattr(app_module, global_name, None)
            saver = getattr(storage, saver_name, None)
            if ledger is not None and saver is not None:
                saver(ledger)
        app_module._rebuild_indexes(save=True, force=True)

    def _mine(self, miner_address=None):
        """Mine one block through the /mine route and return it."""
        miner = miner_address or Wallet().address
        with patch.object(app_module, "mining_enabled", return_value=True):
            response = client.post("/mine", json={"miner_address": miner})
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        return response.get_json()["block"]

    def _fund(self, *credits):
        """Credit (address, amount) pairs via SYSTEM transactions and mine them."""
        bc = app_module.node.blockchain
        for address, amount in credits:
            bc.add_pending_transaction(Transaction(SYSTEM_ADDRESS, address, amount))
        self._mine()

    def test_mine_produces_a_block(self):
        # Mining is disabled by default on a node; enable it just for this request so
        # the real mine + persist path runs (restored to the snapshot afterwards).
        miner_address = Wallet().address  # a valid base58 Vorliq address
        with patch.object(app_module, "mining_enabled", return_value=True):
            response = client.post("/mine", json={"miner_address": miner_address})
        self.assertIn(response.status_code, (200, 201), response.get_data(as_text=True)[:200])

    def test_registry_register_accepts_public_metadata(self):
        response = client.post(
            "/registry/register",
            json={"node_url": "https://newnode.example.org", "display_name": "Test Node", "region": "Europe"},
        )
        self.assertLess(response.status_code, 500)

    def test_lending_request_can_be_created(self):
        body = signed_body(
            "lending.request", "requester_address",
            {"amount": 10, "reason": "A community mining rig", "repayment_amount": 11, "duration_blocks": 500},
        )
        response = client.post("/lending/request", json=body)
        self.assertLess(response.status_code, 500)

    def test_exchange_offer_can_be_created(self):
        body = signed_body(
            "exchange.offer", "creator_address",
            {"offer_type": "buy", "amount": 10, "price": "5 USD", "description": "Buying VLQ"},
        )
        response = client.post("/exchange/offer", json=body)
        self.assertLess(response.status_code, 500)

    def test_wallet_route_creates_a_wallet(self):
        response = client.post("/wallet", json={})
        self.assertEqual(response.status_code, 201)
        data = response.get_json()
        self.assertTrue(data.get("address"))
        self.assertIn("private_key_warning", data)

    def test_mining_status_reports_both_enabled_states(self):
        for enabled in (True, False):
            with self.subTest(enabled=enabled):
                with patch.object(app_module, "mining_enabled", return_value=enabled):
                    response = client.get("/mining/status")
                self.assertEqual(response.status_code, 200)
                data = response.get_json()
                self.assertTrue(data["success"])
                if not enabled:
                    self.assertFalse(data["status"]["can_mine_now"])

    def test_mining_cooldown_is_a_clean_429(self):
        # A freshly-mined tip plus an enormous minimum spacing forces the cooldown
        # branch instead of a successful mine.
        self._mine()
        app_module.node.blockchain.BLOCK_TIME_MINIMUM = 10**6
        with patch.object(app_module, "mining_enabled", return_value=True):
            response = client.post("/mine", json={"miner_address": Wallet().address})
        self.assertEqual(response.status_code, 429)
        self.assertIn("wait_seconds", response.get_json())

    def test_admin_prune_route_and_indexes_rebuild(self):
        # Default body: keep target far above the chain height, so nothing prunes.
        response = client.post("/admin/chain/prune", headers=ADMIN_HEADERS, json={})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])
        # Invalid depth is a clean 400.
        response = client.post("/admin/chain/prune", headers=ADMIN_HEADERS, json={"keep_blocks": "abc"})
        self.assertEqual(response.status_code, 400)
        # A real prune down to one retained block (chain and disk state are fully
        # restored by tearDown).
        self._mine()
        response = client.post("/admin/chain/prune", headers=ADMIN_HEADERS, json={"keep_blocks": 1})
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertTrue(data.get("pruned"))
        response = client.post("/indexes/rebuild", json={})
        self.assertEqual(response.status_code, 200)

    def test_transaction_lifecycle_from_submit_to_confirmed(self):
        sender, receiver = Wallet(), Wallet()
        self._fund((sender.address, 100))
        transaction = Transaction(sender.address, receiver.address, 10)
        transaction.sign_transaction(sender)
        response = client.post("/transaction", json=transaction.to_dict())
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        tx_id = response.get_json()["tx_id"]
        detail = client.get(f"/transactions/{tx_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.get_json()["transaction"]["status"], "pending")
        self._mine()
        detail = client.get(f"/transactions/{tx_id}")
        self.assertEqual(detail.get_json()["transaction"]["status"], "confirmed")
        listing = client.get(f"/transactions?address={sender.address}&status=confirmed&type=transfer")
        self.assertEqual(listing.status_code, 200)
        self.assertTrue(listing.get_json()["success"])

    def test_faucet_claim_rate_limit_and_referral_bonus(self):
        self._fund((TREASURY_ADDRESS, 100000))
        claimer, referrer = Wallet(), Wallet()
        response = client.post(
            "/faucet/claim",
            json={"wallet_address": claimer.address, "fingerprint_hash": "ab" * 32},
        )
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        self.assertTrue(response.get_json()["success"])
        # An immediate second claim from the same wallet hits the cooldown.
        response = client.post("/faucet/claim", json={"wallet_address": claimer.address})
        self.assertEqual(response.status_code, 429)
        response = client.post(
            "/faucet/referral-bonus",
            json={"referrer_address": referrer.address, "referred_address": claimer.address},
        )
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        # Self-referral is refused.
        response = client.post(
            "/faucet/referral-bonus",
            json={"referrer_address": referrer.address, "referred_address": referrer.address},
        )
        self.assertEqual(response.status_code, 400)

    def test_governance_proposal_and_vote(self):
        proposer, voter = Wallet(), Wallet()
        self._fund((proposer.address, 200), (voter.address, 200))
        body = signed_body(
            "governance.propose", "proposer_address",
            {
                "title": "Route coverage proposal",
                "description": "A proposal created by the route coverage tests.",
                "category": "general",
                "parameter": "community-note",
            },
            wallet=proposer,
        )
        response = client.post("/governance/propose", json=body)
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        proposal_id = response.get_json()["proposal_id"]
        vote = signed_body(
            "governance.vote", "voter_address",
            {"proposal_id": proposal_id, "vote": "yes"},
            wallet=voter,
        )
        response = client.post("/governance/vote", json=vote)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        self.assertTrue(response.get_json()["success"])

    def test_lending_full_lifecycle(self):
        response = client.post("/test/seed-lending-pool", json={"amount": 1000})
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        requester, voter = Wallet(), Wallet()
        self._fund((requester.address, 500), (voter.address, 500))
        body = signed_body(
            "lending.request", "requester_address",
            {"amount": 100, "reason": "A community mining rig for the coverage tests."},
            wallet=requester,
        )
        response = client.post("/lending/request", json=body)
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        loan_id = response.get_json()["loan_id"]
        vote = signed_body(
            "lending.vote", "voter_address",
            {"loan_id": loan_id, "vote": "yes"},
            wallet=voter,
        )
        response = client.post("/lending/vote", json=vote)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        self.assertEqual(response.get_json()["loan"]["status"], "approved_pending_issue")
        # Mining confirms the issuance transaction; the loans read syncs statuses.
        self._mine()
        response = client.get("/lending/loans")
        self.assertEqual(response.status_code, 200)
        repay = signed_body("lending.repay", "repayer_address", {"loan_id": loan_id}, wallet=requester)
        response = client.post("/lending/repay", json=repay)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        self.assertIn("repayment_tx_id", response.get_json())

    def test_exchange_full_lifecycle(self):
        creator, acceptor = Wallet(), Wallet()
        self._fund((creator.address, 500), (acceptor.address, 500))
        offer_body = signed_body(
            "exchange.offer", "creator_address",
            {"offer_type": "sell", "amount": 10, "price": "5 USD", "description": "Selling VLQ for the coverage tests."},
            wallet=creator,
        )
        response = client.post("/exchange/offer", json=offer_body)
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        offer_id = response.get_json()["offer_id"]
        accept_body = signed_body("exchange.accept", "acceptor_address", {"offer_id": offer_id}, wallet=acceptor)
        response = client.post("/exchange/accept", json=accept_body)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        # The seller settles the VLQ side on-chain and records the confirmed tx.
        settlement = Transaction(creator.address, acceptor.address, 10)
        settlement.sign_transaction(creator)
        response = client.post("/transaction", json=settlement.to_dict())
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        self._mine()
        record_body = signed_body(
            "exchange.record_vlq_tx", "caller_address",
            {"offer_id": offer_id, "tx_id": settlement.tx_id},
            wallet=creator,
        )
        response = client.post("/exchange/record-vlq-tx", json=record_body)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        self.assertEqual(response.get_json()["offer"]["status"], "vlq_confirmed")
        # Both parties confirm; the second confirmation completes the trade.
        complete_body = signed_body("exchange.complete", "caller_address", {"offer_id": offer_id}, wallet=creator)
        response = client.post("/exchange/complete", json=complete_body)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        confirm_body = signed_body("exchange.confirm_complete", "caller_address", {"offer_id": offer_id}, wallet=acceptor)
        response = client.post("/exchange/confirm-complete", json=confirm_body)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        self.assertEqual(response.get_json()["offer"]["status"], "completed")

    def test_forum_post_lifecycle_and_moderation(self):
        author, replier, upvoter = Wallet(), Wallet(), Wallet()
        response = client.post(
            "/forum/post",
            json={
                "author_address": author.address,
                "title": "Coverage post",
                "body": "A post created by the route coverage tests.",
                "category": "general",
            },
        )
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        post_id = response.get_json()["post_id"]
        response = client.post(
            "/forum/reply",
            json={"post_id": post_id, "author_address": replier.address, "body": "A reply for the coverage tests."},
        )
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        reply_id = response.get_json()["reply"]["reply_id"]
        response = client.post("/forum/upvote", json={"post_id": post_id, "address": upvoter.address})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        response = client.post(
            "/forum/reply/upvote",
            json={"post_id": post_id, "reply_id": reply_id, "address": upvoter.address},
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        # Admin actions: pin, feature (string boolean), hide the reply, then check
        # the public view masks it while the admin view keeps it.
        response = client.post("/forum/admin/pin", headers=ADMIN_HEADERS, json={"post_id": post_id, "pinned": True})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        response = client.post("/forum/admin/feature", headers=ADMIN_HEADERS, json={"post_id": post_id, "featured": "true"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        response = client.post("/forum/admin/pin", headers=ADMIN_HEADERS, json={"post_id": post_id, "pinned": "not-a-bool"})
        self.assertEqual(response.status_code, 400)
        response = client.post(
            "/forum/admin/moderate",
            headers=ADMIN_HEADERS,
            json={"target_type": "reply", "post_id": post_id, "reply_id": reply_id, "status": "hidden", "reason": "test"},
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        response = client.post(
            "/forum/admin/moderate",
            headers=ADMIN_HEADERS,
            json={"target_type": "post", "post_id": post_id, "status": "visible"},
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        response = client.post(
            "/forum/admin/moderate",
            headers=ADMIN_HEADERS,
            json={"target_type": "post", "post_id": post_id, "status": "bogus"},
        )
        self.assertEqual(response.status_code, 400)
        public_view = client.get(f"/forum/post?post_id={post_id}").get_json()["post"]
        self.assertIn("hidden by community moderation", public_view["replies"][0]["body"])
        admin_view = client.get("/forum/admin/posts", headers=ADMIN_HEADERS)
        self.assertEqual(admin_view.status_code, 200)
        self.assertTrue(admin_view.get_json()["success"])

    def test_registry_lifecycle_heartbeat_claims_and_admin(self):
        node_url = "https://coverage-node.example.org"
        operator = Wallet()
        response = client.post(
            "/registry/register",
            json={"node_url": node_url, "display_name": "Coverage Node", "region": "Europe"},
        )
        self.assertLess(response.status_code, 400, response.get_data(as_text=True)[:300])
        response = client.post(
            "/registry/heartbeat",
            json={
                "node_url": node_url,
                "chain_height": 1,
                "chain_valid": "true",
                "snapshot_signature_verified": "verified",
                "latest_block_hash": "abc123",
                "display_name": "Coverage Node",
                "software_version": "1.0.0",
                "operator_wallet_address": operator.address,
                "response_time_ms": 12,
                "region": "Europe",
                "country": "DE",
            },
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        claim = signed_body(
            "registry.verify_operator", "operator_wallet_address",
            {"node_url": node_url, "release": False},
            wallet=operator,
        )
        response = client.post("/registry/verify-operator", json=claim)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        # Probe sweep with the network prober stubbed out (its own tests cover it).
        probe_stub = {
            "reachable": True,
            "chain_height": 1,
            "latest_block_hash": "abc123",
            "response_time_ms": 5,
            "operator_wallet_address": operator.address,
        }
        with patch.object(app_module.node_prober, "probe_node", return_value=probe_stub), \
                patch.object(app_module.node_prober, "compare_probe_to_claim", return_value=("verified", "")), \
                patch.object(app_module.node_prober, "compare_operator_claim", return_value=(True, "")):
            response = client.post("/registry/admin/probe-sweep", headers=ADMIN_HEADERS, json={})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        self.assertGreaterEqual(response.get_json()["summary"]["probed"], 1)
        release = signed_body(
            "registry.verify_operator", "operator_wallet_address",
            {"node_url": node_url, "release": True},
            wallet=operator,
        )
        response = client.post("/registry/verify-operator", json=release)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        for action in ("archive", "restore", "retire"):
            with self.subTest(action=action):
                response = client.post(
                    f"/registry/admin/{action}",
                    headers=ADMIN_HEADERS,
                    json={"node_url": node_url, "reason": f"Coverage {action}."},
                )
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])

    def test_peer_register_and_sync(self):
        peer_url = "https://peer-coverage.example.org"
        with patch.object(app_module.network, "announce_to_peers", lambda *a, **k: None), \
                patch.object(app_module.network, "discover_peers", lambda *a, **k: None):
            response = client.post("/peers/register", json={"peer": peer_url})
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True)[:300])
        self.addCleanup(lambda: (app_module.network.remove_peer(peer_url),
                                 app_module.storage.save_peers(app_module.network.peers)))
        with patch.object(app_module.network, "sync_chain", lambda bc: True), \
                patch.object(app_module.network, "check_peer_statuses", lambda: []):
            response = client.get("/peers/sync")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["updated"])

    def test_peer_block_duplicate_is_acknowledged(self):
        latest = app_module.node.blockchain.get_latest_block()
        response = client.post(
            "/peer/block",
            json={"block": latest.to_dict(), "source_node_url": "https://peer.example.org"},
        )
        data = response.get_json()
        self.assertTrue(data.get("success"), response.get_data(as_text=True)[:300])
        self.assertTrue(data.get("duplicate"))

    def test_profile_create_and_wallet_verification(self):
        wallet = Wallet()
        response = client.post(
            "/profiles/profile",
            json={"wallet_address": wallet.address, "display_name": "Coverage Tester"},
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        response = client.post("/profiles/verify/challenge", json={"address": wallet.address})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        message = response.get_json()["message"]
        submit = {
            "address": wallet.address,
            "public_key": wallet.public_key_pem(),
            "signature": wallet.sign(message),
            "message": message,
        }
        # Wrong message, mismatched key, bad signature: each is a clean 400.
        self.assertEqual(
            client.post("/profiles/verify/submit", json={**submit, "message": "wrong message"}).status_code, 400
        )
        other = Wallet()
        self.assertEqual(
            client.post(
                "/profiles/verify/submit",
                json={**submit, "public_key": other.public_key_pem(), "signature": other.sign(message)},
            ).status_code,
            400,
        )
        self.assertEqual(
            client.post("/profiles/verify/submit", json={**submit, "signature": "00ff"}).status_code, 400
        )
        response = client.post("/profiles/verify/submit", json=submit)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        self.assertTrue(response.get_json()["verified_wallet"])

    def test_notification_preferences_signed_set(self):
        wallet = Wallet()
        body = signed_body(
            "notifications.preferences", "wallet_address",
            {"email": "member@example.com", "events": {"loan_funded": True}},
            wallet=wallet,
        )
        response = client.post("/notifications/preferences", json=body)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True)[:300])
        bad = signed_body(
            "notifications.preferences", "wallet_address",
            {"email": "not-an-email", "events": {}},
            wallet=wallet,
        )
        response = client.post("/notifications/preferences", json=bad)
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
