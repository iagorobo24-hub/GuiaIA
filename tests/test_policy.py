import unittest
from dataclasses import replace
from guiaia.policy import Observation, ProtectedRegion, SafetyConfig, evaluate_mining


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = SafetyConfig(regions=(ProtectedRegion(0, 0, 15),))
        self.obs = Observation((100, 64, 100), (102, 64, 101), 20, 300, "stone", "air", "state=IDLE", True)

    def test_safely_allows_but_never_authorizes_execution(self):
        self.assertTrue(evaluate_mining(self.obs, self.config)[0])

    def test_owner_offline(self):
        self.assertFalse(evaluate_mining(replace(self.obs, owner_online=False), self.config)[0])

    def test_protected_area(self):
        o = replace(self.obs, bot_pos=(0, 64, 0), owner_pos=(1, 64, 0))
        self.assertFalse(evaluate_mining(o, self.config)[0])

    def test_lava(self):
        self.assertFalse(evaluate_mining(replace(self.obs, feet_block="minecraft:lava"), self.config)[0])

    def test_nan_fail_closed(self):
        self.assertFalse(evaluate_mining(replace(self.obs, bot_pos=(float("nan"), 64, 0)), self.config)[0])
        self.assertFalse(evaluate_mining(replace(self.obs, health=float("nan")), self.config)[0])

    def test_unsafe_air(self):
        self.assertFalse(evaluate_mining(replace(self.obs, air=10), self.config)[0])

    def test_unverified_status(self):
        self.assertFalse(evaluate_mining(replace(self.obs, bot_status="unknown"), self.config)[0])

    def test_absurd_coordinates(self):
        self.assertFalse(evaluate_mining(replace(self.obs, bot_pos=(1e99, 64, 0)), self.config)[0])

    def test_unknown_phase(self):
        self.assertFalse(evaluate_mining(self.obs, self.config, "skip_safety")[0])


if __name__ == "__main__":
    unittest.main()
