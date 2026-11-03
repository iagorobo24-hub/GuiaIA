import json
import unittest
from pathlib import Path

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "schemas" / "v1"

class TestV1Schemas(unittest.TestCase):
    def test_all_schemas_exist_and_are_valid_json(self):
        expected_schemas = [
            "mission_spec.json",
            "mission_state.json",
            "deposit_plan.json",
            "action_grant.json"
        ]
        for name in expected_schemas:
            path = SCHEMA_DIR / name
            self.assertTrue(path.exists(), f"Schema {name} does not exist")
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.assertIn("$schema", data)
            self.assertIn("title", data)
            self.assertIn("type", data)
            self.assertEqual(data["type"], "object")

    def test_mission_spec_bounds(self):
        with open(SCHEMA_DIR / "mission_spec.json", "r", encoding="utf-8") as f:
            schema = json.load(f)
        targets_schema = schema["properties"]["targets"]
        self.assertEqual(targets_schema["minItems"], 1)
        self.assertEqual(targets_schema["maxItems"], 16)

    def test_deposit_plan_bounds(self):
        with open(SCHEMA_DIR / "deposit_plan.json", "r", encoding="utf-8") as f:
            schema = json.load(f)
        items_schema = schema["properties"]["items"]
        self.assertEqual(items_schema["minItems"], 1)
        self.assertEqual(items_schema["maxItems"], 16)

if __name__ == "__main__":
    unittest.main()
