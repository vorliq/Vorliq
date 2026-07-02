"""Opt-in email notifications: preferences gate enqueueing, and a missing email
provider degrades to log-and-skip rather than raising."""
from __future__ import annotations

import os
import unittest
from unittest import mock

import notifications as notifications_module
from notifications import Notifications, mask_email, render_email


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


class NotificationRenderingTest(unittest.TestCase):
    def test_mask_email_hides_a_malformed_address_entirely(self):
        self.assertEqual(mask_email("no-at-sign"), "(hidden)")
        self.assertEqual(mask_email(""), "(hidden)")

    def test_every_event_renders_a_factual_subject_and_body(self):
        cases = {
            "loan_funded": ({"amount": 25}, "loan was funded", "25 VLQ"),
            "loan_repaid": ({"amount": 27.5}, "loan was repaid", "27.5 VLQ"),
            "governance_concluded": ({"title": "Raise quorum", "outcome": "passed"}, "concluded", "Raise quorum"),
        }
        for event, (data, subject_bit, body_bit) in cases.items():
            with self.subTest(event=event):
                rendered = render_email(event, data)
                self.assertIn(subject_bit, rendered["subject"].lower())
                self.assertIn(body_bit, rendered["text"])

    def test_an_unknown_event_renders_a_generic_notification(self):
        rendered = render_email("not-a-real-event", {})
        self.assertEqual(rendered["subject"], "Vorliq notification")


class NotificationDigestTest(unittest.TestCase):
    def test_digest_recipients_lists_only_opted_in_members_with_email(self):
        notifications = Notifications()
        notifications.set_preferences("VLQopted", email="opted@example.org", events={"weekly_digest": True})
        notifications.set_preferences("VLQnot", email="not@example.org", events={"weekly_digest": False})
        recipients = notifications.digest_recipients()
        self.assertEqual(recipients, [{"wallet_address": "VLQopted", "email": "opted@example.org"}])


class NotificationQueueEdgeTest(unittest.TestCase):
    def test_unknown_events_are_refused_at_enqueue(self):
        notifications = Notifications()
        result = notifications.enqueue(wallet_address="VLQwallet1", event="not-a-real-event")
        self.assertEqual(result, {"queued": False, "reason": "unknown_event"})

    def test_the_queue_is_capped_so_it_cannot_grow_without_bound(self):
        notifications = Notifications()
        notifications.set_preferences("VLQwallet1", email="member@example.org", events={"vlq_received": True})
        with mock.patch.object(notifications_module, "MAX_QUEUE", 3):
            for _ in range(5):
                notifications.enqueue(wallet_address="VLQwallet1", event="vlq_received", data={"amount": 1})
        self.assertEqual(len(notifications.queue), 3)

    def test_dispatch_with_an_empty_queue_is_a_cheap_no_op(self):
        notifications = Notifications()
        self.assertEqual(notifications.dispatch(), {"sent": 0, "skipped": 0, "failed": 0})


class NotificationDeliveryTest(unittest.TestCase):
    PROVIDER_ENV = {
        "VORLIQ_EMAIL_API_URL": "https://mail.example.org/send",
        "VORLIQ_EMAIL_API_KEY": "secret-key",
        "VORLIQ_EMAIL_FROM": "noreply@vorliq.org",
    }

    def _queued(self):
        notifications = Notifications()
        notifications.set_preferences("VLQwallet1", email="member@example.org", events={"vlq_received": True})
        notifications.enqueue(wallet_address="VLQwallet1", event="vlq_received", data={"amount": 1})
        return notifications

    def test_a_provider_failure_marks_the_item_failed_and_never_raises(self):
        notifications = self._queued()
        with mock.patch.dict(os.environ, self.PROVIDER_ENV, clear=False):
            with mock.patch.object(Notifications, "_send_via_provider", side_effect=RuntimeError("provider down")):
                result = notifications.dispatch()
        self.assertEqual(result, {"sent": 0, "skipped": 0, "failed": 1})
        self.assertEqual(notifications.queue[0]["status"], "failed")
        self.assertIn("provider down", notifications.queue[0]["error"])

    def test_send_via_provider_posts_the_email_with_the_bearer_key(self):
        notifications = self._queued()
        item = notifications.queue[0]
        provider = {"api_url": "https://mail.example.org/send", "api_key": "secret-key", "from": "noreply@vorliq.org"}
        response = mock.MagicMock(status=200)
        response.__enter__ = mock.Mock(return_value=response)
        response.__exit__ = mock.Mock(return_value=False)
        with mock.patch.object(notifications_module.urllib.request, "urlopen", return_value=response) as urlopen:
            notifications._send_via_provider(provider, item)
        request = urlopen.call_args[0][0]
        self.assertEqual(request.full_url, provider["api_url"])
        self.assertEqual(request.get_header("Authorization"), "Bearer secret-key")
        self.assertIn(b"member@example.org", request.data)

    def test_send_via_provider_raises_on_an_http_error_status(self):
        notifications = self._queued()
        item = notifications.queue[0]
        provider = {"api_url": "https://mail.example.org/send", "api_key": "secret-key", "from": "noreply@vorliq.org"}
        response = mock.MagicMock(status=500)
        response.__enter__ = mock.Mock(return_value=response)
        response.__exit__ = mock.Mock(return_value=False)
        with mock.patch.object(notifications_module.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(RuntimeError):
                notifications._send_via_provider(provider, item)

    def test_async_dispatch_runs_off_thread_and_swallows_dispatch_errors(self):
        notifications = self._queued()

        class InlineThread:
            def __init__(self, target=None, **_kwargs):
                self._target = target

            def start(self):
                self._target()

        # A dispatch error inside the guarded wrapper is logged, never raised.
        with mock.patch.object(notifications_module.threading, "Thread", InlineThread):
            with mock.patch.object(Notifications, "dispatch", side_effect=RuntimeError("boom")):
                notifications.dispatch_async()  # must not raise
        # And the normal path drains the queue through the same wrapper.
        with mock.patch.dict(os.environ, self.PROVIDER_ENV, clear=False):
            with mock.patch.object(notifications_module.threading, "Thread", InlineThread):
                with mock.patch.object(Notifications, "_send_via_provider"):
                    notifications.dispatch_async()
        self.assertEqual(notifications.queue[0]["status"], "sent")


if __name__ == "__main__":
    unittest.main()
