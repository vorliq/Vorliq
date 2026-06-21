"""Opt-in email notifications: preferences gate enqueueing, and a missing email
provider degrades to log-and-skip rather than raising."""
from __future__ import annotations

import os
import unittest
from unittest import mock

from notifications import Notifications


class NotificationPreferencesTest(unittest.TestCase):
    def test_opt_in_defaults_to_everything_off(self):
        notifications = Notifications()
        prefs = notifications.get_preferences("VLQwallet1")
        self.assertFalse(prefs["configured"])
        self.assertTrue(all(value is False for value in prefs["events"].values()))

    def test_invalid_email_is_rejected(self):
        notifications = Notifications()
        with self.assertRaises(ValueError):
            notifications.set_preferences("VLQwallet1", email="not-an-email", events={"vlq_received": True})

    def test_saved_email_is_masked_never_returned_raw(self):
        notifications = Notifications()
        prefs = notifications.set_preferences("VLQwallet1", email="member@example.org", events={"vlq_received": True})
        self.assertTrue(prefs["configured"])
        self.assertNotIn("member@example.org", prefs["email_masked"])
        self.assertTrue(prefs["email_masked"].endswith("@example.org"))

    def test_clearing_email_removes_the_member_entirely(self):
        notifications = Notifications()
        notifications.set_preferences("VLQwallet1", email="member@example.org", events={"vlq_received": True})
        prefs = notifications.set_preferences("VLQwallet1", email="", events={"vlq_received": True})
        self.assertFalse(prefs["configured"])
        self.assertNotIn("VLQwallet1", notifications.preferences)

    def test_update_events_keeps_the_saved_email(self):
        notifications = Notifications()
        notifications.set_preferences("VLQwallet1", email="member@example.org", events={"vlq_received": True})
        notifications.update_events("VLQwallet1", events={"vlq_received": False, "loan_funded": True})
        self.assertEqual(notifications.preferences["VLQwallet1"]["email"], "member@example.org")
        self.assertFalse(notifications.preferences["VLQwallet1"]["events"]["vlq_received"])
        self.assertTrue(notifications.preferences["VLQwallet1"]["events"]["loan_funded"])


class NotificationQueueTest(unittest.TestCase):
    def test_nothing_is_queued_without_opt_in(self):
        notifications = Notifications()
        # No email on file at all.
        self.assertEqual(notifications.enqueue(wallet_address="VLQwallet1", event="vlq_received")["reason"], "no_email")
        # Email on file, but this event disabled.
        notifications.set_preferences("VLQwallet1", email="member@example.org", events={"loan_funded": True})
        self.assertEqual(notifications.enqueue(wallet_address="VLQwallet1", event="vlq_received")["reason"], "event_disabled")

    def test_enqueue_for_an_enabled_event(self):
        notifications = Notifications()
        notifications.set_preferences("VLQwallet1", email="member@example.org", events={"vlq_received": True})
        result = notifications.enqueue(wallet_address="VLQwallet1", event="vlq_received", data={"amount": 5, "from": "VLQsender"})
        self.assertTrue(result["queued"])
        self.assertEqual(len(notifications.pending()), 1)

    def test_dispatch_without_a_provider_logs_and_skips_without_raising(self):
        notifications = Notifications()
        notifications.set_preferences("VLQwallet1", email="member@example.org", events={"vlq_received": True})
        notifications.enqueue(wallet_address="VLQwallet1", event="vlq_received", data={"amount": 1})
        with mock.patch.dict(os.environ, {"VORLIQ_EMAIL_API_URL": "", "VORLIQ_EMAIL_API_KEY": "", "VORLIQ_EMAIL_FROM": ""}, clear=False):
            result = notifications.dispatch()
        self.assertEqual(result, {"sent": 0, "skipped": 1, "failed": 0})
        self.assertEqual(notifications.pending(), [])
        self.assertEqual(notifications.queue[0]["status"], "skipped_no_provider")

    def test_dispatch_with_a_provider_sends_each_queued_email(self):
        notifications = Notifications()
        notifications.set_preferences("VLQwallet1", email="member@example.org", events={"vlq_received": True})
        notifications.enqueue(wallet_address="VLQwallet1", event="vlq_received", data={"amount": 1})
        env = {
            "VORLIQ_EMAIL_API_URL": "https://mail.example.org/send",
            "VORLIQ_EMAIL_API_KEY": "secret-key",
            "VORLIQ_EMAIL_FROM": "noreply@vorliq.org",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            with mock.patch.object(Notifications, "_send_via_provider") as sender:
                result = notifications.dispatch()
        sender.assert_called_once()
        self.assertEqual(result, {"sent": 1, "skipped": 0, "failed": 0})
        self.assertEqual(notifications.queue[0]["status"], "sent")


if __name__ == "__main__":
    unittest.main()
