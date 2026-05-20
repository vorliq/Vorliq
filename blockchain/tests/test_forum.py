import unittest

from forum import Forum


class ForumTests(unittest.TestCase):
    def test_feature_votes_mark_post_featured_after_five_unique_votes(self):
        forum = Forum()
        post_id = forum.create_post("author", "Useful mining guide", "Here is how we run a node.", "technical")

        for index in range(5):
            post = forum.feature_post(post_id, f"voter-{index}")

        self.assertTrue(post["featured"])
        self.assertEqual(post["feature_vote_count"], 5)
        self.assertEqual(len(post["feature_votes"]), 5)

    def test_duplicate_feature_vote_is_rejected(self):
        forum = Forum()
        post_id = forum.create_post("author", "Loan idea", "A detailed proposal.", "lending")
        forum.feature_post(post_id, "voter")

        with self.assertRaises(ValueError):
            forum.feature_post(post_id, "voter")

    def test_featured_posts_are_sorted_by_feature_vote_count(self):
        forum = Forum()
        first_post_id = forum.create_post("author", "First", "Body")
        second_post_id = forum.create_post("author", "Second", "Body")

        for index in range(5):
            forum.feature_post(first_post_id, f"first-{index}")
        for index in range(6):
            forum.feature_post(second_post_id, f"second-{index}")

        featured_posts = forum.get_featured_posts()

        self.assertEqual([post["post_id"] for post in featured_posts], [second_post_id, first_post_id])

    def test_older_posts_without_feature_fields_load_with_defaults(self):
        forum = Forum()
        forum.posts = {
            "legacy": {
                "post_id": "legacy",
                "author_address": "author",
                "title": "Legacy",
                "body": "Old saved post",
                "category": "general",
                "timestamp": 1,
                "replies": [],
                "vote_count": 0,
                "voters": [],
            }
        }

        post = forum.get_post("legacy")

        self.assertFalse(post["featured"])
        self.assertEqual(post["feature_votes"], [])
        self.assertEqual(post["feature_vote_count"], 0)

    def test_hidden_posts_are_excluded_and_cannot_be_featured(self):
        forum = Forum()
        post_id = forum.create_post("author", "Hidden", "Body")
        forum.set_post_moderation(post_id, "hidden", "spam")

        self.assertEqual(forum.get_all_posts(), [])
        self.assertEqual(forum.get_featured_posts(), [])
        with self.assertRaises(ValueError):
            forum.feature_post(post_id, "voter")

    def test_locked_posts_reject_replies(self):
        forum = Forum()
        post_id = forum.create_post("author", "Locked", "Body")
        forum.set_post_moderation(post_id, "locked", "review")

        with self.assertRaises(ValueError):
            forum.add_reply(post_id, "member", "reply")


if __name__ == "__main__":
    unittest.main()
