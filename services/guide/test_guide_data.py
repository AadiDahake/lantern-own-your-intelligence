"""Offline checks of the guide data: no key, no network. Run: python3 -m unittest -v (in services/guide)."""

import unittest

import guide_data


class GuideDataTest(unittest.TestCase):
    def setUp(self):
        self.data = guide_data.build()

    def test_split_is_by_session(self):
        train = {d.session_id for d in self.data["train"]}
        heldout = {d.session_id for d in self.data["heldout"]}
        self.assertTrue(train and heldout)
        self.assertFalse(train & heldout)

    def test_only_high_reward_walks_are_kept(self):
        for decision in self.data["train"] + self.data["heldout"]:
            self.assertGreaterEqual(decision.reward.total, guide_data.MIN_TOTAL)

    def test_every_target_is_a_control_on_the_page(self):
        for decision in self.data["train"] + self.data["heldout"]:
            ids = [c["id"] for c in decision.controls]
            self.assertIn(decision.target_id, ids)
            self.assertEqual(len(ids), len(set(ids)))

    def test_grade_matches_the_fixture_grader(self):
        browsed = {"session_id": "x", "steps": [{"event": "seat_map_opened", "props": {"party_size": 2}}]}
        self.assertEqual((guide_data.grade(browsed).completion, guide_data.grade(browsed).coherence), (1, 2))

    def test_parse_answer_refuses_unknown_ids_and_prose(self):
        controls = [{"id": "a1"}, {"id": "a2"}]
        self.assertEqual(guide_data.parse_answer('{"action": "press", "id": "a2"}', controls), "a2")
        self.assertIsNone(guide_data.parse_answer('{"action": "press", "id": "a7"}', controls))
        self.assertIsNone(guide_data.parse_answer("press the seat", controls))


if __name__ == "__main__":
    unittest.main()
