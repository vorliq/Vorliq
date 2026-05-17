from types import SimpleNamespace

import pytest

from profiles import Profiles


class DummyAchievements:
    def get_achievements(self, wallet_address):
        return [
            {"id": "first_wallet", "title": "First Steps"},
            {"id": "first_vote", "title": "Voice of the Network"},
        ]


def test_profile_validation_rejects_unsafe_markup_and_bad_urls():
    profiles = Profiles()

    with pytest.raises(ValueError, match="display name"):
        profiles.create_or_update_profile("VLQ_TEST", {"display_name": "ab"})

    with pytest.raises(ValueError, match="unsafe markup"):
        profiles.create_or_update_profile("VLQ_TEST", {"display_name": "<script>alert(1)</script>"})

    with pytest.raises(ValueError, match="http or https"):
        profiles.create_or_update_profile("VLQ_TEST", {"display_name": "Valid Name", "website": "javascript:alert(1)"})


def test_create_and_update_profile_keeps_public_fields_only():
    profiles = Profiles()

    created = profiles.create_or_update_profile(
        "VLQ_MEMBER",
        {
            "display_name": "Mina",
            "bio": "Node operator",
            "country": "UK",
            "avatar_style": "cyan",
            "website": "https://example.com",
            "private_key": "never-return-this",
        },
    )
    updated = profiles.create_or_update_profile("VLQ_MEMBER", {"display_name": "Mina VLQ", "location": "London"})

    assert created["wallet_address"] == "VLQ_MEMBER"
    assert updated["display_name"] == "Mina VLQ"
    assert updated["bio"] == "Node operator"
    assert "private_key" not in profiles.get_public_profile("VLQ_MEMBER", {})


def test_search_profiles_matches_name_location_country_and_address():
    profiles = Profiles()
    profiles.create_or_update_profile("VLQ_LONDON", {"display_name": "Amina", "location": "London", "country": "UK"})
    profiles.create_or_update_profile("VLQ_NAIROBI", {"display_name": "Nuru", "location": "Nairobi", "country": "Kenya"})

    assert [profile["wallet_address"] for profile in profiles.search_profiles("kenya")] == ["VLQ_NAIROBI"]
    assert [profile["wallet_address"] for profile in profiles.search_profiles("VLQ_LON")] == ["VLQ_LONDON"]


def test_reputation_calculation_uses_transparent_activity_counts():
    profiles = Profiles()
    address = "VLQ_REP"
    profiles.create_or_update_profile(address, {"display_name": "Reputation Member"})

    blockchain = SimpleNamespace(chain=[SimpleNamespace(miner_address=address), SimpleNamespace(miner_address="OTHER")])
    forum = SimpleNamespace(
        posts={
            "one": {"author_address": address, "replies": [{"author_address": address}, {"author_address": "OTHER"}]},
            "two": {"author_address": "OTHER", "replies": [{"author_address": address}]},
        }
    )
    exchange = SimpleNamespace(
        offers={
            "trade": {"status": "completed", "creator_address": address, "acceptor_address": "OTHER"},
            "open": {"status": "open", "creator_address": address},
        }
    )
    lending_pool = SimpleNamespace(loan_requests={"loan": {"status": "repaid", "requester_address": address}})
    governance = SimpleNamespace(proposals={"gov": {"votes": {address: "yes"}}})
    treasury = SimpleNamespace(proposals={"treasury": {"votes": {address: "no"}}})

    result = profiles.calculate_reputation(
        address,
        blockchain=blockchain,
        lending_pool=lending_pool,
        exchange=exchange,
        governance=governance,
        treasury=treasury,
        forum=forum,
        achievements=DummyAchievements(),
    )

    assert result["reputation_score"] == 35
    assert result["activity_summary"]["forum_replies"] == 2
    assert result["activity_summary"]["completed_exchange_trades"] == 1


def test_public_profile_never_returns_secret_fields():
    profiles = Profiles()
    profiles.create_or_update_profile(
        "VLQ_SAFE",
        {
            "display_name": "Safe User",
            "bio": "Public only",
            "wallet_password": "not stored",
            "admin_token": "not stored",
        },
    )

    public = profiles.get_public_profile("VLQ_SAFE")

    assert public["display_name"] == "Safe User"
    assert "wallet_password" not in public
    assert "admin_token" not in public
